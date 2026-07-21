import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import {
  getArtistBySlug,
  getLatestReleaseFor,
  getSiteSettings,
  getUpcomingReleasesFor,
  type LatestRelease,
  type UpcomingRelease,
} from "@/lib/queries";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { ArtistSocialsRow } from "@/components/artist-socials";
import type { ArtistSocials } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const getArtistBySlugCached = unstable_cache(
  (slug: string) => getArtistBySlug(slug),
  ["release-artist-by-slug"],
  { revalidate: 60, tags: ["public-data"] },
);

const getArtistReleasesData = unstable_cache(
  async (artistId: string) =>
    Promise.all([
      getLatestReleaseFor(artistId),
      getUpcomingReleasesFor(artistId),
      getSiteSettings(),
    ]),
  ["release-artist-data"],
  { revalidate: 60, tags: ["public-data"] },
);

type ReleaseCard = {
  key: string;
  title: string;
  releaseDate: string | null;
  coverImageUrl: string | null;
  spotifyUrl: string | null;
  // Spotify album ID — used to render the in-page Spotify embed player
  // for released items. Absent on upcoming releases.
  albumSpotifyId: string | null;
  // Pre-save / smart link (from Airtable) for upcoming releases so the
  // card can link out to whatever landing page is configured.
  preSaveUrl: string | null;
  albumType: string | null;
  isUpcoming: boolean;
};

export default async function ReleaseArtistPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const artist = await getArtistBySlugCached(slug);
  if (!artist) notFound();

  const [latest, upcoming, settings] = await getArtistReleasesData(artist.id);

  // Merge into one chronological grid: upcoming first (soonest → latest),
  // then the most-recent past release. Upcoming cards are visually distinct
  // (gradient placeholder cover + "Upcoming" badge) since Airtable doesn't
  // supply cover art.
  const cards: ReleaseCard[] = [
    ...upcoming.map(upcomingToCard),
    ...(latest ? [latestToCard(latest)] : []),
  ];

  return (
    <>
      <SiteHeader displayName={settings.displayName} />
      <main className="mx-auto w-full max-w-6xl px-6 pb-24">
        <div className="pt-10 pb-6">
          <Link
            href="/"
            className="text-sm text-white/50 hover:text-white transition-colors"
          >
            ← Roster
          </Link>
        </div>

        <section className="pb-10">
          <div className="flex items-center gap-5 mb-4">
            {artist.imageUrl ? (
              <Image
                src={artist.imageUrl}
                alt={artist.name}
                width={80}
                height={80}
                className="rounded-full w-16 h-16 sm:w-20 sm:h-20"
              />
            ) : (
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-neutral-800" />
            )}
            <div className="min-w-0">
              <h1 className="display text-3xl sm:text-4xl md:text-5xl text-white truncate">
                {artist.name}
              </h1>
              {artist.role ? (
                <div className="text-xs uppercase tracking-widest text-white/40 mt-1">
                  {artist.role}
                </div>
              ) : null}
            </div>
          </div>
          {artist.bio ? (
            <p className="max-w-3xl text-sm md:text-base text-white/60 leading-relaxed whitespace-pre-wrap mt-3">
              {artist.bio}
            </p>
          ) : null}
          <div className="mt-4">
            <ArtistSocialsRow
              socials={(artist.socials ?? {}) as ArtistSocials}
            />
          </div>
        </section>

        <div className="divider" />

        <section className="pt-10">
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="display text-2xl text-white">Releases</h2>
            <span className="text-xs text-white/40">
              {cards.length === 0
                ? "Nothing yet"
                : `${cards.length} · ${upcoming.length} upcoming`}
            </span>
          </div>
          {cards.length === 0 ? (
            <div className="text-sm text-white/40 py-8">
              No releases to show yet. Latest from Spotify appears once the
              release refresh runs; upcoming releases populate from Airtable.
            </div>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {cards.map((c) => (
                <li key={c.key}>
                  <ReleaseCardTile card={c} artistName={artist.name} />
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

function ReleaseCardTile({
  card,
  artistName,
}: {
  card: ReleaseCard;
  artistName: string;
}) {
  // Released items with a Spotify album ID get an in-page Spotify embed
  // player — plays previews directly in the card, or full tracks for
  // viewers logged into Spotify. Upcoming items fall back to the gradient
  // placeholder (nothing to play yet) and link out to a pre-save page if
  // one exists.
  const mediaSlot = card.isUpcoming || !card.albumSpotifyId ? (
    <div
      className="relative w-full bg-neutral-900 rounded-t-xl overflow-hidden"
      style={{ aspectRatio: "1 / 1" }}
    >
      {card.coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={card.coverImageUrl}
          alt={card.title}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <UpcomingPlaceholderCover title={card.title} />
      )}
      {card.isUpcoming ? (
        <div className="absolute top-3 left-3 text-[10px] uppercase tracking-widest text-white bg-black/60 backdrop-blur px-2 py-1 rounded-full border border-white/10">
          Upcoming
        </div>
      ) : null}
    </div>
  ) : (
    <div className="relative w-full rounded-t-xl overflow-hidden">
      <iframe
        src={`https://open.spotify.com/embed/album/${card.albumSpotifyId}?theme=0`}
        title={card.title}
        className="w-full h-[232px] border-0"
        loading="lazy"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      />
    </div>
  );

  const bodyText = (
    <div className="p-4 flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-widest text-white/40">
        {card.isUpcoming
          ? "Coming soon"
          : (card.albumType ?? "Release").toString().toUpperCase()}
      </div>
      <div className="text-white text-sm leading-snug line-clamp-2">
        {card.title}
      </div>
      <div className="text-xs text-white/50 mt-1">
        {formatDate(card.releaseDate)}
        <span className="text-white/30"> · {artistName}</span>
      </div>
    </div>
  );

  // For embedded releases the media slot handles playback — the surrounding
  // wrapper stays a plain <div> so clicks on the iframe controls aren't
  // hijacked by an outer <a>. For non-embedded cards (upcoming or those
  // without a Spotify ID) the outer wrapper is an <a> when we have any
  // URL to send them to (pre-save > spotifyUrl > nothing).
  if (card.albumSpotifyId && !card.isUpcoming) {
    return (
      <div className="group h-full flex flex-col overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04] transition-colors">
        {mediaSlot}
        {bodyText}
      </div>
    );
  }

  const outboundUrl = card.preSaveUrl ?? card.spotifyUrl;
  const inner = (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] transition-colors group-hover:border-white/15 group-hover:bg-white/[0.04]">
      {mediaSlot}
      {bodyText}
    </div>
  );
  if (outboundUrl) {
    return (
      <a
        href={outboundUrl}
        target="_blank"
        rel="noreferrer"
        className="group block h-full"
      >
        {inner}
      </a>
    );
  }
  return <div className="group h-full">{inner}</div>;
}

function UpcomingPlaceholderCover({ title }: { title: string }) {
  // Simple, quiet gradient — deliberately not trying to fake album art.
  // The title is hinted at large-caps in the center, cropped by object-cover.
  const initials = title
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-neutral-800 via-neutral-900 to-black flex items-center justify-center">
      <span className="display text-5xl text-white/20 tracking-widest">
        {initials || "◐"}
      </span>
    </div>
  );
}

function latestToCard(r: LatestRelease): ReleaseCard {
  return {
    key: `latest-${r.albumSpotifyId}`,
    title: r.title,
    releaseDate: r.releaseDate,
    coverImageUrl: r.coverImageUrl,
    spotifyUrl: r.spotifyUrl,
    albumSpotifyId: r.albumSpotifyId,
    preSaveUrl: null,
    albumType: r.albumType,
    isUpcoming: false,
  };
}

function upcomingToCard(r: UpcomingRelease): ReleaseCard {
  return {
    key: `upcoming-${r.id}`,
    title: r.title,
    releaseDate: r.releaseDate,
    coverImageUrl: null,
    spotifyUrl: null,
    albumSpotifyId: null,
    preSaveUrl: r.preSaveUrl,
    albumType: null,
    isUpcoming: true,
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return "Date TBD";
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
