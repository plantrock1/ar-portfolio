import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const sql = `
  ALTER TABLE tracks DROP CONSTRAINT IF EXISTS tracks_spotify_id_unique;
  TRUNCATE track_snapshots CASCADE;
  TRUNCATE tracks CASCADE;
  ALTER TABLE tracks DROP CONSTRAINT IF EXISTS tracks_artist_spotify_unique;
  ALTER TABLE tracks ADD CONSTRAINT tracks_artist_spotify_unique UNIQUE (artist_id, spotify_id);
`;

await pool.query(sql);
console.log("✓ tracks uniqueness migrated (scoped per artist, tables truncated)");
await pool.end();
