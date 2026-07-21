import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { getLatestRelease } from "@/lib/spotify/api";
import { desc, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Refreshes the cached "most recent release" per artist by hitting the
// Spotify Web API. Called by a Vercel Cron (daily) on release-mode
// deployments; also usable manually via GET with CRON_SECRET.
//
// This is deliberately much lighter than the analytics-side refresh — no
// puppeteer, no scraping, just API calls. Whole roster of ~20 artists
// finishes in a few seconds well inside the Vercel 60s function limit.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 500 });
  }
  if (auth !== `Bearer ${secret}`) {
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
