import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getTrack } from "@/lib/spotify/api";
import { parseSpotifyTrackId } from "@/lib/utils";
import { desc, eq } from "drizzle-orm";

export const runtime = "nodejs";

// Manual data entry — a contingency for when scraping fails (anti-bot,
// expired cookie, time crunch). Admins type monthly listeners + top tracks
// directly. Values are written as fresh snapshots, so "newest wins": they
// flow through every query exactly like scraped data, and a later working
// refresh (captured even more recently) would naturally supersede them.

const TrackInput = z.object({
  // Spotify track URL/URI/ID — used to pull album art + ISRC and to dedupe.
  spotifyUrl: z.string().trim().min(1),
  // Admin-provided display name + stream count.
  name: z.string().trim().min(1).max(300),
  streams: z.number().int().min(0).max(100_000_000_000),
});

const Body = z
  .object({
    artistId: z.string().uuid(),
    // Any field is optional; send whichever the admin filled in.
    monthlyListeners: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
    tracks: z.array(TrackInput).max(10).optional(),
    // Total streams for the artist's most recent release (release-mode
    // sites). Nullable so admins can clear a previous manual value.
    latestReleaseStreams: z
      .number()
      .int()
      .min(0)
      .max(100_000_000_000)
      .nullable()
      .optional(),
  })
  .refine(
    (v) =>
      v.monthlyListeners !== undefined ||
      v.tracks !== undefined ||
      v.latestReleaseStreams !== undefined,
    { message: "nothing to save" },
  );

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "bad request" },
      { status: 400 },
    );
  }
  const { artistId, monthlyListeners, tracks, latestReleaseStreams } =
    parsed.data;

  // Confirm the artist exists (and get spotifyId for nothing in particular,
  // but a clean 404 beats a foreign-key explosion).
  const [artist] = await db
    .select()
    .from(schema.artists)
    .where(eq(schema.artists.id, artistId));
  if (!artist) {
    return NextResponse.json({ error: "artist not found" }, { status: 404 });
  }

  // --- Monthly listeners → new artist_snapshots row ---
  if (monthlyListeners !== undefined && monthlyListeners !== null) {
    // Carry forward the most recent followers/popularity so this manual
    // snapshot (now the latest) doesn't blank them out in the roster.
    const [last] = await db
      .select({
        followers: schema.artistSnapshots.followers,
        popularity: schema.artistSnapshots.popularity,
      })
      .from(schema.artistSnapshots)
      .where(eq(schema.artistSnapshots.artistId, artistId))
      .orderBy(desc(schema.artistSnapshots.capturedAt))
      .limit(1);

    await db.insert(schema.artistSnapshots).values({
      artistId,
      monthlyListeners,
      followers: last?.followers ?? null,
      popularity: last?.popularity ?? null,
    });
  }

  // --- Top tracks → upsert tracks + new track_snapshots rows ---
  const trackErrors: string[] = [];
  if (tracks && tracks.length > 0) {
    for (const t of tracks) {
      const spotifyId = parseSpotifyTrackId(t.spotifyUrl);
      if (!spotifyId) {
        trackErrors.push(`"${t.name}": invalid Spotify track URL`);
        continue;
      }

      // Best-effort metadata fetch for album art + ISRC. If Spotify is
      // unreachable (the very situation that prompts manual entry), we
      // still save the track with the admin-provided name + streams.
      let albumImageUrl: string | null = null;
      let isrc: string | null = null;
      let albumName: string | null = null;
      try {
        const meta = await getTrack(spotifyId);
        albumImageUrl = meta.album?.images?.[0]?.url ?? null;
        albumName = meta.album?.name ?? null;
        isrc =
          (meta as unknown as { external_ids?: { isrc?: string } })
            .external_ids?.isrc ?? null;
      } catch {
        // leave metadata null — name + streams still get saved
      }

      // Manual select-then-insert/update (NOT ON CONFLICT). Some databases
      // never got the tracks_artist_spotify_unique constraint applied, so
      // ON CONFLICT would throw "no unique constraint matching" on them.
      // This mirrors how refresh.ts upserts tracks for the same reason.
      const existing = await db
        .select()
        .from(schema.tracks)
        .where(eq(schema.tracks.spotifyId, spotifyId));
      const forArtist = existing.find((x) => x.artistId === artistId);

      let trackId: string;
      if (forArtist) {
        await db
          .update(schema.tracks)
          .set({
            name: t.name,
            // Only overwrite art/isrc/album if we fetched them this time.
            albumImageUrl: albumImageUrl ?? forArtist.albumImageUrl ?? null,
            isrc: isrc ?? forArtist.isrc ?? null,
            albumName: albumName ?? forArtist.albumName ?? null,
            isPrimary: true,
            hidden: false,
          })
          .where(eq(schema.tracks.id, forArtist.id));
        trackId = forArtist.id;
      } else {
        const [inserted] = await db
          .insert(schema.tracks)
          .values({
            spotifyId,
            artistId,
            name: t.name,
            isrc,
            albumName,
            albumImageUrl,
            isPrimary: true,
            hidden: false,
          })
          .returning();
        trackId = inserted.id;
      }

      // New snapshot with the manual stream count — newest wins.
      await db.insert(schema.trackSnapshots).values({
        trackId,
        streams: t.streams,
      });
    }
  }

  // --- Latest release streams (release-mode) ---
  // Sets latest_releases.total_streams for this artist. Only updates the
  // column (not the whole row) so title/date/coverImageUrl etc. captured
  // by the Spotify-side refresh aren't clobbered. No-op if no
  // latest_releases row exists for this artist yet — a later refresh
  // will create it and the number can be entered again.
  if (latestReleaseStreams !== undefined) {
    await db
      .update(schema.latestReleases)
      .set({ totalStreams: latestReleaseStreams })
      .where(eq(schema.latestReleases.artistId, artistId));
  }

  if (trackErrors.length > 0) {
    return NextResponse.json(
      { ok: true, warnings: trackErrors },
      { status: 200 },
    );
  }
  return NextResponse.json({ ok: true });
}
