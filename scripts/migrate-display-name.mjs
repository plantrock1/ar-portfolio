import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Add the column + backfill Alec's existing deployment so nothing breaks.
// For brand-new deployments, display_name starts empty and the admin fills it in.
await pool.query(`
  ALTER TABLE site_settings
    ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT '';
`);

// Only backfill if the row exists AND display_name is still empty.
// Safe to re-run — won't overwrite anyone's chosen name.
const { rowCount } = await pool.query(`
  UPDATE site_settings
  SET display_name = 'Alec Veach'
  WHERE id = 'main' AND display_name = '';
`);

console.log(
  `✓ display_name column ensured${rowCount ? ` (backfilled ${rowCount} row)` : ""}`,
);
await pool.end();
