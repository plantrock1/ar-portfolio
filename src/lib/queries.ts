import { db, schema } from "@/lib/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";

export type ArtistWithLatest = typeof schema.artists.$inferSelect & {
  latest: {
    followers: number | null;
    monthlyListeners: number | null;
    popularity: number | null;
    capturedAt: Date | null;
  };
};

export async function getRoster(): Promise<ArtistWithLatest[]> {
  const artists = await db
    .select()
    .from(schema.artists)
    .where(eq(schema.artists.hidden, false))
    .orderBy(asc(schema.artists.displayOrder), asc(schema.artists.name));

  if (artists.length === 0) return [];

  const latestByArtist = await db.execute<{
    artist_id: string;
    followers: string;
    monthly_listeners: string | null;
    popularity: number;
    captured_at: Date;
  }>(sql`
    SELECT DISTINCT ON (artist_id)
      artist_id,
      followers,
      monthly_listeners,
      popularity,
      captured_at
    FROM artist_snapshots
    ORDER BY artist_id, captured_at DESC
  `);

  const byArtist = new Map<string, (typeof latestByArtist.rows)[number]>();
  for (const row of latestByArtist.rows) byArtist.set(row.artist_id, row);

  return artists.map((a) => {
    const l = byArtist.get(a.id);
    return {
      ...a,
      latest: {
        followers: l ? Number(l.followers) : null,
        monthlyListeners: l?.monthly_listeners ? Number(l.monthly_listeners) : null,
        popularity: l ? l.popularity : null,
        capturedAt: l ? l.captured_at : null,
      },
    };
  });
}

export async function getArtistBySlug(slug: string) {
  const [artist] = await db
    .select()
    .from(schema.artists)
    .where(eq(schema.artists.slug, slug));
  return artist ?? null;
}

export async function getArtistHistory(artistId: string) {
  return db
    .select({
      capturedAt: schema.artistSnapshots.capturedAt,
      followers: schema.artistSnapshots.followers,
      monthlyListeners: schema.artistSnapshots.monthlyListeners,
      popularity: schema.artistSnapshots.popularity,
    })
    .from(schema.artistSnapshots)
    .where(eq(schema.artistSnapshots.artistId, artistId))
    .orderBy(asc(schema.artistSnapshots.capturedAt));
}

export async function getArtistTracks(artistId: string) {
  const tracks = await db
    .select()
    .from(schema.tracks)
    .where(
      and(
        eq(schema.tracks.artistId, artistId),
        eq(schema.tracks.hidden, false),
      ),
    );

  if (tracks.length === 0) return [];

  const latest = await db.execute<{
    track_id: string;
    streams: string | null;
    popularity: number | null;
    captured_at: Date;
  }>(sql`
    SELECT DISTINCT ON (track_id) track_id, streams, popularity, captured_at
    FROM track_snapshots
    WHERE track_id = ANY(${sql.raw(
      "ARRAY[" + tracks.map((t) => `'${t.id}'::uuid`).join(",") + "]",
    )})
    ORDER BY track_id, captured_at DESC
  `);

  const metaById = new Map<string, { streams: number | null; popularity: number | null }>();
  for (const row of latest.rows) {
    metaById.set(row.track_id, {
      streams: row.streams !== null ? Number(row.streams) : null,
      popularity: row.popularity,
    });
  }

  return tracks
    .map((t) => ({
      ...t,
      streams: metaById.get(t.id)?.streams ?? null,
      popularity: metaById.get(t.id)?.popularity ?? null,
    }))
    .sort((a, b) => (b.streams ?? 0) - (a.streams ?? 0));
}

export type AggregateTotals = {
  artistCount: number;
  totalFollowers: number | null;
  totalMonthlyListeners: number | null;
  totalStreams: number | null;
  asOf: Date | null;
};

export async function getAggregate(): Promise<AggregateTotals> {
  const result = await db.execute<{
    artist_count: string;
    total_followers: string | null;
    total_monthly_listeners: string | null;
    total_streams: string | null;
    as_of: Date | null;
  }>(sql`
    WITH latest_artist AS (
      SELECT DISTINCT ON (s.artist_id)
        s.artist_id,
        s.followers,
        s.monthly_listeners,
        s.captured_at
      FROM artist_snapshots s
      JOIN artists a ON a.id = s.artist_id
      WHERE a.hidden = false
      ORDER BY s.artist_id, s.captured_at DESC
    ),
    latest_track AS (
      -- dedupe by spotify_id so a collab track between two roster artists
      -- is only counted once
      SELECT DISTINCT ON (tr.spotify_id)
        tr.spotify_id,
        ts.streams
      FROM track_snapshots ts
      JOIN tracks tr ON tr.id = ts.track_id
      JOIN artists a ON a.id = tr.artist_id
      WHERE a.hidden = false AND tr.hidden = false
      ORDER BY tr.spotify_id, ts.captured_at DESC
    )
    SELECT
      (SELECT COUNT(*)::text FROM latest_artist) AS artist_count,
      (SELECT SUM(followers)::text FROM latest_artist) AS total_followers,
      (SELECT SUM(monthly_listeners)::text FROM latest_artist) AS total_monthly_listeners,
      (SELECT SUM(streams)::text FROM latest_track) AS total_streams,
      (SELECT MAX(captured_at) FROM latest_artist) AS as_of
  `);
  const row = result.rows[0];
  return {
    artistCount: row ? Number(row.artist_count) : 0,
    totalFollowers: row?.total_followers ? Number(row.total_followers) : null,
    totalMonthlyListeners: row?.total_monthly_listeners
      ? Number(row.total_monthly_listeners)
      : null,
    totalStreams: row?.total_streams ? Number(row.total_streams) : null,
    asOf: row?.as_of ?? null,
  };
}

export async function getAggregateHistory() {
  const result = await db.execute<{
    day: Date;
    total_followers: string;
    total_monthly_listeners: string | null;
  }>(sql`
    WITH daily AS (
      SELECT DISTINCT ON (s.artist_id, date_trunc('day', s.captured_at))
        s.artist_id,
        date_trunc('day', s.captured_at) AS day,
        s.followers,
        s.monthly_listeners
      FROM artist_snapshots s
      JOIN artists a ON a.id = s.artist_id
      WHERE a.hidden = false
      ORDER BY s.artist_id, date_trunc('day', s.captured_at), s.captured_at DESC
    )
    SELECT
      day,
      SUM(followers)::text AS total_followers,
      SUM(monthly_listeners)::text AS total_monthly_listeners
    FROM daily
    GROUP BY day
    ORDER BY day ASC
  `);
  return result.rows.map((r) => ({
    day: r.day,
    totalFollowers: Number(r.total_followers),
    totalMonthlyListeners: r.total_monthly_listeners
      ? Number(r.total_monthly_listeners)
      : null,
  }));
}
