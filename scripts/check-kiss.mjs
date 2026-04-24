import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(`
  SELECT
    tr.id,
    tr.spotify_id,
    tr.name,
    tr.isrc,
    tr.is_primary,
    a.name AS artist,
    (SELECT streams FROM track_snapshots ts
       WHERE ts.track_id = tr.id AND ts.streams IS NOT NULL
       ORDER BY ts.captured_at DESC LIMIT 1) AS latest_streams
  FROM tracks tr
  JOIN artists a ON a.id = tr.artist_id
  WHERE tr.name ILIKE '%kiss%' AND a.name ILIKE '%lilith%'
  ORDER BY latest_streams DESC NULLS LAST;
`);
for (const r of rows) console.log(r);
await pool.end();
