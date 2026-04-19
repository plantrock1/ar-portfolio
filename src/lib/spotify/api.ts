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
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Spotify ${path} ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
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
