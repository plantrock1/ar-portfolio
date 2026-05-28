import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
