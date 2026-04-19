import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import * as schema from "./schema";

// Node ≤ 20 and several serverless runtimes don't expose a global WebSocket,
// which the Neon driver needs. Wire up the `ws` package only when we're in a
// Node environment missing one — in Edge / Vercel Node 22 / browsers this is
// a no-op.
if (typeof globalThis.WebSocket === "undefined") {
  // Use require so bundlers don't pull `ws` into edge/browser builds.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  neonConfig.webSocketConstructor = require("ws");
}

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let _db: DrizzleDb | null = null;

function getDb(): DrizzleDb {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url });
  _db = drizzle(pool, { schema });
  return _db;
}

export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop: keyof DrizzleDb) {
    const real = getDb();
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
