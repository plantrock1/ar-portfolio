"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArtistCard } from "@/components/artist-card";
import type { ArtistWithLatest, RosterSort } from "@/lib/queries";

const LS_KEY = "ar-roster-density";

export function RosterGrid({
  roster,
  sortBy,
}: {
  roster: ArtistWithLatest[];
  sortBy: RosterSort;
}) {
  // Start in "comfortable" (big cards) for SSR parity; pick up the user's
  // saved preference after hydration.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored === "compact") setCompact(true);
    } catch {
      // localStorage unavailable (SSR / private mode) — ignore
    }
  }, []);

  function toggleCompact(next: boolean) {
    setCompact(next);
    try {
      localStorage.setItem(LS_KEY, next ? "compact" : "comfortable");
    } catch {}
  }

  return (
    <>
      <div className="flex items-baseline justify-between mb-10 gap-4 flex-wrap">
        <h2 className="display text-3xl md:text-4xl text-white">Roster</h2>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Sort pill */}
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest rounded-full border border-white/10 p-1">
            <Link
              href="/"
              scroll={false}
              className={`px-3 py-1 rounded-full transition-colors ${
                sortBy === "listeners"
                  ? "bg-white text-black"
                  : "text-white/50 hover:text-white"
              }`}
            >
              Monthly listeners
            </Link>
            <Link
              href="/?sort=alpha"
              scroll={false}
              className={`px-3 py-1 rounded-full transition-colors ${
                sortBy === "alpha"
                  ? "bg-white text-black"
                  : "text-white/50 hover:text-white"
              }`}
            >
              A–Z
            </Link>
          </div>
          {/* Density toggle */}
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest rounded-full border border-white/10 p-1">
            <button
              type="button"
              onClick={() => toggleCompact(false)}
              className={`px-3 py-1 rounded-full transition-colors ${
                !compact
                  ? "bg-white text-black"
                  : "text-white/50 hover:text-white"
              }`}
              aria-pressed={!compact}
            >
              Large
            </button>
            <button
              type="button"
              onClick={() => toggleCompact(true)}
              className={`px-3 py-1 rounded-full transition-colors ${
                compact
                  ? "bg-white text-black"
                  : "text-white/50 hover:text-white"
              }`}
              aria-pressed={compact}
            >
              Compact
            </button>
          </div>
          <span className="text-xs uppercase tracking-widest text-white/40">
            {roster.length} {roster.length === 1 ? "artist" : "artists"}
          </span>
        </div>
      </div>

      {roster.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-12 text-center text-white/50">
          No artists added yet. Head to{" "}
          <a href="/admin" className="underline text-white/80">
            /admin
          </a>{" "}
          to add the first one.
        </div>
      ) : (
        <div
          className={
            compact
              ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3"
              : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
          }
        >
          {roster.map((a) => (
            <ArtistCard
              key={a.id}
              slug={a.slug}
              name={a.name}
              imageUrl={a.imageUrl}
              role={a.role}
              monthlyListeners={a.latest.monthlyListeners}
              compact={compact}
            />
          ))}
        </div>
      )}
    </>
  );
}
