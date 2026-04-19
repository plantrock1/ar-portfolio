import type { ArtistSocials } from "@/lib/db/schema";

const ORDER: (keyof ArtistSocials)[] = [
  "instagram",
  "tiktok",
  "twitter",
  "email",
  "soundcloud",
  "website",
  "youtube",
];

const LABEL: Record<keyof ArtistSocials, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  twitter: "Twitter",
  email: "Email",
  youtube: "YouTube",
  soundcloud: "SoundCloud",
  website: "Website",
};

export function ArtistSocialsRow({ socials }: { socials: ArtistSocials | null }) {
  if (!socials) return null;
  const entries = ORDER.filter((k) => socials[k] && socials[k]!.trim() !== "");
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {entries.map((k) => {
        const val = socials[k]!;
        const href =
          k === "email" ? (val.startsWith("mailto:") ? val : `mailto:${val}`) : val;
        const isExternal = k !== "email";
        return (
          <a
            key={k}
            href={href}
            target={isExternal ? "_blank" : undefined}
            rel={isExternal ? "noreferrer" : undefined}
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/70 hover:border-white/30 hover:text-white transition-colors"
          >
            {LABEL[k]} {isExternal ? "↗" : ""}
          </a>
        );
      })}
    </div>
  );
}
