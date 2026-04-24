"use client";

import { useEffect, useState } from "react";

type Item = {
  id: string;
  title: string;
  url: string;
  imageUrl: string | null;
  source: string | null;
};

const LS_KEY = "ar-media-density";

export function FeaturedGrid({ items }: { items: Item[] }) {
  // Default compact (denser grid, smaller cards); viewer can flip to Large.
  const [compact, setCompact] = useState(true);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored === "large") setCompact(false);
      else if (stored === "compact") setCompact(true);
    } catch {}
  }, []);

  function toggleCompact(next: boolean) {
    setCompact(next);
    try {
      localStorage.setItem(LS_KEY, next ? "compact" : "large");
    } catch {}
  }

  return (
    <>
      <div className="flex items-center justify-between mb-8 md:mb-10 gap-2 sm:gap-3">
        <h2 className="display text-2xl sm:text-3xl md:text-4xl text-white shrink-0">
          Featured media
        </h2>
        <div className="flex items-center gap-0.5 sm:gap-1 text-[10px] uppercase tracking-widest rounded-full border border-white/10 p-0.5 sm:p-1">
          <button
            type="button"
            onClick={() => toggleCompact(true)}
            className={`px-2 py-0.5 sm:px-3 sm:py-1 rounded-full transition-colors ${
              compact
                ? "bg-white/10 text-white"
                : "text-white/40 hover:text-white/70"
            }`}
            aria-pressed={compact}
          >
            Compact
          </button>
          <button
            type="button"
            onClick={() => toggleCompact(false)}
            className={`px-2 py-0.5 sm:px-3 sm:py-1 rounded-full transition-colors ${
              !compact
                ? "bg-white/10 text-white"
                : "text-white/40 hover:text-white/70"
            }`}
            aria-pressed={!compact}
          >
            Large
          </button>
        </div>
      </div>
      <div
        className={
          compact
            ? "grid items-start grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3"
            : "grid items-start grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
        }
      >
        {items.map((item) => (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="group flex flex-col self-start overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] transition hover:border-white/15 hover:bg-white/[0.04]"
          >
            <div className="relative w-full bg-neutral-900" style={{ aspectRatio: "16 / 9" }}>
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-[1.02]"
                />
              ) : (
                <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-neutral-800 to-neutral-950" />
              )}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            </div>
            <div className={compact ? "p-2.5 flex flex-col gap-0.5" : "p-4 flex flex-col gap-1"}>
              {item.source ? (
                <div className="text-[10px] uppercase tracking-widest text-white/40">
                  {item.source}
                </div>
              ) : null}
              <div className={compact ? "text-white text-xs leading-snug line-clamp-2" : "text-white text-sm leading-snug line-clamp-3"}>
                {item.title}
              </div>
            </div>
          </a>
        ))}
      </div>
    </>
  );
}
