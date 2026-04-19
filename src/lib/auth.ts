import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "ar_admin";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

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

export function checkPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return safeEqual(input, expected);
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
