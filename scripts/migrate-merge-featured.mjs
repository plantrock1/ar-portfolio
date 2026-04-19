import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`UPDATE featured_items SET kind = 'press' WHERE kind != 'press';`);
console.log("✓ all featured items merged into 'press'");
await pool.end();
