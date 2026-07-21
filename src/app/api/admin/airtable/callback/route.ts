import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import {
  airtableRedirectUri,
  exchangeCodeForTokens,
} from "@/lib/airtable/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OAUTH_COOKIE = "airtable_oauth";

function signPayload(payload: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not set");
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function adminUrl(pathname: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `${pathname}?${qs}`;
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (oauthError) {
    return NextResponse.redirect(
      new URL(
        adminUrl("/admin", {
          airtable: "error",
          message: errorDescription ?? oauthError,
        }),
        url,
      ),
    );
  }
  if (!code || !returnedState) {
    return NextResponse.redirect(
      new URL(
        adminUrl("/admin", {
          airtable: "error",
          message: "Missing code or state in Airtable callback",
        }),
        url,
      ),
    );
  }

  const cookieValue = req.cookies.get(OAUTH_COOKIE)?.value ?? null;
  if (!cookieValue) {
    return NextResponse.redirect(
      new URL(
        adminUrl("/admin", {
          airtable: "error",
          message: "OAuth session expired — try Connect Airtable again",
        }),
        url,
      ),
    );
  }
  const [payload, sig] = cookieValue.split(".");
  if (!payload || !sig || !safeEqual(sig, signPayload(payload))) {
    return NextResponse.redirect(
      new URL(
        adminUrl("/admin", {
          airtable: "error",
          message: "OAuth cookie failed verification",
        }),
        url,
      ),
    );
  }
  let stored: { state?: string; verifier?: string };
  try {
    stored = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return NextResponse.redirect(
      new URL(
        adminUrl("/admin", {
          airtable: "error",
          message: "OAuth cookie malformed",
        }),
        url,
      ),
    );
  }
  if (!stored.state || !stored.verifier || !safeEqual(stored.state, returnedState)) {
    return NextResponse.redirect(
      new URL(
        adminUrl("/admin", {
          airtable: "error",
          message: "OAuth state mismatch — try Connect Airtable again",
        }),
        url,
      ),
    );
  }

  const clientId = process.env.AIRTABLE_CLIENT_ID;
  const clientSecret = process.env.AIRTABLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL(
        adminUrl("/admin", {
          airtable: "error",
          message: "AIRTABLE_CLIENT_ID / SECRET not set on server",
        }),
        url,
      ),
    );
  }

  try {
    const tokens = await exchangeCodeForTokens({
      clientId,
      clientSecret,
      code,
      redirectUri: airtableRedirectUri(req),
      codeVerifier: stored.verifier,
    });

    await db
      .update(schema.siteSettings)
      .set({
        airtableAccessToken: tokens.access_token,
        airtableRefreshToken: tokens.refresh_token,
        airtableTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        airtableSyncStatus: "idle",
        airtableLastError: null,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.siteSettings.id, "main"));

    const res = NextResponse.redirect(
      new URL(adminUrl("/admin", { airtable: "connected" }), url),
    );
    // Clear the OAuth transient cookie now that we're done.
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return NextResponse.redirect(
      new URL(
        adminUrl("/admin", { airtable: "error", message }),
        url,
      ),
    );
  }
}
