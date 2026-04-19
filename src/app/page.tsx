import { getRoster, getAggregate } from "@/lib/queries";
import { ArtistCard } from "@/components/artist-card";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { Stat } from "@/components/stat";
import { formatFullNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [roster, totals] = await Promise.all([getRoster(), getAggregate()]);

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
          <p className="mt-8 max-w-2xl text-lg md:text-xl text-white/60 leading-relaxed">
            A&R working with artists across hip-hop, pop, and alternative.
            Below is a live snapshot of the roster I've signed — streams,
            followers, and monthly listeners, pulled daily from Spotify.
          </p>
        </section>

        <div className="divider" />

        <section className="py-14 md:py-20">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-10 md:gap-14">
            <Stat label="Artists" value={totals.artistCount} />
            <Stat
              label="Monthly Listeners"
              value={totals.totalMonthlyListeners}
              sub={
                totals.totalMonthlyListeners !== null
                  ? formatFullNumber(totals.totalMonthlyListeners)
                  : "Awaiting refresh"
              }
            />
            <Stat
              label="Last Refresh"
              value={null}
              sub={
                totals.asOf
                  ? new Date(totals.asOf).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "Never"
              }
            />
          </div>
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
      </main>
      <SiteFooter />
    </>
  );
}
