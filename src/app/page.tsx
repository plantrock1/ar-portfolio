import Image from "next/image";
import Link from "next/link";
import {
  getRoster,
  getAggregate,
  getTopTracksOverall,
  getSiteSettings,
} from "@/lib/queries";
import { ArtistCard } from "@/components/artist-card";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { Stat } from "@/components/stat";
import { formatFullNumber, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [roster, totals, topTracks, settings] = await Promise.all([
    getRoster(),
    getAggregate(),
    getTopTracksOverall(5),
    getSiteSettings(),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-6 pb-20">
        <section className="pt-20 pb-16 md:pt-32 md:pb-24">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-white/40 mb-8">
            <span className="inline-block w-8 h-px bg-white/30" />
            A&R Portfolio
          </div>
          <h1 className="display text-5xl sm:text-6xl md:text-7xl lg:text-8xl leading-[0.95] text-white">
            Alec Veach
          </h1>
          {settings.bio ? (
            <p className="mt-8 max-w-2xl text-lg md:text-xl text-white/60 leading-relaxed whitespace-pre-wrap">
              {settings.bio}
            </p>
          ) : null}
        </section>

        <div className="divider" />

        <section className="py-14 md:py-20">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-10 md:gap-14">
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
              label="Combined streams (across top 5 tracks)"
              value={totals.totalStreams}
              sub={
                totals.totalStreams !== null
                  ? formatFullNumber(totals.totalStreams)
                  : "Awaiting refresh"
              }
            />
          </div>
          {totals.asOf ? (
            <div className="mt-10 text-xs text-white/30">
              Last refreshed{" "}
              {new Date(totals.asOf).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
          ) : null}
        </section>

        <div className="divider" />

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
                  <li
                    key={t.spotifyId}
                    className="flex items-center gap-4 px-4 py-4 hover:bg-white/[0.02]"
                  >
                    <span className="display w-8 text-center text-2xl text-white/30 tabular-nums">
                      {i + 1}
                    </span>
                    {t.albumImageUrl ? (
                      <Image
                        src={t.albumImageUrl}
                        alt={t.name}
                        width={48}
                        height={48}
                        className="rounded"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded bg-neutral-800" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-white truncate">{t.name}</div>
                      <Link
                        href={`/artist/${t.artistSlug}`}
                        className="text-xs text-white/50 hover:text-white transition-colors truncate block"
                      >
                        {t.artistName}
                      </Link>
                    </div>
                    <div className="flex items-center gap-2 text-sm tabular-nums">
                      <span className="text-white/90">
                        {formatNumber(t.streams)}
                      </span>
                      <span className="text-white/30 text-xs">plays</span>
                    </div>
                    <a
                      href={`https://open.spotify.com/track/${t.spotifyId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-white/40 hover:text-white pl-2"
                    >
                      ↗
                    </a>
                  </li>
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
