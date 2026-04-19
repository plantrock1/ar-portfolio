import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`
  CREATE TABLE IF NOT EXISTS refresh_runs (
    id text PRIMARY KEY,
    kind text NOT NULL,
    status text NOT NULL,
    phase text,
    message text,
    artist_index integer NOT NULL DEFAULT 0,
    artist_total integer NOT NULL DEFAULT 0,
    albums_scraped integer NOT NULL DEFAULT 0,
    albums_total integer NOT NULL DEFAULT 0,
    tracks_upserted integer NOT NULL DEFAULT 0,
    started_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    report jsonb,
    error text
  );
  INSERT INTO refresh_runs (id, kind, status) VALUES ('current', 'shallow', 'idle')
  ON CONFLICT (id) DO NOTHING;
`);

// Also wipe existing tracks so we start clean with the fixed discography logic
await pool.query(`
  TRUNCATE track_snapshots CASCADE;
  TRUNCATE tracks CASCADE;
`);

console.log("✓ refresh_runs created, tracks wiped for clean re-scrape");
await pool.end();
