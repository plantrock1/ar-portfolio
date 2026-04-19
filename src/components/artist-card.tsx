import Image from "next/image";
import Link from "next/link";
import { formatNumber } from "@/lib/utils";

type Props = {
  slug: string;
  name: string;
  imageUrl: string | null;
  role?: string | null;
  followers: number | null;
  monthlyListeners: number | null;
};

export function ArtistCard({
  slug,
  name,
  imageUrl,
  role,
  followers,
  monthlyListeners,
}: Props) {
  return (
    <Link
      href={`/artist/${slug}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] transition hover:border-white/15 hover:bg-white/[0.04]"
    >
      <div className="relative aspect-square w-full bg-neutral-900">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={name}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            className="object-cover grayscale-[15%] transition duration-500 group-hover:grayscale-0 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-neutral-800 to-neutral-950" />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
      </div>
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="display text-xl text-white truncate">{name}</h3>
          {role ? (
            <span className="shrink-0 text-[10px] uppercase tracking-widest text-white/40">
              {role}
            </span>
          ) : null}
        </div>
        <div className="flex items-baseline gap-6 text-sm">
          <div className="flex flex-col">
            <span className="text-white/40 text-[10px] uppercase tracking-widest">
              Monthly
            </span>
            <span className="text-white/90">{formatNumber(monthlyListeners)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-white/40 text-[10px] uppercase tracking-widest">
              Followers
            </span>
            <span className="text-white/90">{formatNumber(followers)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
