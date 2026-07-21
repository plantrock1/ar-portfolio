import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * When Airtable stores release titles as "Artist Name - Track Title" (or
 * variations), strip the leading artist name + separator so the release
 * card doesn't duplicate what the site already shows next to it. Case-
 * insensitive; recognizes common separators (hyphen, en-dash, em-dash,
 * colon, pipe). Returns the original title if no prefix matches.
 */
export function stripLeadingArtist(
  title: string,
  artistName: string,
): string {
  const trimmed = title.trim();
  const artist = artistName.trim();
  if (!artist) return trimmed;
  const separators = [" - ", " – ", " — ", ": ", " | "];
  const lowerTitle = trimmed.toLowerCase();
  const lowerArtist = artist.toLowerCase();
  for (const sep of separators) {
    const prefix = lowerArtist + sep;
    if (lowerTitle.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return trimmed;
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 10_000) return (n / 1_000).toFixed(0) + "K";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

export function formatFullNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64);
}

export function parseSpotifyArtistId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) return trimmed;
  const urlMatch = trimmed.match(
    /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?artist\/([a-zA-Z0-9]{22})/,
  );
  if (urlMatch) return urlMatch[1];
  const uriMatch = trimmed.match(/^spotify:artist:([a-zA-Z0-9]{22})$/);
  if (uriMatch) return uriMatch[1];
  return null;
}

export function parseSpotifyTrackId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) return trimmed;
  const urlMatch = trimmed.match(
    /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([a-zA-Z0-9]{22})/,
  );
  if (urlMatch) return urlMatch[1];
  const uriMatch = trimmed.match(/^spotify:track:([a-zA-Z0-9]{22})$/);
  if (uriMatch) return uriMatch[1];
  return null;
}
