"use client";

import { useState } from "react";

// An <img> that falls back to a gradient-with-initials placeholder if the
// upcoming-cover proxy fails to serve the image (Airtable attachment gone,
// OAuth token expired, etc). Keeps the release grid visually intact even
// when a specific record's cover art doesn't resolve.
export function UpcomingCoverImage({
  src,
  alt,
  fallbackInitials,
  containerClassName,
  imgClassName,
  placeholderFontClassName = "display text-5xl text-white/20 tracking-widest",
}: {
  src: string;
  alt: string;
  fallbackInitials: string;
  containerClassName?: string;
  imgClassName?: string;
  placeholderFontClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className={
          containerClassName ??
          "absolute inset-0 w-full h-full bg-gradient-to-br from-neutral-800 via-neutral-900 to-black flex items-center justify-center"
        }
      >
        <span className={placeholderFontClassName}>
          {fallbackInitials || "◐"}
        </span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className={
        imgClassName ?? "absolute inset-0 w-full h-full object-cover"
      }
    />
  );
}
