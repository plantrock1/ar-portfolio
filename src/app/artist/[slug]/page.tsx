import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import {
  getArtistBySlug,
  getArtistHistory,
  getArtistTopTracks,
  getArtistTotalStreams,
  getSiteSettings,
} from "@/lib/queries";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { Stat } from "@/components/stat";
import { GrowthChart } from "@/components/growth-chart";
import { ArtistSocialsRow } from "@/components/artist-socials";
import { formatNumber } from "@/lib/utils";
import type { ArtistSocials } from "@/lib/db/schema";

export const revalidate = 60;

// See note in src/app/page.tsx. Cache the per-artist fetch bundle for
// 60s so repeat views of the same artist don't re-hit the DB on every
// request. Keyed by artist UUID.
const getArtistPageData = unstable_cache(
  async (artistId: string) =>
    Promise.all([
      getArtistHistory(artistId),
      getArtistTopTracks(artistId, 5),
      getArtistTotalStreams(artistId),
      getSiteSettings(),
    ]),
  ["artist-page-data"],
  { revalidate: 60, tags: ["public-data"] },
);

// Slug→artist lookup is small but called on every artist visit; cache it
// separately since it's keyed by slug, not UUID.
const getArtistBySlugCached = unstable_cache(
  (slug: string) => getArtistBySlug(slug),
  ["artist-by-slug"],
  { revalidate: 60, tags: ["public-data"] },
);

function toDayLabel(d: Date) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDuration(ms: number | null) {
  if (!ms) return "—";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default async function ArtistPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const artist = await getArtistBySlugCached(slug);
  if (!artist) notFound();

  const [history, tracks, totalStreams, settings] =
    await getArtistPageData(artist.id);
  const displayName = settings.displayName;

  const latest = history[history.length - 1] ?? null;

  const monthlyListenersSeries = history.map((h) => ({
    day: toDayLabel(h.capturedAt),
    value: h.monthlyListeners !== null ? Number(h.monthlyListeners) : null,
  }));

  return (
    <>
      <SiteHeader displayName={displayName} />
      <main className="mx-auto w-full max-w-6xl px-6 pb-24">
        <div className="pt-10 pb-6">
          <Link
            href="/"
            className="text-sm text-white/50 hover:text-white transition-colors"
          >
            ← All artists
          </Link>
        </div>

        <section className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-10 items-end pb-12">
          <div className="relative aspect-square w-full max-w-[280px] overflow-hidden rounded-xl border border-white/10">
            {artist.imageUrl ? (
              <Image
                src={artist.imageUrl}
                alt={artist.name}
                fill
                sizes="280px"
                className="object-cover"
              />
            ) : (
              <div className="w-full h-full bg-neutral-900" />
            )}
          </div>
          <div className="flex flex-col gap-4">
            {artist.role ? (
              <div className="text-xs uppercase tracking-[0.2em] text-white/40">
                {artist.role}
              </div>
            ) : null}
            <h1 className="display text-5xl md:text-7xl leading-none text-white">
              {artist.name}
            </h1>
            <div className="flex flex-wrap gap-2 pt-2">
              {artist.genres.map((g) => (
                <span
                  key={g}
                  className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60"
                >
                  {g}
                </span>
              ))}
            </div>
            <ArtistSocialsRow socials={artist.socials as ArtistSocials | null} />
            <a
              href={`https://open.spotify.com/artist/${artist.spotifyId}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-2 self-start rounded-full bg-[#1db954] px-4 py-2 text-sm font-medium text-black hover:bg-[#1ed760] transition-colors"
            >
              Open on Spotify ↗
            </a>
          </div>
        </section>

        {artist.bio ? (
          <>
            <div className="divider" />
            <section className="py-12">
              <p className="max-w-3xl text-lg text-white/70 leading-relaxed whitespace-pre-wrap">
                {artist.bio}
              </p>
            </section>
          </>
        ) : null}

        <div className="divider" />

        <section className="py-12">
          <div className="grid grid-cols-2 md:grid-cols-2 gap-10">
            <Stat
              label="Monthly Listeners"
              value={latest?.monthlyListeners ? Number(latest.monthlyListeners) : null}
            />
            <Stat
              label={
                settings.showArtistStreamsNote
                  ? "Total streams (top 5 tracks)"
                  : "Total streams"
              }
              value={totalStreams || null}
            />
          </div>
        </section>

        {settings.showListenerChart ? (
          <>
            <div className="divider" />
            <section className="py-12">
              <h3 className="display text-2xl text-white mb-5">
                Monthly listeners over time
              </h3>
              <GrowthChart
                label="Monthly Listeners"
                data={monthlyListenersSeries}
                color="#1db954"
              />
            </section>
          </>
        ) : null}

        <div className="divider" />

        <section className="pt-12">
          <h3 className="display text-2xl text-white mb-6">Top tracks</h3>
          {tracks.length === 0 ? (
            <div className="text-sm text-white/40">
              No tracks loaded yet — they'll appear after the next refresh.
            </div>
          ) : (
            <div className="divide-y divide-white/5 border border-white/5 rounded-xl overflow-hidden">
              {tracks.map((t, i) => (
                <a
                  key={t.id}
                  href={`https://open.spotify.com/track/${t.spotifyId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.04] transition-colors"
                >
                  <span className="w-6 text-center text-sm text-white/30 tabular-nums">
                    {i + 1}
                  </span>
                  {t.albumImageUrl ? (
                    <Image
                      src={t.albumImageUrl}
                      alt={t.albumName ?? ""}
                      width={40}
                      height={40}
                      className="rounded"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-neutral-800" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{t.name}</div>
                    <div className="text-xs text-white/40 truncate">
                      {t.albumName}
                      {t.releaseDate ? ` · ${t.releaseDate.slice(0, 4)}` : ""}
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 text-xs min-w-28 justify-end tabular-nums">
                    <span className="text-white/80">
                      {t.streams !== null ? formatNumber(t.streams) : "—"}
                    </span>
                    <span className="text-white/30">plays</span>
                  </div>
                  <div className="hidden md:block text-xs text-white/40 tabular-nums w-12 text-right">
                    {formatDuration(t.durationMs)}
                  </div>
                  <span className="text-xs text-white/30 group-hover:text-white/60">↗</span>
                </a>
              ))}
            </div>
          )}
        </section>

        {latest ? (
          <div className="pt-8 text-xs text-white/30">
            Last updated {new Date(latest.capturedAt).toLocaleString()}
          </div>
        ) : null}
      </main>
      <SiteFooter displayName={displayName} roleTitle={settings.roleTitle} />
    </>
  );
}
