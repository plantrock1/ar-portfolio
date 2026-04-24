/**
 * Standalone script for the exhaustive shallow refresh. Designed for GitHub
 * Actions runners where Vercel's 60s function timeout doesn't apply: we can
 * run multiple patient passes with long listener-wait timeouts until every
 * artist lands.
 *
 * Usage:
 *   npx tsx scripts/run-shallow-refresh.ts
 *
 * Required env (same as .env.local): DATABASE_URL, SPOTIFY_CLIENT_ID,
 * SPOTIFY_CLIENT_SECRET, ADMIN_PASSWORD, SESSION_SECRET, CRON_SECRET,
 * USE_LOCAL_CHROME=1 (when Chrome is at /usr/bin/google-chrome).
 */

import { config } from "dotenv";
config({ path: ".env.local", override: false });

const REQUIRED = [
  "DATABASE_URL",
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
] as const;
for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`✗ missing required env var: ${key}`);
    process.exit(2);
  }
}

async function main() {
  const { runShallowRefreshFull } = await import("../src/lib/refresh");

  console.log("▶ Starting exhaustive shallow refresh…");
  const startedAt = Date.now();

  try {
    const report = await runShallowRefreshFull();
    const durationMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
    console.log(`\n✓ Shallow refresh complete in ${durationMin} min`);
    console.log(JSON.stringify(report, null, 2));
    if (report.scrapeMisses > 0) {
      console.warn(
        `\n⚠ ${report.scrapeMisses} artist${report.scrapeMisses === 1 ? "" : "s"} still missed after all passes — they kept their previous stored values`,
      );
    }
    process.exit(0);
  } catch (e) {
    console.error("\n✗ Shallow refresh failed:", e);
    process.exit(1);
  }
}

main();
