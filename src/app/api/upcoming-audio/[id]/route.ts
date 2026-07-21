import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getValidAirtableAuth } from "@/lib/airtable/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fresh-URL proxy for upcoming-release audio previews.
//
// Airtable attachment URLs are short-lived signed URLs (currently ~2h), so
// caching the URL in our DB would break audio playback for viewers who
// arrive later. Instead, we store just the attachment ID at sync time and
// re-fetch the fresh URL on each play through this endpoint, then 302
// redirect the browser to that fresh URL.
//
// The endpoint is public (no admin auth) — anyone visiting the release
// page should be able to hear the preview. Validation guards against
// arbitrary Airtable content: we only serve attachments whose ID matches
// what's stored on this upcoming_release row.
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
  if (!row || !row.audioAttachmentId) {
    return NextResponse.json({ error: "no audio" }, { status: 404 });
  }

  let auth;
  try {
    auth = await getValidAirtableAuth();
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "Airtable auth unavailable",
      },
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

  // Walk every field value looking for our attachment ID. This avoids
  // hard-coding which field the audio lives in — the sync only stored
  // the attachment ID, not the field name.
  let freshUrl: string | null = null;
  for (const val of Object.values(data.fields ?? {})) {
    if (!Array.isArray(val)) continue;
    for (const att of val) {
      if (
        att &&
        typeof att === "object" &&
        "id" in att &&
        (att as { id?: unknown }).id === row.audioAttachmentId &&
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

  // 302 so <audio> follows to the actual signed URL. Modern browsers
  // will send Range requests to the redirected URL for seeking, so the
  // proxy is one-hop per play, not per byte-range.
  return NextResponse.redirect(freshUrl, 302);
}
