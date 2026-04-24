import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`
  ALTER TABLE refresh_runs
    ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz;
`);
console.log("✓ cancel_requested_at added");
await pool.end();
