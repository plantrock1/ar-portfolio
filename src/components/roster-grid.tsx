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
  // Default to compact — denser grid works better on mobile and still reads
  // well on desktop. Viewer can flip to Large; choice persists via localStorage.
  const [compact, setCompact] = useState(true);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored === "large") setCompact(false);
      else if (stored === "compact") setCompact(true);
    } catch {
      // localStorage unavailable (SSR / private mode) — ignore
    }
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
          Roster
        </h2>
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
          {/* Sort pill */}
          <div className="flex items-center gap-0.5 sm:gap-1 text-[10px] sm:text-xs tracking-wide rounded-full border border-white/10 p-0.5 sm:p-1">
            <Link
              href="/"
              scroll={false}
              className={`px-2 py-0.5 sm:px-3 sm:py-1 rounded-full transition-colors ${
                sortBy === "listeners"
                  ? "bg-white/10 text-white"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              <span className="sm:hidden">Listeners</span>
              <span className="hidden sm:inline">Monthly Listeners</span>
            </Link>
            <Link
              href="/?sort=alpha"
              scroll={false}
              className={`px-2 py-0.5 sm:px-3 sm:py-1 rounded-full transition-colors ${
                sortBy === "alpha"
                  ? "bg-white/10 text-white"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              A–Z
            </Link>
          </div>
          {/* Density toggle */}
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
          <span className="hidden md:inline text-xs uppercase tracking-widest text-white/40">
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
