import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { getLatestRelease } from "@/lib/spotify/api";
import { desc, eq } from "drizzle-orm";
import { isAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Refreshes the cached "most recent release" per artist by hitting the
// Spotify Web API. Dual-auth:
//   1. Vercel Cron / server-to-server -> Bearer CRON_SECRET
//   2. Admin button from the browser -> admin session cookie (isAdmin)
//
// Deliberately much lighter than the analytics-side refresh — no puppeteer,
// no scraping, just API calls. A ~20-artist roster finishes in a few seconds
// well inside the Vercel 60s function limit.
async function isAuthorized(req: Request): Promise<boolean> {
  const cronHeader = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (secret && cronHeader === `Bearer ${secret}`) return true;
  return isAdmin();
}

async function handle(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const artists = await db
    .select()
    .from(schema.artists)
    .orderBy(desc(schema.artists.addedAt));

  let updated = 0;
  let skipped = 0;
  const errors: { name: string; message: string }[] = [];

  for (const a of artists) {
    try {
      const rel = await getLatestRelease(a.spotifyId);
      if (!rel) {
        skipped += 1;
        continue;
      }
      const cover = rel.images?.[0]?.url ?? null;
      const spotifyUrl = `https://open.spotify.com/album/${rel.id}`;
      const [existing] = await db
        .select()
        .from(schema.latestReleases)
        .where(eq(schema.latestReleases.artistId, a.id));
      if (existing) {
        await db
          .update(schema.latestReleases)
          .set({
            albumSpotifyId: rel.id,
            title: rel.name,
            releaseDate: rel.release_date,
            albumType: rel.album_type,
            coverImageUrl: cover,
            spotifyUrl,
            syncedAt: new Date(),
          })
          .where(eq(schema.latestReleases.artistId, a.id));
      } else {
        await db.insert(schema.latestReleases).values({
          artistId: a.id,
          albumSpotifyId: rel.id,
          title: rel.name,
          releaseDate: rel.release_date,
          albumType: rel.album_type,
          coverImageUrl: cover,
          spotifyUrl,
        });
      }
      updated += 1;
    } catch (e) {
      errors.push({
        name: a.name,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    total: artists.length,
    updated,
    skipped,
    errors,
  });
}

// GET works for both Vercel Cron pings and one-off curl testing with the
// Bearer secret. POST is what the admin button uses so it can't be
// triggered by simple link-preview crawls of the URL.
export const GET = handle;
export const POST = handle;
