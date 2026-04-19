import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const tracks = await pool.query(`
  SELECT a.name AS artist,
    COUNT(DISTINCT tr.id)::int AS tracks,
    COUNT(DISTINCT CASE WHEN ts.streams IS NOT NULL THEN tr.id END)::int AS with_streams
  FROM artists a
  LEFT JOIN tracks tr ON tr.artist_id = a.id
  LEFT JOIN track_snapshots ts ON ts.track_id = tr.id
  GROUP BY a.name ORDER BY a.name;
`);
console.log("Tracks:");
for (const r of tracks.rows) console.log(" ", r);

const runs = await pool.query(`
  SELECT kind, status, phase, message, albums_scraped, albums_total, tracks_upserted,
    started_at, completed_at, error
  FROM refresh_runs WHERE id = 'current';
`);
console.log("\nCurrent/last run:");
console.log(runs.rows[0]);
await pool.end();
