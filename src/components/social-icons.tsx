import type { ArtistSocials } from "@/lib/db/schema";

const ORDER: (keyof ArtistSocials)[] = [
  "instagram",
  "tiktok",
  "twitter",
  "youtube",
  "soundcloud",
  "website",
];

type IconProps = { className?: string };

function InstagramIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
    </svg>
  );
}

function TikTokIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.87A8.16 8.16 0 0 0 21.49 10v-3.4a4.85 4.85 0 0 1-1.9-.11z" />
    </svg>
  );
}

function TwitterIcon({ className }: IconProps) {
  // X / Twitter
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function YoutubeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function SoundCloudIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M1.2 14.4c.1 0 .2-.1.2-.2v-3.4c0-.1-.1-.2-.2-.2s-.2.1-.2.2v3.4c0 .1.1.2.2.2zm1.6 1c.1 0 .2-.1.2-.2v-5.5c0-.1-.1-.2-.2-.2s-.2.1-.2.2v5.5c0 .1.1.2.2.2zm1.6.4c.1 0 .2-.1.2-.2V9.2c0-.1-.1-.2-.2-.2s-.2.1-.2.2v6.4c0 .1.1.2.2.2zm1.6.2c.1 0 .2-.1.2-.2V8.6c0-.1-.1-.2-.2-.2s-.2.1-.2.2v7.2c0 .1.1.2.2.2zm1.6 0c.1 0 .2-.1.2-.2V7.8c0-.2-.1-.2-.2-.2s-.2.1-.2.2v8c0 .1.1.2.2.2zm1.6 0c.1 0 .2-.1.2-.2V7c0-.1-.1-.2-.2-.2s-.2.1-.2.2v8.8c0 .1.1.2.2.2zm1.6 0c.1 0 .2-.1.2-.2V6.4c0-.1-.1-.2-.2-.2s-.2.1-.2.2v9.4c0 .1.1.2.2.2zm9.1-6.8c-.5 0-1 .1-1.5.3-.3-3.4-3.2-6-6.6-6-1.4 0-2.7.4-3.7 1.1V16h11.8c1.8 0 3.3-1.5 3.3-3.4s-1.5-3.4-3.3-3.4z" />
    </svg>
  );
}

function GlobeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

const META: Record<
  keyof ArtistSocials,
  { label: string; Icon: React.ComponentType<IconProps> }
> = {
  instagram: { label: "Instagram", Icon: InstagramIcon },
  tiktok: { label: "TikTok", Icon: TikTokIcon },
  twitter: { label: "Twitter / X", Icon: TwitterIcon },
  youtube: { label: "YouTube", Icon: YoutubeIcon },
  soundcloud: { label: "SoundCloud", Icon: SoundCloudIcon },
  website: { label: "Website", Icon: GlobeIcon },
};

export function SocialIcons({
  socials,
  size = "md",
}: {
  socials: ArtistSocials | null | undefined;
  size?: "sm" | "md";
}) {
  if (!socials) return null;
  const entries = ORDER.filter((k) => socials[k] && socials[k]!.trim() !== "");
  if (entries.length === 0) return null;
  const iconSize = size === "sm" ? "w-4 h-4" : "w-5 h-5";
  const btnSize = size === "sm" ? "w-8 h-8" : "w-9 h-9";
  return (
    <div className="flex items-center gap-2">
      {entries.map((k) => {
        const { label, Icon } = META[k];
        return (
          <a
            key={k}
            href={socials[k]}
            target="_blank"
            rel="noreferrer"
            aria-label={label}
            title={label}
            className={`${btnSize} flex items-center justify-center rounded-full border border-white/10 text-white/60 hover:text-white hover:border-white/30 transition-colors`}
          >
            <Icon className={iconSize} />
          </a>
        );
      })}
    </div>
  );
}
