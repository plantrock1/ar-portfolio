import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

console.log("Per-artist total streams (old logic vs ISRC-deduped):");
const r = await pool.query(`
  WITH latest AS (
    SELECT DISTINCT ON (tr.spotify_id)
      tr.artist_id, tr.spotify_id, tr.isrc, ts.streams
    FROM tracks tr JOIN track_snapshots ts ON ts.track_id = tr.id
    WHERE tr.hidden = false AND ts.streams IS NOT NULL
    ORDER BY tr.spotify_id, ts.captured_at DESC
  )
  SELECT a.name,
    SUM(l.streams)::text AS old_total,
    (SELECT SUM(max_streams)::text FROM (
      SELECT MAX(streams) AS max_streams
      FROM latest l2 WHERE l2.artist_id = a.id
      GROUP BY COALESCE(isrc, spotify_id)
    ) _) AS new_total_deduped
  FROM artists a
  JOIN latest l ON l.artist_id = a.id
  GROUP BY a.id, a.name
  ORDER BY a.name;
`);
for (const row of r.rows) console.log(" ", row);
await pool.end();
