import {
  getRoster,
  getAggregate,
  getTopTracksOverall,
  getSiteSettings,
  getFeaturedItems,
  type RosterSort,
} from "@/lib/queries";
import { RosterGrid } from "@/components/roster-grid";
import { FeaturedGrid } from "@/components/featured-grid";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { Stat } from "@/components/stat";
import { TopTrackRow } from "@/components/top-track-row";
import { SocialIcons } from "@/components/social-icons";
import { formatFullNumber } from "@/lib/utils";
import type { SectionId } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort } = await searchParams;
  const sortBy: RosterSort = sort === "alpha" ? "alpha" : "listeners";

  const [roster, totals, topTracks, settings, press] = await Promise.all([
    getRoster(sortBy),
    getAggregate(),
    getTopTracksOverall(5),
    getSiteSettings(),
    getFeaturedItems("press"),
  ]);

  const displayName = settings.displayName?.trim() || "A&R Portfolio";

  // Each section renders only when it has content; ordering from site_settings.
  const sections: Record<SectionId, React.ReactNode> = {
    roster: (
      <section className="pt-14 md:pt-20">
        <RosterGrid roster={roster} sortBy={sortBy} />
      </section>
    ),
    top_tracks:
      topTracks.length > 0 ? (
        <section className="pt-14 md:pt-20">
          <div className="flex items-baseline justify-between mb-10">
            <h2 className="display text-3xl md:text-4xl text-white">
              Top tracks
            </h2>
            <span className="text-xs uppercase tracking-widest text-white/40">
              By streams, across the roster
            </span>
          </div>
          <ol className="divide-y divide-white/5 border border-white/5 rounded-xl overflow-hidden">
            {topTracks.map((t, i) => (
              <TopTrackRow
                key={t.spotifyId}
                index={i}
                spotifyId={t.spotifyId}
                name={t.name}
                albumImageUrl={t.albumImageUrl}
                streams={t.streams}
                artistName={t.artistName}
                artistSlug={t.artistSlug}
              />
            ))}
          </ol>
        </section>
      ) : null,
    featured_media:
      press.length > 0 ? (
        <section className="pt-14 md:pt-20">
          <div className="flex items-baseline justify-between mb-10">
            <h2 className="display text-3xl md:text-4xl text-white">
              Featured media
            </h2>
          </div>
          <FeaturedGrid items={press} />
        </section>
      ) : null,
  };

  const visibleSections = settings.sectionOrder
    .map((id) => ({ id, node: sections[id] }))
    .filter((s) => s.node !== null);

  return (
    <>
      <SiteHeader displayName={settings.displayName} />
      <main className="mx-auto w-full max-w-6xl px-6 pb-20">
        <section className="pt-12 pb-12 md:pt-20 md:pb-16">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] md:gap-16 items-start">
            <div>
              <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-white/40 mb-4">
                <span className="inline-block w-6 h-px bg-white/30" />
                A&R Portfolio
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
            <div className="flex flex-col gap-6 mt-10 md:mt-0 md:min-w-[220px]">
              <Stat label="Total artists" value={totals.artistCount} />
              <Stat
                label="Combined monthly listeners"
                value={totals.totalMonthlyListeners}
                sub={
                  totals.totalMonthlyListeners !== null
                    ? formatFullNumber(totals.totalMonthlyListeners)
                    : "Awaiting refresh"
                }
              />
              <Stat
                label="Combined streams"
                value={totals.totalStreams}
                sub={
                  totals.totalStreams !== null
                    ? formatFullNumber(totals.totalStreams)
                    : "Awaiting refresh"
                }
              />
            </div>
          </div>
        </section>

        {visibleSections.map((s, i) => (
          <div key={s.id}>
            {i > 0 ? <div className="divider mt-20" /> : <div className="divider" />}
            {s.node}
          </div>
        ))}
      </main>
      <SiteFooter displayName={settings.displayName} />
    </>
  );
}

