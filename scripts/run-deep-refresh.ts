/**
 * Standalone script that runs the deep refresh without the Next.js HTTP layer.
 * Designed to be invoked from a GitHub Actions workflow or any Node 20+
 * environment with the right env vars and Chrome installed.
 *
 * Usage:
 *   npx tsx scripts/run-deep-refresh.ts
 *
 * Required env vars (same as .env.local):
 *   DATABASE_URL, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
 *   ADMIN_PASSWORD, SESSION_SECRET, CRON_SECRET
 *   USE_LOCAL_CHROME=1  (when Chrome is installed at /usr/bin/google-chrome)
 */

import { config } from "dotenv";

// Load .env.local when present so this also works locally
config({ path: ".env.local", override: false });

// Validate required env before importing app code (better error messages)
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

// Dynamic import so env is loaded before schema/db modules initialize
const { runDeepRefresh } = await import("../src/lib/refresh");

console.log("▶ Starting deep refresh…");
const startedAt = Date.now();

try {
  const report = await runDeepRefresh();
  const durationMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
  console.log(`\n✓ Deep refresh complete in ${durationMin} min`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
} catch (e) {
  console.error("\n✗ Deep refresh failed:", e);
  process.exit(1);
}
