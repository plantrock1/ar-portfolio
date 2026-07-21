"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { LatestRelease, UpcomingRelease } from "@/lib/queries";
import { stripLeadingArtist } from "@/lib/utils";

// Release-mode roster block. Handles:
//  - Client-side search (case-insensitive substring on artist.name)
//  - Sort switcher (server-rendered Link pills; state is URL param)
//  - Compact roster cards with a floating hover popover that shows both
//    releases side-by-side with cover art

type ReleaseSort = "release" | "alpha" | "listeners";

export type ReleaseRosterArtist = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  latestRelease: LatestRelease | null;
  nextUpcoming: UpcomingRelease | null;
};

export function ReleaseRoster({
  roster,
  sortBy,
}: {
  roster: ReleaseRosterArtist[];
  sortBy: ReleaseSort;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((a) => a.name.toLowerCase().includes(q));
  }, [roster, query]);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-8 md:mb-10">
        <h2 className="display text-2xl sm:text-3xl md:text-4xl text-white">
          Roster
        </h2>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <SortSwitcher current={sortBy} />
          <SearchInput value={query} onChange={setQuery} />
        </div>
      </div>

      {roster.length === 0 ? (
        <p className="text-white/50 text-sm">
          No artists yet. Add them from the admin.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-white/40 text-sm">
          No artists match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((a) => (
            <ArtistCard key={a.id} artist={a} />
          ))}
        </ul>
      )}
    </>
  );
}

function ArtistCard({ artist }: { artist: ReleaseRosterArtist }) {
  const initials = artistInitials(artist.name);
  return (
    <li className="group relative">
      <Link
        href={`/artist/${artist.slug}`}
        className="relative flex items-center gap-4 p-4 rounded-xl border border-white/5 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04] transition-colors"
      >
        {artist.imageUrl ? (
          <Image
            src={artist.imageUrl}
            alt={artist.name}
            width={56}
            height={56}
            className="rounded-full w-14 h-14 shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-neutral-800 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-white truncate">{artist.name}</div>
          <div className="text-xs text-white/50 truncate mt-0.5">
            {artist.nextUpcoming
              ? `Upcoming · ${formatDate(artist.nextUpcoming.releaseDate)}`
              : artist.latestRelease
                ? `Latest · ${formatDate(artist.latestRelease.releaseDate)}`
                : "No releases yet"}
          </div>
        </div>
        <span className="text-white/30 text-xs shrink-0">→</span>
      </Link>

      {/* Floating popover — below the card, above other content, smooth fade+slide. */}
      {(artist.nextUpcoming || artist.latestRelease) && (
        <div
          className={
            "pointer-events-none absolute left-0 right-0 top-full mt-2 z-20 " +
            "opacity-0 -translate-y-1 " +
            "group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto " +
            "transition-[opacity,transform] duration-200 ease-out origin-top"
          }
        >
          <div className="rounded-xl border border-white/15 bg-neutral-950/95 backdrop-blur-md shadow-2xl p-3">
            <div className="grid grid-cols-2 gap-3">
              <ReleaseSlot
                label="Upcoming"
                title={
                  artist.nextUpcoming
                    ? stripLeadingArtist(artist.nextUpcoming.title, artist.name)
                    : null
                }
                date={artist.nextUpcoming?.releaseDate ?? null}
                coverImageUrl={null}
                fallbackInitials={initials}
              />
              <ReleaseSlot
                label="Latest"
                title={
                  artist.latestRelease
                    ? stripLeadingArtist(artist.latestRelease.title, artist.name)
                    : null
                }
                date={artist.latestRelease?.releaseDate ?? null}
                coverImageUrl={artist.latestRelease?.coverImageUrl ?? null}
                fallbackInitials={initials}
              />
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

function ReleaseSlot({
  label,
  title,
  date,
  coverImageUrl,
  fallbackInitials,
}: {
  label: string;
  title: string | null;
  date: string | null;
  coverImageUrl: string | null;
  fallbackInitials: string;
}) {
  if (!title) {
    return (
      <div className="flex flex-col gap-2 opacity-40">
        <div
          className="w-full aspect-square rounded-lg bg-neutral-900/60 flex items-center justify-center"
          style={{ aspectRatio: "1 / 1" }}
        >
          <span className="text-white/20 text-xs">—</span>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-white/40">
            {label}
          </div>
          <div className="text-xs text-white/50">None</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div
        className="relative w-full rounded-lg overflow-hidden bg-neutral-900"
        style={{ aspectRatio: "1 / 1" }}
      >
        {coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverImageUrl}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-neutral-800 via-neutral-900 to-black flex items-center justify-center">
            <span className="display text-2xl text-white/25 tracking-widest">
              {fallbackInitials || "◐"}
            </span>
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-widest text-white/40">
          {label} · {formatDate(date)}
        </div>
        <div className="text-xs text-white/85 truncate">{title}</div>
      </div>
    </div>
  );
}

function SortSwitcher({ current }: { current: ReleaseSort }) {
  const options: { key: ReleaseSort; label: string }[] = [
    { key: "release", label: "Upcoming" },
    { key: "listeners", label: "Listeners" },
    { key: "alpha", label: "A–Z" },
  ];
  return (
    <div
      className="flex items-center gap-0.5 sm:gap-1 text-[10px] uppercase tracking-widest rounded-full border border-white/10 p-0.5 sm:p-1"
      role="group"
      aria-label="Sort roster"
    >
      {options.map((o) => {
        const active = o.key === current;
        const href = o.key === "release" ? "/" : `/?sort=${o.key}`;
        return (
          <Link
            key={o.key}
            href={href}
            scroll={false}
            aria-pressed={active}
            className={`px-2 py-0.5 sm:px-3 sm:py-1 rounded-full transition-colors ${
              active
                ? "bg-white/10 text-white"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search roster…"
        className="w-40 sm:w-52 rounded-full border border-white/10 bg-white/[0.03] pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
        aria-label="Search roster"
      />
      <span
        className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-xs"
        aria-hidden="true"
      >
        ⌕
      </span>
    </div>
  );
}

function artistInitials(name: string): string {
  return name
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function formatDate(iso: string | null): string {
  if (!iso) return "TBD";
  const parts = iso.split("-");
  if (parts.length < 2) return iso;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = parts[2] ? Number(parts[2]) : null;
  if (!y || !m) return iso;
  const monthName = new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "short",
  });
  return d ? `${monthName} ${d}, ${y}` : `${monthName} ${y}`;
}
