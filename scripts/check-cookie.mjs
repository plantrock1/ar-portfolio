import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(`
  SELECT LENGTH(spotify_sp_dc) AS len,
    LEFT(spotify_sp_dc, 8) AS head,
    RIGHT(spotify_sp_dc, 8) AS tail,
    spotify_session_status AS status,
    spotify_session_updated_at AS updated
  FROM site_settings WHERE id = 'main';
`);
console.log(rows[0]);
await pool.end();
