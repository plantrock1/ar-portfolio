import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`
  CREATE TABLE IF NOT EXISTS site_settings (
    id text PRIMARY KEY,
    bio text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  INSERT INTO site_settings (id, bio) VALUES ('main',
    'A&R working with artists across hip-hop, pop, and alternative. Below is a live snapshot of the roster I''ve signed — streams and monthly listeners, pulled daily from Spotify.'
  ) ON CONFLICT (id) DO NOTHING;
`);
console.log("✓ site_settings created with default bio");
await pool.end();
