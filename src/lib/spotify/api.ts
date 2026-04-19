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
  const out: SpotifyArtist[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const r = await spotify<{ artists: SpotifyArtist[] }>(
      `/artists?ids=${batch.join(",")}`,
    );
    out.push(...r.artists);
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

export async function getTracks(ids: string[]): Promise<SpotifyTrack[]> {
  if (ids.length === 0) return [];
  const out: SpotifyTrack[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const r = await spotify<{ tracks: SpotifyTrack[] }>(
      `/tracks?ids=${batch.join(",")}`,
    );
    out.push(...r.tracks);
  }
  return out;
}
