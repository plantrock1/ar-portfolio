import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`
  ALTER TABLE tracks
    ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;
`);
console.log("✓ tracks.is_primary added");
await pool.end();
