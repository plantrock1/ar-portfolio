import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`
  ALTER TABLE site_settings
    ADD COLUMN IF NOT EXISTS bio_photo_url text;
`);
console.log("✓ site_settings.bio_photo_url added");
await pool.end();
