const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

type CachedToken = { token: string; expiresAt: number };
let cached: CachedToken | null = null;

export async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Spotify credentials missing");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Spotify token ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cached.token;
}

async function spotify<T>(path: string): Promise<T> {
  // Retry 429s with exponential backoff, respecting Retry-After if set.
  // Also retries transient 5xx once. Everything else throws immediately.
  const MAX_ATTEMPTS = 6;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const token = await getAccessToken();
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.ok) return (await res.json()) as T;

    if (res.status === 429) {
      const headerWait = Number(res.headers.get("retry-after") ?? 0);
      // Header is typically seconds. If missing, grow from ~1s → 16s.
      const backoffMs = headerWait > 0
        ? (headerWait + 1) * 1000
        : Math.min(16_000, 1_000 * 2 ** attempt);
      await new Promise((r) => setTimeout(r, backoffMs));
      lastErr = new Error(`Spotify ${path} 429 (waited ${backoffMs}ms)`);
      continue;
    }

    if (res.status >= 500 && attempt < MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      lastErr = new Error(`Spotify ${path} ${res.status}`);
      continue;
    }

    throw new Error(`Spotify ${path} ${res.status}: ${await res.text()}`);
  }
  throw lastErr ?? new Error(`Spotify ${path}: retries exhausted`);
}

export type SpotifyArtist = {
  id: string;
  name: string;
  genres: string[];
  followers: { total: number };
  popularity: number;
  images: { url: string; height: number; width: number }[];
};

export type SpotifyTrack = {
  id: string;
  name: string;
  popularity: number;
  duration_ms: number;
  explicit: boolean;
  album: {
    id: string;
    name: string;
    release_date: string;
    images: { url: string; height: number; width: number }[];
  };
  artists: { id: string; name: string }[];
};

export async function getArtist(spotifyId: string): Promise<SpotifyArtist> {
  return spotify<SpotifyArtist>(`/artists/${spotifyId}`);
}

export async function getArtists(ids: string[]): Promise<SpotifyArtist[]> {
  if (ids.length === 0) return [];
  // Spotify's batch /artists?ids= endpoint 403s for new-app Client Credentials,
  // so we parallelize single-artist lookups instead.
  const out: SpotifyArtist[] = [];
  const concurrency = 6;
  for (let i = 0; i < ids.length; i += concurrency) {
    const chunk = ids.slice(i, i + concurrency);
    const results = await Promise.allSettled(chunk.map((id) => getArtist(id)));
    for (let j = 0; j < results.length; j += 1) {
      const r = results[j];
      if (r.status === "fulfilled") out.push(r.value);
      else console.error(`[spotify] getArtist(${chunk[j]}) failed:`, r.reason);
    }
  }
  return out;
}

export async function getArtistTopTracks(
  spotifyId: string,
  market = "US",
): Promise<SpotifyTrack[]> {
  const r = await spotify<{ tracks: SpotifyTrack[] }>(
    `/artists/${spotifyId}/top-tracks?market=${market}`,
  );
  return r.tracks;
}

export type SpotifyArtistAlbum = {
  id: string;
  name: string;
  album_type: "album" | "single" | "compilation" | "appears_on";
  release_date: string;
  total_tracks: number;
  images: { url: string; height: number; width: number }[];
  artists: { id: string; name: string }[];
};

/**
 * Returns all albums owned by the artist (album + single + compilation groups;
 * excludes "appears_on" which is pollution from features).
 *
 * Note: our stripped Spotify app 400s when we pass limit=N on this endpoint,
 * so we use the default (limit=5) and paginate by offset.
 */
export async function getAllArtistAlbums(
  spotifyId: string,
): Promise<SpotifyArtistAlbum[]> {
  const out: SpotifyArtistAlbum[] = [];
  let offset = 0;
  // Safety cap so we never loop forever on malformed responses.
  for (let i = 0; i < 60; i += 1) {
    const r = await spotify<{
      items: SpotifyArtistAlbum[];
      next: string | null;
      limit: number;
      total: number;
    }>(
      `/artists/${spotifyId}/albums?include_groups=album,single,compilation&offset=${offset}`,
    );
    out.push(...r.items);
    if (!r.next || r.items.length === 0) break;
    offset += r.items.length;
    if (offset >= r.total) break;
  }
  // Dedupe by id (can happen across markets / reissues)
  const seen = new Set<string>();
  return out.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}

export async function getTrack(id: string): Promise<SpotifyTrack> {
  return spotify<SpotifyTrack>(`/tracks/${id}`);
}

export type SpotifyAlbumTrack = {
  id: string;
  name: string;
  duration_ms: number;
  track_number: number;
  artists: { id: string; name: string }[];
};

/**
 * List tracks on an album via the Spotify Web API. Paginates through the
 * /albums/{id}/tracks endpoint (up to 50 per page). Doesn't include play
 * counts — those still require scraping the track page individually.
 */
export async function getAlbumTracks(
  albumId: string,
): Promise<SpotifyAlbumTrack[]> {
  const out: SpotifyAlbumTrack[] = [];
  let offset = 0;
  for (let i = 0; i < 20; i += 1) {
    const r = await spotify<{
      items: SpotifyAlbumTrack[];
      next: string | null;
      total: number;
    }>(`/albums/${albumId}/tracks?limit=50&offset=${offset}`);
    out.push(...r.items);
    if (!r.next || r.items.length === 0) break;
    offset += r.items.length;
    if (offset >= r.total) break;
  }
  return out;
}

/**
 * Most-recent release for an artist — album, single, or compilation. Used
 * by release-mode deployments (SITE_MODE=releases) to populate the "latest
 * release" card on the artist page. Returns null if the artist has no
 * public releases.
 *
 * Spotify sorts /artists/{id}/albums newest-first by default, so pulling
 * just the first page (default limit=5 for our stripped app) gives us the
 * candidate set. We pick the item with the max release_date across album
 * types to be robust against groupings.
 */
export async function getLatestRelease(
  spotifyId: string,
): Promise<SpotifyArtistAlbum | null> {
  const r = await spotify<{ items: SpotifyArtistAlbum[] }>(
    `/artists/${spotifyId}/albums?include_groups=album,single,compilation&limit=10`,
  ).catch(async () =>
    // Some app tiers 400 on limit — retry with default.
    spotify<{ items: SpotifyArtistAlbum[] }>(
      `/artists/${spotifyId}/albums?include_groups=album,single,compilation`,
    ),
  );
  if (!r.items || r.items.length === 0) return null;
  let best: SpotifyArtistAlbum | null = null;
  for (const item of r.items) {
    if (!best || item.release_date > best.release_date) best = item;
  }
  return best;
}

export type TrackIsrc = { id: string; isrc: string | null };

/**
 * Fetch ISRC for a batch of track IDs. Batch endpoint /tracks?ids= is
 * restricted for our stripped app, so we parallelize single-track calls.
 */
export async function getTrackIsrcs(ids: string[]): Promise<TrackIsrc[]> {
  if (ids.length === 0) return [];
  const out: TrackIsrc[] = [];
  const concurrency = 8;
  for (let i = 0; i < ids.length; i += concurrency) {
    const chunk = ids.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map((id) =>
        spotify<{ external_ids?: { isrc?: string } }>(`/tracks/${id}`),
      ),
    );
    for (let j = 0; j < results.length; j += 1) {
      const r = results[j];
      if (r.status === "fulfilled") {
        out.push({ id: chunk[j], isrc: r.value.external_ids?.isrc ?? null });
      } else {
        out.push({ id: chunk[j], isrc: null });
      }
    }
  }
  return out;
}

export async function getTracks(ids: string[]): Promise<SpotifyTrack[]> {
  if (ids.length === 0) return [];
  const out: SpotifyTrack[] = [];
  const concurrency = 6;
  for (let i = 0; i < ids.length; i += concurrency) {
    const chunk = ids.slice(i, i + concurrency);
    const results = await Promise.allSettled(chunk.map((id) => getTrack(id)));
    for (const r of results) if (r.status === "fulfilled") out.push(r.value);
  }
  return out;
}
