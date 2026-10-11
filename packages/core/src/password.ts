import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/**
 * scrypt from node:crypto (OWASP-accepted, no native addon to build in the
 * Railway image). N=2^17, r=8, p=1 ≈ 100ms per hash. Parameters are stored in
 * the hash so they can be raised later without invalidating existing hashes.
 * See docs/MAILORY_DECISIONS.md D-023.
 */
const DEFAULTS = { N: 2 ** 17, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const MAX_MEM = 256 * 1024 * 1024; // scrypt needs ~128*N*r bytes; Node's 32MB default is too small

export async function hashPassword(
  password: string,
  params: { N: number; r: number; p: number } = DEFAULTS,
) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    ...params,
    maxmem: MAX_MEM,
  });
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, keyHex] = parts;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (![params.N, params.r, params.p].every(Number.isFinite)) return false;
  const salt = Buffer.from(saltHex ?? "", "hex");
  const expected = Buffer.from(keyHex ?? "", "hex");
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const key = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      ...params,
      maxmem: MAX_MEM,
    });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false; // corrupt stored params fail closed rather than 500
  }
}

/** True when a stored hash was made with weaker parameters than today's defaults. */
export function needsRehash(storedHash: string): boolean {
  const [, n, r, p] = storedHash.split("$");
  return Number(n) < DEFAULTS.N || Number(r) < DEFAULTS.r || Number(p) < DEFAULTS.p;
}

let dummyHash: Promise<string> | undefined;
/**
 * Verifies against a throwaway hash so "unknown email" costs the same as
 * "wrong password" — login timing must not reveal which emails exist.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("mailory-timing-equalizer");
  await verifyPassword(password, await dummyHash);
}
