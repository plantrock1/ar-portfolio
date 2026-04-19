import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`
  ALTER TABLE artists
    ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS socials jsonb NOT NULL DEFAULT '{}'::jsonb;

  ALTER TABLE site_settings
    ADD COLUMN IF NOT EXISTS show_listener_chart boolean NOT NULL DEFAULT false;

  CREATE TABLE IF NOT EXISTS featured_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL,
    title text NOT NULL,
    url text NOT NULL,
    image_url text,
    source text,
    display_order integer NOT NULL DEFAULT 0,
    added_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS featured_items_kind_idx ON featured_items (kind, display_order);
`);
console.log("✓ bios, socials, featured_items migrated");
await pool.end();
