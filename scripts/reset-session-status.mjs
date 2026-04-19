import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`UPDATE site_settings SET spotify_session_status = 'unknown' WHERE id = 'main';`);
console.log("✓ session status reset to 'unknown'");
await pool.end();
