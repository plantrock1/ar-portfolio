import { db, schema } from "@/lib/db";
import { scrapeArtists } from "@/lib/spotify/scrape";
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
  const scraped = await scrapeArtists(spotifyIds, { concurrency: 3 });
  const byId = new Map(scraped.map((s) => [s.spotifyId, s]));

  let scrapeHits = 0;
  let scrapeMisses = 0;
  let tracksRefreshed = 0;

  for (const row of roster) {
    const s = byId.get(row.spotifyId);
    if (!s || s.monthlyListeners === null) {
      console.warn(`[refresh] scrape miss for ${row.name} (${row.spotifyId}): ${s?.error ?? "no data"}`);
      scrapeMisses += 1;
      continue;
    }
    scrapeHits += 1;

    await db.insert(schema.artistSnapshots).values({
      artistId: row.id,
      followers: null,
      monthlyListeners: s.monthlyListeners,
      popularity: null,
    });

    // Sync top tracks
    if (s.tracks.length > 0) {
      const existingTracks = await db
        .select()
        .from(schema.tracks)
        .where(eq(schema.tracks.artistId, row.id));
      const existingBySpotify = new Map(
        existingTracks.map((t) => [t.spotifyId, t]),
      );
      const keepIds = new Set(
        s.tracks.map((t) => t.spotifyId).filter(Boolean) as string[],
      );

      for (const t of s.tracks) {
        if (!t.spotifyId) continue;
        try {
          const existing = existingBySpotify.get(t.spotifyId);
          let trackId: string;
          if (existing) {
            await db
              .update(schema.tracks)
              .set({
                name: t.name,
                albumImageUrl: t.albumImageUrl ?? existing.albumImageUrl ?? null,
              })
              .where(eq(schema.tracks.id, existing.id));
            trackId = existing.id;
          } else {
            const [inserted] = await db
              .insert(schema.tracks)
              .values({
                spotifyId: t.spotifyId,
                artistId: row.id,
                name: t.name,
                albumImageUrl: t.albumImageUrl ?? null,
              })
              .returning();
            trackId = inserted.id;
          }
          await db.insert(schema.trackSnapshots).values({
            trackId,
            streams: t.streams,
            popularity: null,
          });
          tracksRefreshed += 1;
        } catch (e) {
          console.error(`[refresh] track insert failed for ${t.spotifyId} (${t.name}):`, e);
        }
      }

      // Remove tracks no longer in top list (unless pinned)
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
