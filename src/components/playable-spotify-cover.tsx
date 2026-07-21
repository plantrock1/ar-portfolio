"use client";

import { useState } from "react";

// Facade for the Spotify embed player. By default we render just the
// album cover in the same 1:1 square as every other release tile — no
// Spotify branding, no 232px-tall iframe breaking the grid. On click,
// swap to the actual Spotify embed and let it autoplay. Keeps the
// initial page render cheap (no iframes at all) and keeps the visual
// aesthetic consistent with upcoming cards.
export function PlayableSpotifyCover({
  albumSpotifyId,
  coverImageUrl,
  title,
}: {
  albumSpotifyId: string;
  coverImageUrl: string | null;
  title: string;
}) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <div className="w-full">
        <iframe
          src={`https://open.spotify.com/embed/album/${albumSpotifyId}?theme=0&autoplay=1`}
          title={title}
          className="w-full h-[152px] border-0 rounded-t-xl"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      className="relative w-full block rounded-t-xl overflow-hidden bg-neutral-900 group/play focus:outline-none focus:ring-2 focus:ring-white/30"
      style={{ aspectRatio: "1 / 1" }}
      aria-label={`Play ${title} on Spotify`}
    >
      {coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coverImageUrl}
          alt={title}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover/play:scale-[1.02]"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-800 via-neutral-900 to-black" />
      )}

      {/* Play affordance: subtle dark overlay + centered play glyph on
          hover / focus, so the cover stays clean at rest. */}
      <div className="absolute inset-0 bg-black/0 group-hover/play:bg-black/30 transition-colors flex items-center justify-center">
        <div className="opacity-0 group-hover/play:opacity-100 transition-opacity duration-150 rounded-full bg-white/95 w-14 h-14 flex items-center justify-center shadow-2xl">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="black"
            aria-hidden="true"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
    </button>
  );
}
