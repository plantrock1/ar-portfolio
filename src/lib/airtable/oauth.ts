import { createHash, randomBytes } from "node:crypto";

// Airtable OAuth 2.0 with PKCE. Airtable requires PKCE even for confidential
// clients that have a client secret, so we generate a verifier + challenge
// on the authorize hop and verify on the callback hop.

const AUTHORIZE_URL = "https://airtable.com/oauth2/v1/authorize";
const TOKEN_URL = "https://airtable.com/oauth2/v1/token";

export const AIRTABLE_SCOPES = [
  "data.records:read",
  "schema.bases:read",
  "workspacesAndBases:read",
].join(" ");

export function generatePkcePair(): { verifier: string; challenge: string } {
  // 64 random bytes → 86 base64url chars, well within Airtable's 43–128 cap.
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(24).toString("base64url");
}

export function buildAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
    scope: AIRTABLE_SCOPES,
    state: args.state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export type AirtableTokens = {
  access_token: string;
  refresh_token: string;
  /** seconds until access_token expiry (typically 3600) */
  expires_in: number;
  refresh_expires_in?: number;
  token_type: string;
  scope: string;
};

function basicAuthHeader(clientId: string, clientSecret: string): string {
  const b = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  return `Basic ${b}`;
}

export async function exchangeCodeForTokens(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<AirtableTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.codeVerifier,
    client_id: args.clientId,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(args.clientId, args.clientSecret),
    },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Airtable token exchange ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as AirtableTokens;
}

export async function refreshTokens(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<AirtableTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: args.clientId,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(args.clientId, args.clientSecret),
    },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Airtable token refresh ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as AirtableTokens;
}

/** Redirect URI must match the OAuth app registration exactly. */
export function airtableRedirectUri(req: Request): string {
  // Prefer explicit env for known deployments; fall back to request origin.
  const explicit = process.env.AIRTABLE_REDIRECT_URI;
  if (explicit) return explicit;
  const url = new URL(req.url);
  return `${url.origin}/api/admin/airtable/callback`;
}
