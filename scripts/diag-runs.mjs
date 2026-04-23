import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const r = await pool.query(`
  SELECT kind, status, phase, message, artist_index, artist_total,
    albums_scraped, albums_total, tracks_upserted,
    started_at, completed_at, error
  FROM refresh_runs WHERE id = 'current';
`);
console.log("Latest refresh run:", r.rows[0]);

const artists = await pool.query(`
  SELECT name, designation,
    (SELECT monthly_listeners FROM artist_snapshots s
     WHERE s.artist_id = a.id ORDER BY captured_at DESC LIMIT 1) AS latest_ml,
    (SELECT captured_at FROM artist_snapshots s
     WHERE s.artist_id = a.id ORDER BY captured_at DESC LIMIT 1) AS latest_at
  FROM artists a ORDER BY a.name;
`);
console.log("\nArtists on Alec's roster:");
for (const row of artists.rows) console.log(" ", row);
await pool.end();
