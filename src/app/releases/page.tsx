import { unstable_cache } from "next/cache";
import {
  getReleaseRoster,
  getSiteSettings,
  type ReleaseSort,
} from "@/lib/queries";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { SocialIcons } from "@/components/social-icons";
import { ReleaseRoster } from "@/components/release-roster";

// Dynamic render — the DB isn't reachable at build time on Vercel for a
// fresh deploy (no roster yet, and the schema drift check would run first
// anyway). unstable_cache still caches results for 60s across requests.
export const dynamic = "force-dynamic";

// Reuses the same 60s ISR + unstable_cache pattern as the analytics home
// page. Sort is part of the cache key so switching between orderings
// doesn't collide.
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
          <ReleaseRoster roster={roster} sortBy={sortBy} />
        </section>
      </main>
      <SiteFooter
        displayName={settings.displayName}
        roleTitle={settings.roleTitle}
      />
    </>
  );
}
