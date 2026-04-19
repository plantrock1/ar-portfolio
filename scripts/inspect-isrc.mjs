import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

console.log("\n=== ISRC coverage ===");
const isrcCoverage = await pool.query(`
  SELECT a.name,
    COUNT(tr.id)::int AS total_tracks,
    COUNT(tr.isrc)::int AS with_isrc,
    COUNT(DISTINCT tr.isrc)::int AS unique_isrcs
  FROM artists a
  LEFT JOIN tracks tr ON tr.artist_id = a.id
  GROUP BY a.name ORDER BY a.name;
`);
for (const r of isrcCoverage.rows) console.log(" ", r);

console.log("\n=== Cyber11 duplicates ===");
const cyber = await pool.query(`
  SELECT tr.name, tr.spotify_id, tr.isrc, COUNT(*)::int AS count
  FROM tracks tr
  JOIN artists a ON a.id = tr.artist_id
  WHERE a.slug = 'cyber11' OR LOWER(a.name) LIKE '%cyber%'
  GROUP BY tr.name, tr.spotify_id, tr.isrc
  ORDER BY tr.name;
`);
if (cyber.rows.length === 0) console.log("  no matches for cyber*");
for (const r of cyber.rows) console.log(" ", r);

console.log("\n=== Three 6 tracks across roster ===");
const three6 = await pool.query(`
  SELECT a.name AS artist, tr.name, tr.spotify_id, tr.isrc
  FROM tracks tr
  JOIN artists a ON a.id = tr.artist_id
  WHERE tr.name ILIKE '%three 6%'
  ORDER BY tr.name;
`);
for (const r of three6.rows) console.log(" ", r);

await pool.end();
