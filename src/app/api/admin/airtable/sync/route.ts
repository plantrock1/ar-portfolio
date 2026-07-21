import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { syncUpcomingReleases } from "@/lib/airtable/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function markSyncing() {
  await db
    .update(schema.siteSettings)
    .set({
      airtableSyncStatus: "syncing",
      airtableLastError: null,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.siteSettings.id, "main"));
}

async function markError(message: string) {
  await db
    .update(schema.siteSettings)
    .set({
      airtableSyncStatus: "error",
      airtableLastError: message,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.siteSettings.id, "main"));
}

export async function POST() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await markSyncing();
  try {
    const result = await syncUpcomingReleases();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "sync failed";
    await markError(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
