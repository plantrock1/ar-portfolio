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

  const airtableRes = await fetch(url, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    cache: "no-store",
  });
  if (!airtableRes.ok) {
    return NextResponse.json(
      { error: `Airtable ${airtableRes.status}` },
      { status: 502 },
    );
  }
  const data = (await airtableRes.json()) as {
    fields?: Record<string, unknown>;
  };

  // Resolution passes, in order of precision:
  //   1. Exact attachment-ID match — most precise, best when nothing has
  //      changed in Airtable since last sync.
  //   2. Any attachment in a field whose name matches our cover-keyword
  //      list — handles the case where someone replaced the cover art
  //      (new upload = new attachment ID), so our stored ID is stale.
  //   3. Any attachment on the record (last resort).
  const COVER_FIELD_KEYS = [
    "cover art",
    "album art",
    "artwork",
    "cover",
    "album cover",
    "release art",
    "release artwork",
    "single art",
  ];
  const normalizeFieldName = (k: string) =>
    k
      .trim()
      .toLowerCase()
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const entries = Object.entries(data.fields ?? {});
  let freshUrl: string | null = null;

  // Pass 1: exact ID match
  for (const [, val] of entries) {
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

  // Pass 2: first attachment in a cover-like field
  if (!freshUrl) {
    for (const [fieldName, val] of entries) {
      if (!Array.isArray(val)) continue;
      if (!COVER_FIELD_KEYS.includes(normalizeFieldName(fieldName))) continue;
      for (const att of val) {
        if (
          att &&
          typeof att === "object" &&
          "url" in att &&
          typeof (att as { url?: unknown }).url === "string"
        ) {
          freshUrl = (att as { url: string }).url;
          break;
        }
      }
      if (freshUrl) break;
    }
  }

  if (!freshUrl) {
    return NextResponse.json(
      { error: "no cover attachment found on Airtable record" },
      { status: 404 },
    );
  }

  // Cache the redirect for 1 hour on the browser/CDN. Airtable signed
  // URLs live ~2h so this is safely under that; a viewer hovering the
  // same artist card multiple times only pays the round-trip once.
  const res = NextResponse.redirect(freshUrl, 302);
  res.headers.set("Cache-Control", "public, max-age=3600");
  return res;
}
