import {
  getRoster,
  getAggregate,
  getTopTracksOverall,
  getSiteSettings,
  getFeaturedItems,
} from "@/lib/queries";
import { ArtistCard } from "@/components/artist-card";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { Stat } from "@/components/stat";
import { TopTrackRow } from "@/components/top-track-row";
import { formatFullNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [roster, totals, topTracks, settings, press] = await Promise.all([
    getRoster(),
    getAggregate(),
    getTopTracksOverall(5),
    getSiteSettings(),
    getFeaturedItems("press"),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-6 pb-20">
        <section className="pt-12 pb-12 md:pt-20 md:pb-16">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] md:gap-16 items-start">
            <div>
              <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-white/40 mb-4">
                <span className="inline-block w-6 h-px bg-white/30" />
                A&R Portfolio
              </div>
              <h1 className="display text-4xl sm:text-5xl md:text-6xl leading-[0.95] text-white">
                Alec Veach
              </h1>
              {settings.bio ? (
                <p className="mt-5 max-w-2xl text-base md:text-lg text-white/60 leading-relaxed whitespace-pre-wrap">
                  {settings.bio}
                </p>
              ) : null}
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

        {press.length > 0 ? (
          <>
            <div className="divider" />
            <section className="pt-14 md:pt-20">
              <div className="flex items-baseline justify-between mb-10">
                <h2 className="display text-3xl md:text-4xl text-white">
                  Featured media
                </h2>
              </div>
              <FeaturedGrid items={press} />
            </section>
          </>
        ) : null}

        <div className="divider mt-20" />

        <section className="pt-14 md:pt-20">
          <div className="flex items-baseline justify-between mb-10">
            <h2 className="display text-3xl md:text-4xl text-white">Roster</h2>
            <span className="text-xs uppercase tracking-widest text-white/40">
              {roster.length} {roster.length === 1 ? "artist" : "artists"}
            </span>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {roster.map((a) => (
                <ArtistCard
                  key={a.id}
                  slug={a.slug}
                  name={a.name}
                  imageUrl={a.imageUrl}
                  role={a.role}
                  monthlyListeners={a.latest.monthlyListeners}
                />
              ))}
            </div>
          )}
        </section>

        {topTracks.length > 0 ? (
          <>
            <div className="divider mt-20" />
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
          </>
        ) : null}

      </main>
      <SiteFooter />
    </>
  );
}

function FeaturedGrid({
  items,
}: {
  items: {
    id: string;
    title: string;
    url: string;
    imageUrl: string | null;
    source: string | null;
  }[];
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {items.map((item) => (
        <a
          key={item.id}
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="group flex flex-col overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] transition hover:border-white/15 hover:bg-white/[0.04]"
        >
          <div className="relative aspect-[16/9] w-full bg-neutral-900">
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt={item.title}
                className="w-full h-full object-cover transition duration-500 group-hover:scale-[1.02]"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-neutral-800 to-neutral-950" />
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          </div>
          <div className="p-4 flex flex-col gap-1">
            {item.source ? (
              <div className="text-[10px] uppercase tracking-widest text-white/40">
                {item.source}
              </div>
            ) : null}
            <div className="text-white text-sm leading-snug">{item.title}</div>
          </div>
        </a>
      ))}
    </div>
  );
}
