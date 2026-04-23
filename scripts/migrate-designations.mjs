import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`
  ALTER TABLE artists
    ADD COLUMN IF NOT EXISTS designation text;
  ALTER TABLE site_settings
    ADD COLUMN IF NOT EXISTS roster_designations jsonb NOT NULL DEFAULT '[]'::jsonb;
`);
console.log("✓ roster designation columns added");
await pool.end();
