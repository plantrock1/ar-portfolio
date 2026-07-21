import Image from "next/image";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { getReleaseRoster, getSiteSettings } from "@/lib/queries";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { SocialIcons } from "@/components/social-icons";

// Dynamic render — the DB isn't reachable at build time on Vercel for a
// fresh deploy (no roster yet, and the schema drift check would run first
// anyway). unstable_cache still caches results for 60s across requests.
export const dynamic = "force-dynamic";

// Reuses the same 60s ISR + unstable_cache pattern as the analytics home
// page (see src/app/page.tsx). Repeat visitors hit the cache instead of
// re-running the queries every render.
const getReleaseHomeData = unstable_cache(
  async () => Promise.all([getReleaseRoster(), getSiteSettings()]),
  ["release-home-data"],
  { revalidate: 60, tags: ["public-data"] },
);

export default async function ReleasesHome() {
  const [roster, settings] = await getReleaseHomeData();
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
          <h2 className="display text-2xl sm:text-3xl md:text-4xl text-white mb-8 md:mb-10">
            Roster
          </h2>
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
                      <div className="text-xs text-white/50 truncate mt-0.5">
                        {a.nextUpcoming
                          ? `Upcoming · ${formatDate(a.nextUpcoming.releaseDate)}`
                          : a.latestRelease
                            ? `Latest · ${formatDate(a.latestRelease.releaseDate)}`
                            : "No releases yet"}
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
