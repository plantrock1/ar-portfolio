import { cookies } from "next/headers";
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

const COOKIE_NAME = "ar_admin";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const SCRYPT_KEYLEN = 64;
const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

function sign(value: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not set");
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Hash a password using scrypt. Returns `scrypt$<saltHex>$<hashHex>`.
 * Storage format keeps salt bundled with the hash so no separate column.
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(plain, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function verifyHash(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  try {
    const actual = await scryptAsync(plain, salt, expected.length);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Verify an admin password. Resolution order:
 *   1. MASTER_PASSWORD env var — a shared recovery password set to the
 *      same value on every deployment. Always accepted regardless of the
 *      per-owner password or DB hash, so a locked-out owner can always
 *      get in and reset their own password via the Change Password UI.
 *   2. DB-stored hash (set via Change Password UI) — authoritative once set.
 *   3. ADMIN_PASSWORD env var — bootstrap for first login on a fresh
 *      deployment, or when no DB hash exists yet.
 */
export async function checkPassword(input: string): Promise<boolean> {
  // 1. Master recovery password (shared across all deployments).
  const master = process.env.MASTER_PASSWORD;
  if (master && master.length > 0 && safeEqual(input, master)) {
    return true;
  }

  // 2. DB hash (per-owner custom password)
  const rows = await db
    .select({ hash: schema.siteSettings.adminPasswordHash })
    .from(schema.siteSettings)
    .where(eq(schema.siteSettings.id, "main"));
  const storedHash = rows[0]?.hash ?? null;

  if (storedHash) {
    return verifyHash(input, storedHash);
  }

  // 3. Fallback to ADMIN_PASSWORD env var
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return safeEqual(input, expected);
}

/**
 * Persist a new admin password hash. Once set, env ADMIN_PASSWORD is no
 * longer consulted — the DB value is authoritative.
 */
export async function setAdminPasswordHash(hash: string) {
  await db
    .insert(schema.siteSettings)
    .values({ id: "main", adminPasswordHash: hash })
    .onConflictDoUpdate({
      target: schema.siteSettings.id,
      set: { adminPasswordHash: hash },
    });
}

export async function createAdminSession() {
  const issued = Date.now().toString();
  const sig = sign(issued);
  const jar = await cookies();
  jar.set(COOKIE_NAME, `${issued}.${sig}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroyAdminSession() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) return false;
  const [issued, sig] = raw.split(".");
  if (!issued || !sig) return false;
  const expected = sign(issued);
  if (!safeEqual(sig, expected)) return false;
  const age = Date.now() - Number(issued);
  if (!Number.isFinite(age) || age < 0) return false;
  if (age > MAX_AGE_SECONDS * 1000) return false;
  return true;
}
