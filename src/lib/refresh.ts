import { db, schema } from "@/lib/db";
import { getArtists, getArtistTopTracks } from "@/lib/spotify/api";
import { scrapeMonthlyListeners } from "@/lib/spotify/scrape";
import { eq, inArray } from "drizzle-orm";

export type RefreshReport = {
  artistsRefreshed: number;
  tracksRefreshed: number;
  scrapeHits: number;
  scrapeMisses: number;
  durationMs: number;
};

export async function runRefresh(): Promise<RefreshReport> {
  const startedAt = Date.now();

  const roster = await db
    .select()
    .from(schema.artists)
    .where(eq(schema.artists.hidden, false));

  if (roster.length === 0) {
    return {
      artistsRefreshed: 0,
      tracksRefreshed: 0,
      scrapeHits: 0,
      scrapeMisses: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const spotifyIds = roster.map((a) => a.spotifyId);
  const [apiArtists, scraped] = await Promise.all([
    getArtists(spotifyIds),
    scrapeMonthlyListeners(spotifyIds, { concurrency: 4 }),
  ]);

  const apiById = new Map(apiArtists.map((a) => [a.id, a]));
  const scrapedById = new Map(scraped.map((s) => [s.spotifyId, s]));

  let scrapeHits = 0;
  let scrapeMisses = 0;

  for (const row of roster) {
    const api = apiById.get(row.spotifyId);
    if (!api) continue;

    await db
      .update(schema.artists)
      .set({
        name: api.name,
        genres: api.genres ?? [],
        imageUrl: api.images[0]?.url ?? row.imageUrl ?? null,
      })
      .where(eq(schema.artists.id, row.id));

    const ml = scrapedById.get(row.spotifyId)?.monthlyListeners ?? null;
    if (ml !== null) scrapeHits += 1;
    else scrapeMisses += 1;

    await db.insert(schema.artistSnapshots).values({
      artistId: row.id,
      followers: api.followers.total,
      monthlyListeners: ml,
      popularity: api.popularity,
    });
  }

  // Refresh top tracks for each artist (replace set)
  let tracksRefreshed = 0;
  for (const row of roster) {
    try {
      const top = await getArtistTopTracks(row.spotifyId);
      const keep = top.slice(0, 10);
      const existingTracks = await db
        .select()
        .from(schema.tracks)
        .where(eq(schema.tracks.artistId, row.id));
      const existingBySpotify = new Map(
        existingTracks.map((t) => [t.spotifyId, t]),
      );
      const keepIds = new Set(keep.map((t) => t.id));

      for (const t of keep) {
        const existing = existingBySpotify.get(t.id);
        if (existing) {
          await db
            .update(schema.tracks)
            .set({
              name: t.name,
              albumName: t.album.name,
              albumImageUrl: t.album.images[0]?.url ?? null,
              releaseDate: t.album.release_date,
              durationMs: t.duration_ms,
              explicit: t.explicit,
            })
            .where(eq(schema.tracks.id, existing.id));
          await db.insert(schema.trackSnapshots).values({
            trackId: existing.id,
            popularity: t.popularity,
          });
        } else {
          const [inserted] = await db
            .insert(schema.tracks)
            .values({
              spotifyId: t.id,
              artistId: row.id,
              name: t.name,
              albumName: t.album.name,
              albumImageUrl: t.album.images[0]?.url ?? null,
              releaseDate: t.album.release_date,
              durationMs: t.duration_ms,
              explicit: t.explicit,
            })
            .returning();
          await db.insert(schema.trackSnapshots).values({
            trackId: inserted.id,
            popularity: t.popularity,
          });
        }
        tracksRefreshed += 1;
      }

      // Remove tracks that fell out of top-10 AND aren't pinned
      const toRemove = existingTracks.filter(
        (t) => !keepIds.has(t.spotifyId) && !t.pinned,
      );
      if (toRemove.length) {
        await db
          .delete(schema.tracks)
          .where(
            inArray(
              schema.tracks.id,
              toRemove.map((t) => t.id),
            ),
          );
      }
    } catch (e) {
      console.error(`[refresh] top-tracks failed for ${row.spotifyId}:`, e);
    }
  }

  return {
    artistsRefreshed: roster.length,
    tracksRefreshed,
    scrapeHits,
    scrapeMisses,
    durationMs: Date.now() - startedAt,
  };
}
