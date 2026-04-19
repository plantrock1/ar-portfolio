import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const id = process.env.SPOTIFY_CLIENT_ID;
const secret = process.env.SPOTIFY_CLIENT_SECRET;
if (!id || !secret) {
  console.error("Missing Spotify credentials in .env.local");
  process.exit(1);
}

async function getToken() {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const j = await res.json();
  return j.access_token;
}

async function fetchIsrc(token, spotifyId) {
  const res = await fetch(`https://api.spotify.com/v1/tracks/${spotifyId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const j = await res.json();
  return j.external_ids?.isrc ?? null;
}

const token = await getToken();
console.log("✓ got access token");

const { rows } = await pool.query(`
  SELECT DISTINCT spotify_id FROM tracks WHERE isrc IS NULL
`);
console.log(`Found ${rows.length} tracks without ISRC`);

let done = 0;
let hit = 0;
const concurrency = 8;
const queue = [...rows];

async function worker() {
  while (queue.length) {
    const row = queue.shift();
    if (!row) return;
    const isrc = await fetchIsrc(token, row.spotify_id);
    done += 1;
    if (isrc) {
      hit += 1;
      await pool.query(`UPDATE tracks SET isrc = $1 WHERE spotify_id = $2`, [
        isrc,
        row.spotify_id,
      ]);
    }
    if (done % 20 === 0) console.log(`  ${done}/${rows.length} (${hit} with ISRC)`);
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
console.log(`\n✓ Done: ${hit}/${rows.length} tracks got an ISRC`);

// Report dedup impact
const after = await pool.query(`
  SELECT a.name,
    COUNT(DISTINCT tr.spotify_id)::int AS tracks,
    COUNT(DISTINCT COALESCE(tr.isrc, tr.spotify_id))::int AS unique_recordings
  FROM artists a
  LEFT JOIN tracks tr ON tr.artist_id = a.id
  GROUP BY a.name ORDER BY a.name;
`);
console.log("\nDedup impact:");
for (const r of after.rows) console.log(" ", r);

await pool.end();
