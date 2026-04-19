import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`
  ALTER TABLE site_settings
    ADD COLUMN IF NOT EXISTS spotify_sp_dc text,
    ADD COLUMN IF NOT EXISTS spotify_session_status text NOT NULL DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS spotify_session_updated_at timestamptz;
`);
console.log("✓ session cookie columns added");
await pool.end();
