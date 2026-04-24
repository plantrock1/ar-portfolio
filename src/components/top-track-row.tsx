"use client";

import Image from "next/image";
import Link from "next/link";
import { formatNumber } from "@/lib/utils";

export function TopTrackRow({
  index,
  spotifyId,
  name,
  albumImageUrl,
  streams,
  artistName,
  artistSlug,
}: {
  index: number;
  spotifyId: string;
  name: string;
  albumImageUrl: string | null;
  streams: number;
  artistName: string;
  artistSlug: string;
}) {
  // "Stretched link" pattern: the row itself is a <div>, an invisible anchor
  // fills the row for Spotify clicks, and the artist Link floats above with
  // z-10. This avoids illegally nesting <a> inside <a>.
  return (
    <div className="relative flex items-center gap-2 sm:gap-4 px-3 sm:px-4 py-3 sm:py-4 hover:bg-white/[0.04] transition-colors">
      <a
        href={`https://open.spotify.com/track/${spotifyId}`}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${name} on Spotify`}
        className="absolute inset-0"
      />
      <span className="display w-6 sm:w-8 text-center text-lg sm:text-2xl text-white/30 tabular-nums shrink-0">
        {index + 1}
      </span>
      {albumImageUrl ? (
        <Image
          src={albumImageUrl}
          alt={name}
          width={48}
          height={48}
          className="rounded w-10 h-10 sm:w-12 sm:h-12 shrink-0"
        />
      ) : (
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded bg-neutral-800 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-white text-sm sm:text-base truncate">{name}</div>
        <Link
          href={`/artist/${artistSlug}`}
          className="relative z-10 text-xs text-white/50 hover:text-white transition-colors truncate inline-block max-w-full"
        >
          {artistName}
        </Link>
      </div>
      <div className="flex items-baseline gap-1 sm:gap-2 text-sm tabular-nums shrink-0">
        <span className="text-white/90">{formatNumber(streams)}</span>
        <span className="hidden sm:inline text-white/30 text-xs">plays</span>
      </div>
      <span className="hidden sm:inline text-xs text-white/30 pl-2 shrink-0">↗</span>
    </div>
  );
}
