import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const r = await pool.query(`
  SELECT a.name,
    COUNT(DISTINCT tr.id)::int AS total_tracks,
    COUNT(DISTINCT CASE WHEN ts.streams IS NOT NULL THEN tr.id END)::int AS tracks_with_streams
  FROM artists a
  LEFT JOIN tracks tr ON tr.artist_id = a.id
  LEFT JOIN track_snapshots ts ON ts.track_id = tr.id
  GROUP BY a.name
  ORDER BY a.name;
`);
for (const row of r.rows) console.log(row);
await pool.end();
