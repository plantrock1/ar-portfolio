import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { isAdmin } from "@/lib/auth";
import {
  airtableRedirectUri,
  buildAuthorizeUrl,
  generatePkcePair,
  generateState,
} from "@/lib/airtable/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OAUTH_COOKIE = "airtable_oauth";
const COOKIE_MAX_AGE = 10 * 60; // 10 minutes to complete the redirect flow

function signPayload(payload: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not set");
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const clientId = process.env.AIRTABLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "AIRTABLE_CLIENT_ID not set on this deployment" },
      { status: 500 },
    );
  }
  const redirectUri = airtableRedirectUri(req);
  const state = generateState();
  const { verifier, challenge } = generatePkcePair();

  const payload = Buffer.from(
    JSON.stringify({ state, verifier }),
    "utf8",
  ).toString("base64url");
  const sig = signPayload(payload);
  const cookieValue = `${payload}.${sig}`;

  const authorizeUrl = buildAuthorizeUrl({
    clientId,
    redirectUri,
    state,
    codeChallenge: challenge,
  });

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(OAUTH_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
