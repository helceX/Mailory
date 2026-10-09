import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "../index";
import {
  emailOutbox,
  sessions,
  userTokens,
  users,
  type UserTokenPurpose,
} from "../schema/index";

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  // drizzle wraps driver errors; the pg code may be on the error or its cause.
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === UNIQUE_VIOLATION || e?.cause?.code === UNIQUE_VIOLATION;
}

export async function findUserByEmail(db: Database, email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return user ?? null;
}

export async function findUserById(db: Database, id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

/** Returns the new user, or null if the email is already registered (race-safe via the unique index). */
export async function createUser(
  db: Database,
  input: { email: string; passwordHash: string; firstName: string; lastName: string },
) {
  try {
    const [user] = await db
      .insert(users)
      .values({ ...input, email: input.email.toLowerCase() })
      .returning();
    return user ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/** Issues a token; any earlier unconsumed token of the same purpose is invalidated first. */
export async function createUserToken(
  db: Database,
  input: {
    userId: string;
    purpose: UserTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
  },
) {
  await db.transaction(async (tx) => {
    await tx
      .update(userTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(userTokens.userId, input.userId),
          eq(userTokens.purpose, input.purpose),
          isNull(userTokens.consumedAt),
        ),
      );
    await tx.insert(userTokens).values(input);
  });
}

/** Atomically consumes a valid token (single use). Returns the user id, or null if unknown/used/expired. */
export async function consumeUserToken(
  db: Database,
  input: { tokenHash: string; purpose: UserTokenPurpose; now?: Date },
) {
  const now = input.now ?? new Date();
  const [row] = await db
    .update(userTokens)
    .set({ consumedAt: now })
    .where(
      and(
        eq(userTokens.tokenHash, input.tokenHash),
        eq(userTokens.purpose, input.purpose),
        isNull(userTokens.consumedAt),
        gt(userTokens.expiresAt, now),
      ),
    )
    .returning({ userId: userTokens.userId });
  return row?.userId ?? null;
}

export async function markEmailVerified(db: Database, userId: string) {
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
}

/** Sets a new password and revokes every session — a reset must log out a possible attacker. */
export async function setPasswordAndRevokeSessions(
  db: Database,
  userId: string,
  passwordHash: string,
) {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  });
}

export async function updatePasswordHash(
  db: Database,
  userId: string,
  passwordHash: string,
) {
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function createSession(
  db: Database,
  input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string;
    ipAddress?: string;
  },
) {
  const [session] = await db.insert(sessions).values(input).returning();
  return session!;
}

/** Active = exists, not revoked, not expired, and the user is not disabled. */
export async function getActiveSessionByTokenHash(
  db: Database,
  tokenHash: string,
  now = new Date(),
) {
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        isNull(users.disabledAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function revokeSessionByTokenHash(db: Database, tokenHash: string) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
}

export async function enqueueEmail(
  db: Database,
  input: { toEmail: string; subject: string; bodyText: string; kind: string },
) {
  const [row] = await db
    .insert(emailOutbox)
    .values(input)
    .returning({ id: emailOutbox.id });
  return row!.id;
}

export async function markEmailDelivered(
  db: Database,
  id: string,
  deliveredVia: string,
) {
  await db
    .update(emailOutbox)
    .set({ sentAt: new Date(), deliveredVia, lastError: null })
    .where(eq(emailOutbox.id, id));
}

export async function markEmailFailed(db: Database, id: string, error: string) {
  await db
    .update(emailOutbox)
    .set({ lastError: error.slice(0, 500) })
    .where(eq(emailOutbox.id, id));
}
