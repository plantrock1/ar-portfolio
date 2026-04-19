import { db, schema } from "@/lib/db";
import {
  scrapeArtistPages,
  scrapeArtistsDeep,
  checkSession,
} from "@/lib/spotify/scrape";
import {
  getSpotifySession,
  markSessionStatus,
} from "@/lib/spotify/session";
import { eq, inArray } from "drizzle-orm";

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
 * Shallow refresh — artist page only. Fast. Daily cron.
 * Updates monthly listeners + top tracks (with or without cookie).
 */
export async function runRefresh(): Promise<RefreshReport> {
  const startedAt = Date.now();
  const session = await getSpotifySession();

  const roster = await db
    .select()
    .from(schema.artists)
    .where(eq(schema.artists.hidden, false));

  if (roster.length === 0) {
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

  const spotifyIds = roster.map((a) => a.spotifyId);
  const scraped = await scrapeArtistPages(spotifyIds, {
    spDc: session.spDc,
    concurrency: 3,
  });
  const byId = new Map(scraped.map((s) => [s.spotifyId, s]));

  let scrapeHits = 0;
  let scrapeMisses = 0;
  let tracksRefreshed = 0;

  for (const row of roster) {
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
        tracksRefreshed += 1;
      } catch (e) {
        console.error(`[refresh] track upsert failed ${t.spotifyId}:`, e);
      }
    }
  }

  return {
    mode: "shallow",
    artistsRefreshed: roster.length,
    tracksRefreshed,
    albumsScraped: 0,
    scrapeHits,
    scrapeMisses,
    durationMs: Date.now() - startedAt,
    sessionStatus: session.spDc ? session.status : "absent",
  };
}

/**
 * Deep refresh — artist page + every album page → all tracks with plays.
 * Requires an sp_dc cookie (album pages gate play counts to logged-in users).
 * Run from admin button, not daily cron.
 */
export async function runDeepRefresh(): Promise<RefreshReport> {
  const startedAt = Date.now();
  const session = await getSpotifySession();

  if (!session.spDc) {
    throw new Error(
      "Deep refresh requires a Spotify session cookie. Paste sp_dc in /admin first.",
    );
  }

  // Verify cookie still works before committing to the long scrape
  const check = await checkSession(session.spDc);
  if (!check.authenticated) {
    await markSessionStatus("expired");
    throw new Error(
      "Spotify session expired. Re-import sp_dc cookie in /admin.",
    );
  }
  await markSessionStatus("ok");

  const roster = await db
    .select()
    .from(schema.artists)
    .where(eq(schema.artists.hidden, false));

  if (roster.length === 0) {
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

  const spotifyIds = roster.map((a) => a.spotifyId);
  const results = await scrapeArtistsDeep(spotifyIds, {
    spDc: session.spDc,
    concurrency: 4,
  });

  const byId = new Map(results.map((r) => [r.spotifyId, r]));
  let scrapeHits = 0;
  let scrapeMisses = 0;
  let tracksRefreshed = 0;
  let albumsScraped = 0;

  for (const row of roster) {
    const s = byId.get(row.spotifyId);
    if (!s) {
      scrapeMisses += 1;
      continue;
    }
    albumsScraped += s.albumCount;

    if (s.monthlyListeners !== null) {
      scrapeHits += 1;
      await db.insert(schema.artistSnapshots).values({
        artistId: row.id,
        followers: null,
        monthlyListeners: s.monthlyListeners,
        popularity: null,
      });
    }

    for (const t of s.tracks) {
      try {
        await upsertTrack(row.id, t);
        tracksRefreshed += 1;
      } catch (e) {
        console.error(`[deep refresh] track upsert failed ${t.spotifyId}:`, e);
      }
    }
  }

  return {
    mode: "deep",
    artistsRefreshed: roster.length,
    tracksRefreshed,
    albumsScraped,
    scrapeHits,
    scrapeMisses,
    durationMs: Date.now() - startedAt,
    sessionStatus: "ok",
  };
}

async function upsertTrack(
  artistId: string,
  t: {
    spotifyId: string;
    name: string;
    streams: number | null;
    albumImageUrl: string | null;
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
      })
      .returning();
    trackId = inserted.id;
  }
  await db.insert(schema.trackSnapshots).values({
    trackId,
    streams: t.streams,
    popularity: null,
  });
}

// re-export for potential future cleanup usage
export { inArray };
