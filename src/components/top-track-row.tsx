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
    <div className="relative flex items-center gap-4 px-4 py-4 hover:bg-white/[0.04] transition-colors">
      <a
        href={`https://open.spotify.com/track/${spotifyId}`}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${name} on Spotify`}
        className="absolute inset-0"
      />
      <span className="display w-8 text-center text-2xl text-white/30 tabular-nums">
        {index + 1}
      </span>
      {albumImageUrl ? (
        <Image
          src={albumImageUrl}
          alt={name}
          width={48}
          height={48}
          className="rounded"
        />
      ) : (
        <div className="w-12 h-12 rounded bg-neutral-800" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-white truncate">{name}</div>
        <Link
          href={`/artist/${artistSlug}`}
          className="relative z-10 text-xs text-white/50 hover:text-white transition-colors truncate inline-block"
        >
          {artistName}
        </Link>
      </div>
      <div className="flex items-center gap-2 text-sm tabular-nums">
        <span className="text-white/90">{formatNumber(streams)}</span>
        <span className="text-white/30 text-xs">plays</span>
      </div>
      <span className="text-xs text-white/30 pl-2">↗</span>
    </div>
  );
}
