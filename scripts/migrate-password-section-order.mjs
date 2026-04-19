import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`
  ALTER TABLE site_settings
    ADD COLUMN IF NOT EXISTS admin_password_hash text,
    ADD COLUMN IF NOT EXISTS section_order jsonb NOT NULL
      DEFAULT '["roster","top_tracks","featured_media"]'::jsonb;
`);
console.log("✓ admin_password_hash + section_order columns added");
await pool.end();
