import {
  burnPasswordCheck,
  generateToken,
  hashPassword,
  hashToken,
  needsRehash,
  verifyPassword,
} from "@mailory/core";
import {
  consumeUserToken,
  createSession,
  createUser,
  createUserToken,
  findUserByEmail,
  getActiveSessionByTokenHash,
  markEmailVerified,
  revokeSessionByTokenHash,
  setPasswordAndRevokeSessions,
  updatePasswordHash,
  type Database,
} from "@mailory/db";
import type { LoginInput, RegisterInput } from "@mailory/validation";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

/** Sends a system email. Failures must never break the auth flow, so callers treat it as best-effort. */
export type SendEmail = (message: {
  to: string;
  kind: string;
  subject: string;
  text: string;
}) => Promise<void>;

export type AuthDeps = {
  db: Database;
  sendEmail: SendEmail;
  appUrl: string;
  now?: () => Date;
};

const at = (deps: AuthDeps) => (deps.now ?? (() => new Date()))();

async function safeSend(deps: AuthDeps, message: Parameters<SendEmail>[0]) {
  try {
    await deps.sendEmail(message);
  } catch (error) {
    console.error(`[auth] email "${message.kind}" failed`, error);
  }
}

async function issueVerification(
  deps: AuthDeps,
  user: { id: string; email: string; firstName: string },
) {
  const token = generateToken();
  await createUserToken(deps.db, {
    userId: user.id,
    purpose: "verify_email",
    tokenHash: hashToken(token),
    expiresAt: new Date(at(deps).getTime() + VERIFY_TTL_MS),
  });
  await safeSend(deps, {
    to: user.email,
    kind: "verify_email",
    subject: "Mailory e-posta adresinizi doğrulayın",
    text: `Merhaba ${user.firstName},\n\nHesabınızı etkinleştirmek için bağlantıya tıklayın (24 saat geçerli):\n${deps.appUrl}/verify-email?token=${token}\n\nBu hesabı siz oluşturmadıysanız bu e-postayı yok sayabilirsiniz.`,
  });
}

/**
 * Always resolves the same way whether or not the email exists, so the endpoint
 * cannot be used to enumerate accounts. An existing address gets a notice instead.
 */
export async function register(deps: AuthDeps, input: RegisterInput): Promise<void> {
  const passwordHash = await hashPassword(input.password);
  const user = await createUser(deps.db, {
    email: input.email,
    passwordHash,
    firstName: input.firstName,
    lastName: input.lastName,
  });
  if (user) {
    await issueVerification(deps, user);
    return;
  }
  await safeSend(deps, {
    to: input.email,
    kind: "register_existing",
    subject: "Mailory hesabınız zaten mevcut",
    text: `Bu e-posta adresiyle kayıtlı bir Mailory hesabı zaten var.\n\nGiriş yapın: ${deps.appUrl}/login\nParolanızı unuttuysanız: ${deps.appUrl}/forgot-password\n\nKayıt isteği size ait değilse bu e-postayı yok sayabilirsiniz.`,
  });
}

export type LoginResult =
  | { ok: true; sessionToken: string; expiresAt: Date }
  | { ok: false; reason: "invalid_credentials" | "email_not_verified" | "disabled" };

export async function login(
  deps: AuthDeps,
  input: LoginInput,
  meta: { userAgent?: string; ipAddress?: string } = {},
): Promise<LoginResult> {
  const user = await findUserByEmail(deps.db, input.email);
  if (!user) {
    await burnPasswordCheck(input.password);
    return { ok: false, reason: "invalid_credentials" };
  }
  if (!(await verifyPassword(input.password, user.passwordHash)))
    return { ok: false, reason: "invalid_credentials" };
  // Reasons below are only revealed to someone who proved they know the password.
  if (user.disabledAt) return { ok: false, reason: "disabled" };
  if (!user.emailVerifiedAt) return { ok: false, reason: "email_not_verified" };

  if (needsRehash(user.passwordHash))
    await updatePasswordHash(deps.db, user.id, await hashPassword(input.password));

  const sessionToken = generateToken();
  const expiresAt = new Date(at(deps).getTime() + SESSION_TTL_MS);
  await createSession(deps.db, {
    userId: user.id,
    tokenHash: hashToken(sessionToken),
    expiresAt,
    ...meta,
  });
  return { ok: true, sessionToken, expiresAt };
}

export async function logout(deps: AuthDeps, sessionToken: string): Promise<void> {
  await revokeSessionByTokenHash(deps.db, hashToken(sessionToken));
}

export async function resolveSession(deps: AuthDeps, sessionToken: string) {
  const row = await getActiveSessionByTokenHash(
    deps.db,
    hashToken(sessionToken),
    at(deps),
  );
  if (!row) return null;
  return {
    sessionId: row.session.id,
    activeOrganizationId: row.session.activeOrganizationId,
    user: {
      id: row.user.id,
      email: row.user.email,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      isPlatformAdmin: row.user.isPlatformAdmin,
    },
  };
}

export async function verifyEmail(deps: AuthDeps, token: string): Promise<boolean> {
  const userId = await consumeUserToken(deps.db, {
    tokenHash: hashToken(token),
    purpose: "verify_email",
    now: at(deps),
  });
  if (!userId) return false;
  await markEmailVerified(deps.db, userId);
  return true;
}

/** Same non-disclosure rule as register: unknown emails do nothing, visibly identically. */
export async function requestPasswordReset(
  deps: AuthDeps,
  email: string,
): Promise<void> {
  const user = await findUserByEmail(deps.db, email);
  if (!user || user.disabledAt) return;
  const token = generateToken();
  await createUserToken(deps.db, {
    userId: user.id,
    purpose: "reset_password",
    tokenHash: hashToken(token),
    expiresAt: new Date(at(deps).getTime() + RESET_TTL_MS),
  });
  await safeSend(deps, {
    to: user.email,
    kind: "password_reset",
    subject: "Mailory parola sıfırlama",
    text: `Parolanızı sıfırlamak için bağlantıya tıklayın (1 saat geçerli):\n${deps.appUrl}/reset-password?token=${token}\n\nBu isteği siz yapmadıysanız bu e-postayı yok sayın; parolanız değişmeyecek.`,
  });
}

/** Resetting also proves mailbox ownership, so it verifies the email and revokes all sessions. */
export async function resetPassword(
  deps: AuthDeps,
  token: string,
  newPassword: string,
): Promise<boolean> {
  const userId = await consumeUserToken(deps.db, {
    tokenHash: hashToken(token),
    purpose: "reset_password",
    now: at(deps),
  });
  if (!userId) return false;
  await setPasswordAndRevokeSessions(deps.db, userId, await hashPassword(newPassword));
  await markEmailVerified(deps.db, userId);
  return true;
}
