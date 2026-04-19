import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "mosaic.scdn.co" },
      { protocol: "https", hostname: "image-cdn-ak.spotifycdn.com" },
      { protocol: "https", hostname: "image-cdn-fa.spotifycdn.com" },
      { protocol: "https", hostname: "seed-mix-image.spotifycdn.com" },
    ],
  },
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // Vercel's default file tracer drops @sparticuz/chromium's binary payload
  // (it lives in node_modules/@sparticuz/chromium/bin/ as a compressed
  // chromium blob). Explicitly include it for every cron route that runs
  // the scraper.
  outputFileTracingIncludes: {
    "/api/cron/*": [
      "./node_modules/@sparticuz/chromium/**/*",
    ],
  },
};

export default nextConfig;
