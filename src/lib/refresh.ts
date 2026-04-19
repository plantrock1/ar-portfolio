import { db, schema } from "@/lib/db";
import {
  launchBrowser,
  scrapeArtistPages,
  scrapeAlbumsAuthed,
  scrapeTrackStreams,
  checkSession,
  type ScrapedTrack,
} from "@/lib/spotify/scrape";
import { getAllArtistAlbums } from "@/lib/spotify/api";
import {
  getSpotifySession,
  markSessionStatus,
} from "@/lib/spotify/session";
import {
  beginRun,
  updateRun,
  completeRun,
} from "@/lib/refresh-status";
import { eq } from "drizzle-orm";

export type RefreshReport = {
  mode: "shallow" | "deep";
  artistsRefreshed: number;
  tracksRefreshed: number;
  albumsScraped: number;
  scrapeHits: number;
  scrapeMisses: number;
  durationMs: number;
  sessionStatus: "ok" | "expired" | "unknown" | "absent";
};

/**
 * Shallow refresh — artist pages only. Fast daily pass for monthly listeners
 * and top-5 stream counts.
 */
export async function runRefresh(): Promise<RefreshReport> {
  const startedAt = Date.now();
  const session = await getSpotifySession();

  const roster = await db
    .select()
    .from(schema.artists)
    .where(eq(schema.artists.hidden, false));

  await beginRun("shallow", roster.length);

  if (roster.length === 0) {
    await completeRun("done");
    return {
      mode: "shallow",
      artistsRefreshed: 0,
      tracksRefreshed: 0,
      albumsScraped: 0,
      scrapeHits: 0,
      scrapeMisses: 0,
      durationMs: Date.now() - startedAt,
      sessionStatus: session.spDc ? session.status : "absent",
    };
  }

  try {
    await updateRun({ phase: "artists", message: "Scraping artist pages…" });

    const spotifyIds = roster.map((a) => a.spotifyId);
    const scraped = await scrapeArtistPages(spotifyIds, {
      spDc: session.spDc,
      concurrency: 3,
    });
    const byId = new Map(scraped.map((s) => [s.spotifyId, s]));

    let scrapeHits = 0;
    let scrapeMisses = 0;
    let tracksUpserted = 0;

    let i = 0;
    for (const row of roster) {
      i += 1;
      await updateRun({
        phase: "artists",
        artistIndex: i,
        message: `Saving ${row.name} (${i}/${roster.length})`,
      });

      const s = byId.get(row.spotifyId);
      if (!s || s.monthlyListeners === null) {
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

      for (const t of s.tracks) {
        try {
          await upsertTrack(row.id, t);
          tracksUpserted += 1;
        } catch (e) {
          console.error(`[refresh] track upsert failed ${t.spotifyId}:`, e);
        }
      }
      await updateRun({ tracksUpserted });
    }

    await completeRun("done");
    return {
      mode: "shallow",
      artistsRefreshed: roster.length,
      tracksRefreshed: tracksUpserted,
      albumsScraped: 0,
      scrapeHits,
      scrapeMisses,
      durationMs: Date.now() - startedAt,
      sessionStatus: session.spDc ? session.status : "absent",
    };
  } catch (e) {
    await completeRun(
      "failed",
      e instanceof Error ? e.message : String(e),
    );
    throw e;
  }
}

/**
 * Deep refresh — full discography pull. Uses Spotify API for canonical album
 * list (filtered to albums the artist actually owns) + scrapes each album page
 * with the session cookie to extract stream counts.
 */
export async function runDeepRefresh(): Promise<RefreshReport> {
  const startedAt = Date.now();
  const session = await getSpotifySession();

  if (!session.spDc) {
    throw new Error(
      "Deep refresh requires a Spotify session cookie. Paste sp_dc in /admin first.",
    );
  }

  const roster = await db
    .select()
    .from(schema.artists)
    .where(eq(schema.artists.hidden, false));

  await beginRun("deep", roster.length);

  try {
    await updateRun({ phase: "session", message: "Verifying Spotify session…" });

    const check = await checkSession(session.spDc);
    if (!check.authenticated) {
      await markSessionStatus("expired");
      throw new Error(
        "Spotify session expired. Re-import sp_dc cookie in /admin.",
      );
    }
    await markSessionStatus("ok");

    if (roster.length === 0) {
      await completeRun("done");
      return {
        mode: "deep",
        artistsRefreshed: 0,
        tracksRefreshed: 0,
        albumsScraped: 0,
        scrapeHits: 0,
        scrapeMisses: 0,
        durationMs: Date.now() - startedAt,
        sessionStatus: "ok",
      };
    }

    // Phase 1: shallow scrape all artist pages (monthly listeners + top tracks)
    await updateRun({
      phase: "artists",
      message: "Scraping artist pages for monthly listeners…",
    });
    const artistScrapes = await scrapeArtistPages(
      roster.map((a) => a.spotifyId),
      { spDc: session.spDc, concurrency: 3 },
    );
    const artistById = new Map(artistScrapes.map((s) => [s.spotifyId, s]));

    // Phase 2: per-artist album discovery via API, then scrape each album
    let tracksUpserted = 0;
    let albumsScraped = 0;
    let albumsTotalRunning = 0;
    let scrapeHits = 0;
    let scrapeMisses = 0;

    // First pass — discover all albums via API so we know total up front
    await updateRun({
      phase: "discovery",
      message: "Listing albums via Spotify API…",
    });
    const artistAlbums: { artist: typeof roster[number]; albumIds: string[] }[] =
      [];
    for (const row of roster) {
      try {
        const albums = await getAllArtistAlbums(row.spotifyId);
        artistAlbums.push({ artist: row, albumIds: albums.map((a) => a.id) });
        albumsTotalRunning += albums.length;
        await updateRun({
          albumsTotal: albumsTotalRunning,
          message: `Listed ${albums.length} albums for ${row.name}`,
        });
      } catch (e) {
        console.error(`[deep] album list failed for ${row.name}:`, e);
        artistAlbums.push({ artist: row, albumIds: [] });
      }
    }

    // Phase 3: scrape each artist's album pages for track IDs + metadata
    // (album pages don't show per-track plays — we'll fetch those in phase 4
    // via individual track pages).
    const browser = await launchBrowser();
    const allTrackIds: string[] = [];
    try {
      let artistIdx = 0;
      for (const { artist: row, albumIds } of artistAlbums) {
        artistIdx += 1;
        await updateRun({
          phase: "albums",
          artistIndex: artistIdx,
          message: `Discovering tracks · ${row.name} · ${albumIds.length} albums`,
        });

        const s = artistById.get(row.spotifyId);
        if (s && s.monthlyListeners !== null) {
          scrapeHits += 1;
          await db.insert(schema.artistSnapshots).values({
            artistId: row.id,
            followers: null,
            monthlyListeners: s.monthlyListeners,
            popularity: null,
          });
        } else {
          scrapeMisses += 1;
        }

        // Track collector — seeded with artist-page top tracks (these DO
        // include stream counts, saved straight away).
        const byTrack = new Map<string, ScrapedTrack>();
        if (s) for (const t of s.tracks) byTrack.set(t.spotifyId, t);

        if (albumIds.length > 0) {
          // Serial album scrape — for metadata + track ID discovery only.
          let albumsDoneForThis = 0;
          for (const aid of albumIds) {
            const [album] = await scrapeAlbumsAuthed([aid], {
              spDc: session.spDc!,
              browser,
              filterArtistSpotifyId: row.spotifyId,
            });
            if (album) {
              for (const t of album.tracks) {
                const existing = byTrack.get(t.spotifyId);
                if (!existing) {
                  byTrack.set(t.spotifyId, t);
                } else {
                  byTrack.set(t.spotifyId, {
                    ...existing,
                    streams:
                      (t.streams ?? 0) > (existing.streams ?? 0)
                        ? t.streams
                        : existing.streams,
                    isPrimary: existing.isPrimary || t.isPrimary,
                  });
                }
              }
            }
            albumsDoneForThis += 1;
            albumsScraped += 1;
            await updateRun({
              albumsScraped,
              message: `${row.name}: ${albumsDoneForThis}/${albumIds.length} albums discovered`,
            });
            await new Promise((r) => setTimeout(r, 300));
          }
        }

        // Persist each track's metadata (and any streams we already have
        // from the artist page top list). Streams for non-top tracks will
        // arrive in Phase 4 below.
        for (const t of byTrack.values()) {
          try {
            await upsertTrack(row.id, t);
            tracksUpserted += 1;
            allTrackIds.push(t.spotifyId);
          } catch (e) {
            console.error(`[deep] track upsert failed ${t.spotifyId}:`, e);
          }
        }
        await updateRun({ tracksUpserted });
      }

      // Phase 4: visit every track's page to get its actual stream count.
      // This is the only authoritative source beyond the top 10.
      const uniqueTrackIds = Array.from(new Set(allTrackIds));
      await updateRun({
        phase: "tracks",
        albumsScraped: 0,
        albumsTotal: uniqueTrackIds.length,
        message: `Fetching streams for ${uniqueTrackIds.length} tracks…`,
      });

      const streamResults = await scrapeTrackStreams(uniqueTrackIds, {
        spDc: session.spDc!,
        browser,
        concurrency: 2,
        onOne: async (done, total, r) => {
          if (r.streams !== null) {
            // Find all (artist, track) rows for this spotify_id and write
            // a snapshot for each. Multiple roster artists might share a
            // collab track.
            const trackRows = await db
              .select()
              .from(schema.tracks)
              .where(eq(schema.tracks.spotifyId, r.spotifyId));
            for (const tr of trackRows) {
              await db.insert(schema.trackSnapshots).values({
                trackId: tr.id,
                streams: r.streams,
                popularity: null,
              });
            }
          }
          // Always report progress, even on null/error — just skip the write.
          if (done % 5 === 0 || done === total) {
            await updateRun({
              albumsScraped: done,
              albumsTotal: total,
              message: `Streams ${done}/${total}${r.error ? ` (last error: ${r.error.slice(0, 60)})` : ""}`,
            });
          }
        },
      });

      const streamHits = streamResults.filter((r) => r.streams !== null).length;
      const streamMisses = streamResults.length - streamHits;
      await updateRun({
        message: `Streams updated: ${streamHits}/${streamResults.length} succeeded${streamMisses ? ` (${streamMisses} retained prior values)` : ""}`,
      });
    } finally {
      await browser.close().catch(() => {});
    }

    await completeRun("done");
    return {
      mode: "deep",
      artistsRefreshed: roster.length,
      tracksRefreshed: tracksUpserted,
      albumsScraped,
      scrapeHits,
      scrapeMisses,
      durationMs: Date.now() - startedAt,
      sessionStatus: "ok",
    };
  } catch (e) {
    await completeRun(
      "failed",
      e instanceof Error ? e.message : String(e),
    );
    throw e;
  }
}

async function upsertTrack(
  artistId: string,
  t: {
    spotifyId: string;
    name: string;
    streams: number | null;
    albumImageUrl: string | null;
    isPrimary?: boolean;
  },
) {
  const existing = await db
    .select()
    .from(schema.tracks)
    .where(eq(schema.tracks.spotifyId, t.spotifyId));
  const forArtist = existing.find((x) => x.artistId === artistId);

  let trackId: string;
  if (forArtist) {
    await db
      .update(schema.tracks)
      .set({
        name: t.name,
        albumImageUrl: t.albumImageUrl ?? forArtist.albumImageUrl ?? null,
        isPrimary:
          t.isPrimary === undefined ? forArtist.isPrimary : t.isPrimary,
      })
      .where(eq(schema.tracks.id, forArtist.id));
    trackId = forArtist.id;
  } else {
    const [inserted] = await db
      .insert(schema.tracks)
      .values({
        spotifyId: t.spotifyId,
        artistId,
        name: t.name,
        albumImageUrl: t.albumImageUrl ?? null,
        isPrimary: t.isPrimary ?? false,
      })
      .returning();
    trackId = inserted.id;
  }
  // Only write a snapshot if we actually have a stream count. Skipping null
  // writes means a flaky scrape can't zero out a previously-good number —
  // queries keep the last valid snapshot until a new non-null one lands.
  if (t.streams !== null) {
    await db.insert(schema.trackSnapshots).values({
      trackId,
      streams: t.streams,
      popularity: null,
    });
  }
}
