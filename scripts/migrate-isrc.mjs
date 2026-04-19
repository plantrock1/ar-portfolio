import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`
  ALTER TABLE tracks ADD COLUMN IF NOT EXISTS isrc text;
  CREATE INDEX IF NOT EXISTS tracks_isrc_idx ON tracks (isrc) WHERE isrc IS NOT NULL;
`);
console.log("✓ tracks.isrc added");
await pool.end();
