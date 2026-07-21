import Image from "next/image";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import {
  getReleaseRoster,
  getSiteSettings,
  type ReleaseSort,
} from "@/lib/queries";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { SocialIcons } from "@/components/social-icons";

// Dynamic render — the DB isn't reachable at build time on Vercel for a
// fresh deploy (no roster yet, and the schema drift check would run first
// anyway). unstable_cache still caches results for 60s across requests.
export const dynamic = "force-dynamic";

// Reuses the same 60s ISR + unstable_cache pattern as the analytics home
// page (see src/app/page.tsx). Repeat visitors hit the cache instead of
// re-running the queries every render. Sort is part of the cache key so
// switching between orderings doesn't collide.
const getReleaseHomeData = unstable_cache(
  async (sortBy: ReleaseSort) =>
    Promise.all([getReleaseRoster(sortBy), getSiteSettings()]),
  ["release-home-data"],
  { revalidate: 60, tags: ["public-data"] },
);

function parseSort(v: string | undefined): ReleaseSort {
  if (v === "alpha" || v === "listeners") return v;
  return "release";
}

export default async function ReleasesHome({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort } = await searchParams;
  const sortBy = parseSort(sort);
  const [roster, settings] = await getReleaseHomeData(sortBy);
  const displayName = settings.displayName?.trim() || "Releases";

  return (
    <>
      <SiteHeader displayName={settings.displayName} />
      <main className="mx-auto w-full max-w-6xl px-6 pb-20">
        <section className="pt-12 pb-12 md:pt-20 md:pb-16">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] md:gap-16 items-start">
            <div>
              <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-white/40 mb-4">
                <span className="inline-block w-6 h-px bg-white/30" />
                {settings.roleTitle} Releases
              </div>
              <div className="flex items-center gap-5 mb-5">
                {settings.bioPhotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={settings.bioPhotoUrl}
                    alt={displayName}
                    className="w-20 h-20 md:w-24 md:h-24 rounded-full object-cover border border-white/10 shrink-0"
                  />
                ) : null}
                <h1 className="display text-4xl sm:text-5xl md:text-6xl leading-[0.95] text-white">
                  {displayName}
                </h1>
              </div>
              {settings.bio ? (
                <p className="max-w-2xl text-base md:text-lg text-white/60 leading-relaxed whitespace-pre-wrap">
                  {settings.bio}
                </p>
              ) : null}
              <div className="mt-5">
                <SocialIcons socials={settings.socials} />
              </div>
            </div>
          </div>
        </section>

        <div className="divider" />

        <section className="pt-14 md:pt-20">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-8 md:mb-10">
            <h2 className="display text-2xl sm:text-3xl md:text-4xl text-white">
              Roster
            </h2>
            <SortSwitcher current={sortBy} />
          </div>
          {roster.length === 0 ? (
            <p className="text-white/50 text-sm">
              No artists yet. Add them from the admin.
            </p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {roster.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/artist/${a.slug}`}
                    className="group flex items-center gap-4 p-4 rounded-xl border border-white/5 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04] transition"
                  >
                    {a.imageUrl ? (
                      <Image
                        src={a.imageUrl}
                        alt={a.name}
                        width={56}
                        height={56}
                        className="rounded-full w-14 h-14 shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-neutral-800 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-white truncate">{a.name}</div>
                      {/* Compact meta — hidden on hover to make room for
                          the richer expansion below. */}
                      <div className="text-xs text-white/50 truncate mt-0.5 group-hover:hidden">
                        {a.nextUpcoming
                          ? `Upcoming · ${formatDate(a.nextUpcoming.releaseDate)}`
                          : a.latestRelease
                            ? `Latest · ${formatDate(a.latestRelease.releaseDate)}`
                            : "No releases yet"}
                      </div>
                      {/* Expanded on hover — cover thumb + title + date for
                          each release. Upcoming has no real cover (Airtable
                          feed doesn't include art) so we use a subtle
                          placeholder gradient with the artist's initials. */}
                      <div className="hidden group-hover:flex flex-col gap-2 mt-2">
                        {a.nextUpcoming ? (
                          <ReleaseHoverRow
                            label="Upcoming"
                            title={a.nextUpcoming.title}
                            date={a.nextUpcoming.releaseDate}
                            coverImageUrl={null}
                            fallbackInitials={artistInitials(a.name)}
                          />
                        ) : null}
                        {a.latestRelease ? (
                          <ReleaseHoverRow
                            label="Latest"
                            title={a.latestRelease.title}
                            date={a.latestRelease.releaseDate}
                            coverImageUrl={a.latestRelease.coverImageUrl}
                            fallbackInitials={artistInitials(a.name)}
                          />
                        ) : null}
                        {!a.nextUpcoming && !a.latestRelease ? (
                          <div className="text-xs text-white/40">
                            No releases yet
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <span className="text-white/30 text-xs shrink-0">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <SiteFooter
        displayName={settings.displayName}
        roleTitle={settings.roleTitle}
      />
    </>
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

// One release row inside a hover-expanded artist card: small cover thumb
// (or a placeholder gradient if none) + label · date + title.
function ReleaseHoverRow({
  label,
  title,
  date,
  coverImageUrl,
  fallbackInitials,
}: {
  label: string;
  title: string;
  date: string | null;
  coverImageUrl: string | null;
  fallbackInitials: string;
}) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coverImageUrl}
          alt={title}
          className="w-10 h-10 rounded object-cover shrink-0"
        />
      ) : (
        <div className="w-10 h-10 rounded bg-gradient-to-br from-neutral-800 via-neutral-900 to-black flex items-center justify-center text-white/20 text-[10px] display tracking-wider shrink-0">
          {fallbackInitials || "◐"}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-widest text-white/40">
          {label} · {formatDate(date)}
        </div>
        <div className="text-xs text-white/85 truncate">{title}</div>
      </div>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "TBD";
  // Airtable + Spotify both give YYYY-MM-DD. Show as e.g. "Mar 15, 2026".
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

// Sort switcher for release-mode home page. Three toggle pills using
// Next's <Link> so navigation is client-side (SPA transition, no full
// reload, no scroll jump). Data still lives in unstable_cache keyed by
// sort so both variants stay warm.
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
        // Default ("release") uses no query param so its URL stays clean.
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
