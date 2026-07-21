import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getValidAirtableAuth } from "@/lib/airtable/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fresh-URL proxy for upcoming-release cover art.
//
// Airtable attachment URLs are short-lived (~2h). We stored the attachment
// ID at sync time and here fetch the current record from Airtable to get
// a fresh signed URL, then 302 redirect the browser to it. Same pattern
// as /api/upcoming-audio/[id] — see that route for the rationale.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const [row] = await db
    .select()
    .from(schema.upcomingReleases)
    .where(eq(schema.upcomingReleases.id, id));
  if (!row || !row.coverAttachmentId) {
    return NextResponse.json({ error: "no cover" }, { status: 404 });
  }

  let auth;
  try {
    auth = await getValidAirtableAuth();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Airtable auth unavailable" },
      { status: 502 },
    );
  }
  if (!auth.baseId || !auth.tableName) {
    return NextResponse.json(
      { error: "Airtable base/table not configured" },
      { status: 502 },
    );
  }

  const url = `https://api.airtable.com/v0/${encodeURIComponent(
    auth.baseId,
  )}/${encodeURIComponent(auth.tableName)}/${encodeURIComponent(row.airtableRecordId)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: `Airtable ${res.status}` },
      { status: 502 },
    );
  }
  const data = (await res.json()) as {
    fields?: Record<string, unknown>;
  };

  let freshUrl: string | null = null;
  for (const val of Object.values(data.fields ?? {})) {
    if (!Array.isArray(val)) continue;
    for (const att of val) {
      if (
        att &&
        typeof att === "object" &&
        "id" in att &&
        (att as { id?: unknown }).id === row.coverAttachmentId &&
        "url" in att &&
        typeof (att as { url?: unknown }).url === "string"
      ) {
        freshUrl = (att as { url: string }).url;
        break;
      }
    }
    if (freshUrl) break;
  }

  if (!freshUrl) {
    return NextResponse.json(
      { error: "attachment not found on Airtable record" },
      { status: 404 },
    );
  }

  return NextResponse.redirect(freshUrl, 302);
}
