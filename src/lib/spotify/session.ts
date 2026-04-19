import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";

export type SpotifySession = {
  spDc: string | null;
  status: "ok" | "expired" | "unknown";
  updatedAt: Date | null;
};

export async function getSpotifySession(): Promise<SpotifySession> {
  const rows = await db
    .select()
    .from(schema.siteSettings)
    .where(eq(schema.siteSettings.id, "main"));
  const row = rows[0];
  const rawStatus = row?.spotifySessionStatus ?? "unknown";
  const status: SpotifySession["status"] =
    rawStatus === "ok" || rawStatus === "expired" ? rawStatus : "unknown";
  return {
    spDc: row?.spotifySpDc ?? null,
    status,
    updatedAt: row?.spotifySessionUpdatedAt ?? null,
  };
}

export async function setSpotifySession(spDc: string | null) {
  await db
    .insert(schema.siteSettings)
    .values({
      id: "main",
      spotifySpDc: spDc,
      spotifySessionStatus: spDc ? "unknown" : "unknown",
      spotifySessionUpdatedAt: spDc ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: schema.siteSettings.id,
      set: {
        spotifySpDc: spDc,
        spotifySessionStatus: spDc ? "unknown" : "unknown",
        spotifySessionUpdatedAt: spDc ? sql`now()` : null,
      },
    });
}

export async function markSessionStatus(status: "ok" | "expired") {
  await db
    .update(schema.siteSettings)
    .set({ spotifySessionStatus: status })
    .where(eq(schema.siteSettings.id, "main"));
}
