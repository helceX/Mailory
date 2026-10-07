import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, findUserByEmail, sessions, type Database } from "@mailory/db";
import { hashToken } from "@mailory/core";
import {
  login,
  logout,
  register,
  requestPasswordReset,
  resetPassword,
  resolveSession,
  verifyEmail,
  type AuthDeps,
  type SendEmail,
} from "./service";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("auth service (real Postgres)", () => {
  let db: Database;
  let end: () => Promise<void>;
  let sent: Parameters<SendEmail>[0][];
  let deps: AuthDeps;
  let now = new Date();

  beforeAll(() => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.pool.end();
  });
  afterAll(async () => end());

  const fresh = () => {
    sent = [];
    now = new Date();
    deps = {
      db,
      appUrl: "https://app.test",
      now: () => now,
      sendEmail: async (m) => void sent.push(m),
    };
    return `u-${randomUUID()}@example.com`;
  };
  const tokenFrom = (text: string) =>
    new URL(text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
  const input = (email: string, password = "a-strong-password-1") => ({
    email,
    password,
    firstName: "Ada",
    lastName: "Lovelace",
  });

  it("registers, verifies by emailed link, then logs in and resolves the session", async () => {
    const email = fresh();
    await register(deps, input(email));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.kind).toBe("verify_email");

    expect(await login(deps, { email, password: "a-strong-password-1" })).toEqual({
      ok: false,
      reason: "email_not_verified",
    });
    expect(await verifyEmail(deps, tokenFrom(sent[0]!.text))).toBe(true);

    const result = await login(deps, { email, password: "a-strong-password-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resolved = await resolveSession(deps, result.sessionToken);
    expect(resolved?.user.email).toBe(email);
  });

  it("stores only hashes of session and verification tokens", async () => {
    const email = fresh();
    await register(deps, input(email));
    const token = tokenFrom(sent[0]!.text);
    await verifyEmail(deps, token);
    const result = await login(deps, { email, password: "a-strong-password-1" });
    if (!result.ok) throw new Error("login failed");
    // The raw cookie value must not be what the table holds...
    expect(
      await db
        .select()
        .from(sessions)
        .where(eq(sessions.tokenHash, result.sessionToken)),
    ).toHaveLength(0);
    // ...its SHA-256 is.
    expect(
      await db
        .select()
        .from(sessions)
        .where(eq(sessions.tokenHash, hashToken(result.sessionToken))),
    ).toHaveLength(1);
    // Presenting the stored hash as a cookie must not authenticate.
    expect(await resolveSession(deps, hashToken(result.sessionToken))).toBeNull();
  });

  it("verification links are single-use", async () => {
    const email = fresh();
    await register(deps, input(email));
    const token = tokenFrom(sent[0]!.text);
    expect(await verifyEmail(deps, token)).toBe(true);
    expect(await verifyEmail(deps, token)).toBe(false);
  });

  it("expired verification links are rejected", async () => {
    const email = fresh();
    await register(deps, input(email));
    const token = tokenFrom(sent[0]!.text);
    now = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    expect(await verifyEmail(deps, token)).toBe(false);
  });

  it("a reset token cannot verify an email (purpose scoping)", async () => {
    const email = fresh();
    await register(deps, input(email));
    await requestPasswordReset(deps, email);
    const resetToken = tokenFrom(sent.find((m) => m.kind === "password_reset")!.text);
    expect(await verifyEmail(deps, resetToken)).toBe(false);
  });

  it("registering an existing email reveals nothing and sends a notice, not a second account", async () => {
    const email = fresh();
    await register(deps, input(email));
    sent.length = 0;
    await expect(
      register(deps, input(email, "another-password-22")),
    ).resolves.toBeUndefined();
    expect(sent.map((m) => m.kind)).toEqual(["register_existing"]);
    const user = await findUserByEmail(db, email);
    expect(user).not.toBeNull();
  });

  it("email matching is case-insensitive", async () => {
    const email = fresh();
    await register(deps, input(email));
    await verifyEmail(deps, tokenFrom(sent[0]!.text));
    const result = await login(deps, {
      email: email.toUpperCase().toLowerCase(),
      password: "a-strong-password-1",
    });
    expect(result.ok).toBe(true);
    expect((await findUserByEmail(db, email.toUpperCase()))?.email).toBe(email);
  });

  it("wrong password and unknown email return the same reason", async () => {
    const email = fresh();
    await register(deps, input(email));
    await verifyEmail(deps, tokenFrom(sent[0]!.text));
    const wrong = await login(deps, { email, password: "nope-nope-nope" });
    const unknown = await login(deps, {
      email: `x-${randomUUID()}@example.com`,
      password: "nope-nope-nope",
    });
    expect(wrong).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(unknown).toEqual(wrong);
  });

  it("logout revokes the session", async () => {
    const email = fresh();
    await register(deps, input(email));
    await verifyEmail(deps, tokenFrom(sent[0]!.text));
    const result = await login(deps, { email, password: "a-strong-password-1" });
    if (!result.ok) throw new Error("login failed");
    await logout(deps, result.sessionToken);
    expect(await resolveSession(deps, result.sessionToken)).toBeNull();
  });

  it("sessions expire", async () => {
    const email = fresh();
    await register(deps, input(email));
    await verifyEmail(deps, tokenFrom(sent[0]!.text));
    const result = await login(deps, { email, password: "a-strong-password-1" });
    if (!result.ok) throw new Error("login failed");
    now = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(await resolveSession(deps, result.sessionToken)).toBeNull();
  });

  it("password reset changes the password, revokes all sessions, and is single-use", async () => {
    const email = fresh();
    await register(deps, input(email));
    await verifyEmail(deps, tokenFrom(sent[0]!.text));
    const session = await login(deps, { email, password: "a-strong-password-1" });
    if (!session.ok) throw new Error("login failed");

    await requestPasswordReset(deps, email);
    const token = tokenFrom(sent.find((m) => m.kind === "password_reset")!.text);
    expect(await resetPassword(deps, token, "brand-new-password-9")).toBe(true);
    expect(await resetPassword(deps, token, "yet-another-password-3")).toBe(false);

    expect(await resolveSession(deps, session.sessionToken)).toBeNull();
    expect((await login(deps, { email, password: "a-strong-password-1" })).ok).toBe(
      false,
    );
    expect((await login(deps, { email, password: "brand-new-password-9" })).ok).toBe(
      true,
    );
  });

  it("requesting a reset for an unknown email sends nothing", async () => {
    fresh();
    await requestPasswordReset(deps, `ghost-${randomUUID()}@example.com`);
    expect(sent).toHaveLength(0);
  });

  it("a newer reset link invalidates the older one", async () => {
    const email = fresh();
    await register(deps, input(email));
    await requestPasswordReset(deps, email);
    await requestPasswordReset(deps, email);
    const [first, second] = sent
      .filter((m) => m.kind === "password_reset")
      .map((m) => tokenFrom(m.text));
    expect(await resetPassword(deps, first!, "brand-new-password-9")).toBe(false);
    expect(await resetPassword(deps, second!, "brand-new-password-9")).toBe(true);
  });

  it("a failing email transport does not break registration", async () => {
    const email = fresh();
    deps = {
      ...deps,
      sendEmail: async () => {
        throw new Error("ses down");
      },
    };
    await expect(register(deps, input(email))).resolves.toBeUndefined();
    expect(await findUserByEmail(db, email)).not.toBeNull();
  });
});
