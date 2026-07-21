import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { refreshTokens } from "./oauth";

// Manages the stored Airtable tokens on site_settings — reads them, refreshes
// when the access token is close to expiring, and returns a valid one.

const REFRESH_BUFFER_MS = 60 * 1000; // refresh if <60s left on access_token

async function loadStoredAuth() {
  const rows = await db
    .select({
      access: schema.siteSettings.airtableAccessToken,
      refresh: schema.siteSettings.airtableRefreshToken,
      expiresAt: schema.siteSettings.airtableTokenExpiresAt,
      baseId: schema.siteSettings.airtableBaseId,
      tableName: schema.siteSettings.airtableTableName,
    })
    .from(schema.siteSettings)
    .where(eq(schema.siteSettings.id, "main"));
  return rows[0] ?? null;
}

async function persistTokens(args: {
  access: string;
  refresh: string;
  expiresAt: Date;
}) {
  await db
    .update(schema.siteSettings)
    .set({
      airtableAccessToken: args.access,
      airtableRefreshToken: args.refresh,
      airtableTokenExpiresAt: args.expiresAt,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.siteSettings.id, "main"));
}

export type AirtableConfig = {
  accessToken: string;
  baseId: string | null;
  tableName: string | null;
};

/**
 * Returns a valid access token, refreshing if necessary. Throws if not
 * connected (no refresh token stored) or if refresh fails.
 */
export async function getValidAirtableAuth(): Promise<AirtableConfig> {
  const stored = await loadStoredAuth();
  if (!stored?.refresh || !stored?.access) {
    throw new Error("Airtable not connected — click Connect Airtable in admin.");
  }
  const clientId = process.env.AIRTABLE_CLIENT_ID;
  const clientSecret = process.env.AIRTABLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "AIRTABLE_CLIENT_ID / AIRTABLE_CLIENT_SECRET not set on this deployment.",
    );
  }

  const expired =
    !stored.expiresAt ||
    stored.expiresAt.getTime() - Date.now() < REFRESH_BUFFER_MS;

  let accessToken = stored.access;

  if (expired) {
    const fresh = await refreshTokens({
      clientId,
      clientSecret,
      refreshToken: stored.refresh,
    });
    accessToken = fresh.access_token;
    await persistTokens({
      access: fresh.access_token,
      refresh: fresh.refresh_token || stored.refresh,
      expiresAt: new Date(Date.now() + fresh.expires_in * 1000),
    });
  }

  return {
    accessToken,
    baseId: stored.baseId,
    tableName: stored.tableName,
  };
}

export async function clearAirtableAuth(): Promise<void> {
  await db
    .update(schema.siteSettings)
    .set({
      airtableAccessToken: null,
      airtableRefreshToken: null,
      airtableTokenExpiresAt: null,
      airtableSyncStatus: "idle",
      airtableLastError: null,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.siteSettings.id, "main"));
}

export async function saveAirtableConfig(
  baseId: string | null,
  tableName: string | null,
): Promise<void> {
  await db
    .update(schema.siteSettings)
    .set({
      airtableBaseId: baseId,
      airtableTableName: tableName,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.siteSettings.id, "main"));
}

export type AirtableStatus = {
  connected: boolean;
  baseId: string | null;
  tableName: string | null;
  syncStatus: string;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export async function getAirtableStatus(): Promise<AirtableStatus> {
  const rows = await db
    .select({
      refresh: schema.siteSettings.airtableRefreshToken,
      baseId: schema.siteSettings.airtableBaseId,
      tableName: schema.siteSettings.airtableTableName,
      syncStatus: schema.siteSettings.airtableSyncStatus,
      lastSyncedAt: schema.siteSettings.airtableLastSyncedAt,
      lastError: schema.siteSettings.airtableLastError,
    })
    .from(schema.siteSettings)
    .where(eq(schema.siteSettings.id, "main"));
  const r = rows[0];
  return {
    connected: !!r?.refresh,
    baseId: r?.baseId ?? null,
    tableName: r?.tableName ?? null,
    syncStatus: r?.syncStatus ?? "idle",
    lastSyncedAt: r?.lastSyncedAt ? r.lastSyncedAt.toISOString() : null,
    lastError: r?.lastError ?? null,
  };
}
