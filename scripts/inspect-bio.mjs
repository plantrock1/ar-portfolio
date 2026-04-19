import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(`
  SELECT bio,
    LEFT(bio_photo_url, 60) AS photo_preview,
    LENGTH(bio_photo_url) AS photo_len,
    socials
  FROM site_settings WHERE id = 'main';
`);
console.log(rows[0]);
await pool.end();
