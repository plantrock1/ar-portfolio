import { db, schema } from "@/lib/db";
import {
  launchBrowser,
  scrapeArtistPages,
  scrapeAlbumsAuthed,
  scrapeTrackStreams,
  checkSession,
  type ScrapedTrack,
} from "@/lib/spotify/scrape";
import {
  getAlbumTracks,
  getAllArtistAlbums,
  getTrackIsrcs,
} from "@/lib/spotify/api";
import {
  getSpotifySession,
  markSessionStatus,
} from "@/lib/spotify/session";
import {
  beginRun,
  updateRun,
  completeRun,
  isCancelRequested,
} from "@/lib/refresh-status";

class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}
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
 *
 * Supports chunked invocation to fit inside Vercel's 60-second function
 * timeout: caller passes {offset, limit} and we only process that slice.
 * When called without opts we process everything in a single call (that's
 * the scheduled-cron path — large rosters may partial-complete if they
 * exceed the timeout, which is acceptable since the next day's cron picks
 * up where this one left off).
 */
export async function runRefresh(
  opts: { offset?: number; limit?: number } = {},
): Promise<
  RefreshReport & { totalInRoster: number; nextOffset: number | null }
> {
  const startedAt = Date.now();
  const session = await getSpotifySession();

  const fullRoster = await db
    .select()
    .from(schema.artists)
    .where(eq(schema.artists.hidden, false));

  const offset = Math.max(0, opts.offset ?? 0);
  const limit =
    opts.limit !== undefined ? Math.max(1, opts.limit) : fullRoster.length;
  const roster = fullRoster.slice(offset, offset + limit);
  const isFirstChunk = offset === 0;
  const isLastChunk = offset + roster.length >= fullRoster.length;
  const nextOffset = isLastChunk ? null : offset + roster.length;

  if (isFirstChunk) await beginRun("shallow", fullRoster.length);

  if (roster.length === 0) {
    if (isLastChunk) await completeRun("done");
    return {
      mode: "shallow",
      artistsRefreshed: 0,
      tracksRefreshed: 0,
      albumsScraped: 0,
      scrapeHits: 0,
      scrapeMisses: 0,
      durationMs: Date.now() - startedAt,
      sessionStatus: session.spDc ? session.status : "absent",
      totalInRoster: fullRoster.length,
      nextOffset,
    };
  }

  try {
    await updateRun({ phase: "artists", message: "Scraping artist pages…" });

    // Guard the whole shallow refresh against a server timeout budget. If
    // we're close to it (e.g., Vercel Hobby's 60s), skip the retry pass so
    // we don't run past the deadline mid-scrape.
    const BUDGET_MS = 55_000; // leave ~5s headroom for DB writes
    const startMs = Date.now();

    const spotifyIds = roster.map((a) => a.spotifyId);
    // Use the session cookie — Spotify's anti-bot serves stripped pages to
    // anonymous fresh sessions, especially at concurrency > 1 from a single
    // IP. Logged-in sessions get full pages reliably.
    let scraped = await scrapeArtistPages(spotifyIds, {
      spDc: session.spDc,
      concurrency: 3,
      skipAlbums: true,
      onOne: async (done, total, r) => {
        if (await isCancelRequested()) throw new CancelledError();
        await updateRun({
          phase: "artists",
          artistIndex: offset + done,
          artistTotal: fullRoster.length,
          message:
            r.monthlyListeners !== null
              ? `Scraped ${offset + done}/${fullRoster.length} · last: ${r.spotifyId.slice(0, 8)}…`
              : `Scraped ${offset + done}/${fullRoster.length} (miss on ${r.spotifyId.slice(0, 8)}…)`,
        });
      },
    });

    // Retry the ones that came back empty. Strict budget: we only retry up
    // to MAX_RETRY_IDS artists, and only if we can squeeze them into what's
    // left of the 55s chunk window. Better to miss a few and return cleanly
    // than blow the function timeout and return nothing.
    const misses = scraped.filter((s) => s.monthlyListeners === null);
    const elapsed = Date.now() - startMs;
    const remaining = BUDGET_MS - elapsed;
    const MAX_RETRY_IDS = 2;
    const PER_RETRY_BUDGET = 14_000; // page load + 12s hydration + 2s slack
    const maxFits = Math.max(0, Math.floor(remaining / PER_RETRY_BUDGET));
    const retryCount = Math.min(misses.length, MAX_RETRY_IDS, maxFits);

    if (retryCount > 0) {
      await updateRun({
        message: `Retrying ${retryCount} slow artist${retryCount === 1 ? "" : "s"}…`,
      });
      const retryIds = misses.slice(0, retryCount).map((m) => m.spotifyId);
      const retried = await scrapeArtistPages(retryIds, {
        spDc: session.spDc,
        concurrency: 2,
        skipAlbums: true,
        listenerTimeoutMs: 12_000,
      });
      const retriedById = new Map(retried.map((s) => [s.spotifyId, s]));
      scraped = scraped.map((s) => {
        const r = retriedById.get(s.spotifyId);
        return r && r.monthlyListeners !== null ? r : s;
      });
    }
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

    if (isLastChunk) await completeRun("done");
    return {
      mode: "shallow",
      artistsRefreshed: roster.length,
      tracksRefreshed: tracksUpserted,
      albumsScraped: 0,
      scrapeHits,
      scrapeMisses,
      durationMs: Date.now() - startedAt,
      sessionStatus: session.spDc ? session.status : "absent",
      totalInRoster: fullRoster.length,
      nextOffset,
    };
  } catch (e) {
    if (e instanceof CancelledError) {
      await completeRun("cancelled");
      return {
        mode: "shallow",
        artistsRefreshed: 0,
        tracksRefreshed: 0,
        albumsScraped: 0,
        scrapeHits: 0,
        scrapeMisses: 0,
        durationMs: Date.now() - startedAt,
        sessionStatus: session.spDc ? session.status : "absent",
        totalInRoster: fullRoster.length,
        nextOffset: null,
      };
    }
    await completeRun(
      "failed",
      e instanceof Error ? e.message : String(e),
    );
    throw e;
  }
}


/**
 * Exhaustive shallow refresh — runs multiple patient passes until every
 * artist has been successfully scraped (or we hit the max-pass ceiling).
 * Designed for GitHub Actions runners where there's no 60-second timeout:
 * we can afford long listener-wait timeouts and serial retries.
 */
export async function runShallowRefreshFull(): Promise<RefreshReport> {
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
    // Collect the best result we've seen per artist. Multiple passes with
    // progressively patient settings — if pass N lands all artists, later
    // passes have nothing to do. Realistically expect ~95%+ on pass 1,
    // 99%+ on pass 2, 100% on pass 3 on a cooperative network.
    const bestResult = new Map<string, import("@/lib/spotify/scrape").ScrapedArtistPage>();
    let remaining = roster.map((a) => a.spotifyId);

    const passes: { concurrency: number; listenerTimeoutMs: number; pauseMs: number }[] = [
      { concurrency: 3, listenerTimeoutMs: 10_000, pauseMs: 0 },
      { concurrency: 2, listenerTimeoutMs: 15_000, pauseMs: 5_000 },
      { concurrency: 1, listenerTimeoutMs: 20_000, pauseMs: 15_000 },
    ];

    for (let i = 0; i < passes.length && remaining.length > 0; i += 1) {
      const { concurrency, listenerTimeoutMs, pauseMs } = passes[i];
      if (pauseMs > 0) {
        await updateRun({
          phase: "artists",
          message: `Cooling off ${Math.round(pauseMs / 1000)}s before pass ${i + 1}…`,
        });
        await new Promise((r) => setTimeout(r, pauseMs));
      }
      await updateRun({
        phase: "artists",
        message: `Pass ${i + 1}: scraping ${remaining.length} artist${remaining.length === 1 ? "" : "s"} (concurrency ${concurrency})`,
      });

      const passResults = await scrapeArtistPages(remaining, {
        spDc: session.spDc,
        concurrency,
        skipAlbums: true,
        listenerTimeoutMs,
        onOne: async (done, total, r) => {
          if (await isCancelRequested()) throw new CancelledError();
          if (r.monthlyListeners !== null) bestResult.set(r.spotifyId, r);
          const landedSoFar = bestResult.size;
          await updateRun({
            phase: "artists",
            artistIndex: landedSoFar,
            artistTotal: roster.length,
            message: `Pass ${i + 1} · ${done}/${total} · ${landedSoFar}/${roster.length} landed`,
          });
        },
      });

      // Next pass only retries the ones we haven't landed yet.
      const landedIds = new Set(bestResult.keys());
      remaining = passResults
        .map((r) => r.spotifyId)
        .filter((id) => !landedIds.has(id));
    }

    // Persist everything we got across all passes.
    let scrapeHits = 0;
    let tracksUpserted = 0;
    for (const row of roster) {
      const s = bestResult.get(row.spotifyId);
      if (!s) continue;
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
          console.error(`[full-shallow] track upsert failed ${t.spotifyId}:`, e);
        }
      }
    }
    const scrapeMisses = roster.length - scrapeHits;

    // Latest-release stream refresh (release-mode).
    //
    // For every artist that has a latest_releases row (populated by
    // /api/cron/refresh-releases hitting the Spotify Web API), fetch the
    // album's track list via API and scrape each track page for stream
    // counts, then write the summed total to latest_releases.total_streams.
    //
    // Gated on sp_dc being present — no cookie means no scraping. On
    // analytics-mode deployments latest_releases is typically empty, so
    // this whole pass no-ops.
    if (session.spDc) {
      try {
        const latestRows = await db.select().from(schema.latestReleases);
        const rosterIds = new Set(roster.map((r) => r.id));
        const eligible = latestRows.filter((r) => rosterIds.has(r.artistId));
        if (eligible.length > 0) {
          await updateRun({
            phase: "latest-streams",
            message: `Fetching stream counts for ${eligible.length} latest release${eligible.length === 1 ? "" : "s"}…`,
          });
          type TrackToScrape = {
            albumArtistId: string;
            trackSpotifyId: string;
          };
          const toScrape: TrackToScrape[] = [];
          for (const rel of eligible) {
            if (await isCancelRequested()) throw new CancelledError();
            try {
              const tracks = await getAlbumTracks(rel.albumSpotifyId);
              for (const t of tracks) {
                toScrape.push({
                  albumArtistId: rel.artistId,
                  trackSpotifyId: t.id,
                });
              }
            } catch (e) {
              console.warn(
                `[shallow] latest-release album track list failed for ${rel.artistId}:`,
                e,
              );
            }
          }
          if (toScrape.length > 0) {
            await updateRun({
              phase: "latest-streams",
              albumsScraped: 0,
              albumsTotal: toScrape.length,
              message: `Fetching streams for ${toScrape.length} track${toScrape.length === 1 ? "" : "s"} across ${eligible.length} release${eligible.length === 1 ? "" : "s"}…`,
            });
            const scraped = await scrapeTrackStreams(
              toScrape.map((t) => t.trackSpotifyId),
              {
                spDc: session.spDc,
                concurrency: 2,
                // Heartbeat + progress + cancel for this phase. Without an
                // onOne the whole track scrape runs silent: the bar freezes,
                // Stop is ignored, and the 20-min stale-run watchdog can flip
                // a live run to "failed". This keeps all three honest.
                onOne: async (done, total, r) => {
                  if (await isCancelRequested()) throw new CancelledError();
                  if (done % 5 === 0 || done === total) {
                    await updateRun({
                      phase: "latest-streams",
                      albumsScraped: done,
                      albumsTotal: total,
                      message: `Latest-release streams ${done}/${total}${r.error ? ` (last error: ${r.error.slice(0, 60)})` : ""}`,
                    });
                  }
                },
              },
            );
            const streamsByTrack = new Map<string, number>();
            for (const s of scraped) {
              if (s.streams !== null)
                streamsByTrack.set(s.spotifyId, s.streams);
            }
            const streamHits = streamsByTrack.size;
            console.log(
              `[shallow] latest-release streams: ${streamHits}/${scraped.length} track pages returned a count`,
            );
            // Sum per artist and update total_streams.
            const totalByArtist = new Map<string, number>();
            for (const t of toScrape) {
              const streams = streamsByTrack.get(t.trackSpotifyId);
              if (streams === undefined) continue;
              totalByArtist.set(
                t.albumArtistId,
                (totalByArtist.get(t.albumArtistId) ?? 0) + streams,
              );
            }
            for (const [artistId, total] of totalByArtist) {
              await db
                .update(schema.latestReleases)
                .set({ totalStreams: total })
                .where(eq(schema.latestReleases.artistId, artistId));
            }
            console.log(
              `[shallow] latest-release total_streams written for ${totalByArtist.size}/${eligible.length} releases`,
            );
          }
        }
      } catch (e) {
        if (e instanceof CancelledError) throw e;
        console.error("[shallow] latest-release stream pass failed:", e);
        // Don't fail the whole shallow refresh over this — the primary
        // monthly-listeners + top-tracks pass already succeeded above.
      }
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
    if (e instanceof CancelledError) {
      await completeRun("cancelled");
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

    // checkSession is a best-effort pre-flight. Some environments (datacenter
    // IPs like GitHub Actions runners) make Spotify serve a slightly different
    // homepage that our "Your Library" sniff misses — even when the cookie is
    // fully valid. So we log a warning but do NOT abort on a negative result.
    // Final source of truth is whether the actual scrape returns data; we
    // flip session status based on hits at the end.
    const check = await checkSession(session.spDc);
    if (!check.authenticated) {
      console.warn(
        "[deep] session pre-check didn't see 'Your Library' — proceeding anyway; will verify via scrape results",
      );
    }

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
    let listedSoFar = 0;
    for (const row of roster) {
      // Heartbeat BEFORE the API call so the watchdog sees activity even if
      // /artists/{id}/albums gets throttled and takes minutes. Without this,
      // a long paginated call on the very first artist could exceed the
      // stale-running window before we write anything else.
      await updateRun({
        artistIndex: listedSoFar,
        message: `Listing albums (${listedSoFar + 1}/${roster.length}) · ${row.name}…`,
      });
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
      listedSoFar += 1;
    }

    // Phase 3: scrape each artist's album pages for track IDs + metadata
    // (album pages don't show per-track plays — we'll fetch those in phase 4
    // via individual track pages).
    const browser = await launchBrowser();
    const allTrackIds: string[] = [];
    try {
      let artistIdx = 0;
      for (const { artist: row, albumIds } of artistAlbums) {
        if (await isCancelRequested()) throw new CancelledError();
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

      // Phase 3.5: fetch ISRC for every discovered track (API call, fast).
      // ISRC lets us dedupe re-releases (single + album + deluxe) of the same
      // recording so "total streams" counts each song once.
      const uniqueTrackIds = Array.from(new Set(allTrackIds));
      await updateRun({
        phase: "isrc",
        message: `Fetching ISRC codes for ${uniqueTrackIds.length} tracks…`,
      });
      try {
        const isrcs = await getTrackIsrcs(uniqueTrackIds);
        for (const row of isrcs) {
          if (row.isrc) {
            await db
              .update(schema.tracks)
              .set({ isrc: row.isrc })
              .where(eq(schema.tracks.spotifyId, row.id));
          }
        }
      } catch (e) {
        console.error("[deep] ISRC fetch failed:", e);
      }

      // Phase 4: visit every track's page to get its actual stream count.
      // This is the only authoritative source beyond the top 10.
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
          if (await isCancelRequested()) throw new CancelledError();
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

      // Final session-status verdict based on actual scrape results. If we
      // pulled data, the cookie is fine; if we got nothing at all, it's dead.
      if (scrapeHits > 0 || streamHits > 0) {
        await markSessionStatus("ok");
      } else {
        await markSessionStatus("expired");
        throw new Error(
          "Spotify session appears dead — no data returned. Re-import sp_dc cookie in /admin.",
        );
      }
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
    if (e instanceof CancelledError) {
      await completeRun("cancelled");
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
