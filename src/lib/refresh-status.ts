import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";

export type RefreshStatus = {
  kind: "shallow" | "deep";
  status: "idle" | "running" | "done" | "failed" | "cancelled";
  phase: string | null;
  message: string | null;
  artistIndex: number;
  artistTotal: number;
  albumsScraped: number;
  albumsTotal: number;
  tracksUpserted: number;
  startedAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  cancelRequested: boolean;
  error: string | null;
};

export async function beginRun(kind: "shallow" | "deep", artistTotal: number) {
  await db
    .insert(schema.refreshRuns)
    .values({
      id: "current",
      kind,
      status: "running",
      phase: "starting",
      message: null,
      artistIndex: 0,
      artistTotal,
      albumsScraped: 0,
      albumsTotal: 0,
      tracksUpserted: 0,
      startedAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
      cancelRequestedAt: null,
      error: null,
    })
    .onConflictDoUpdate({
      target: schema.refreshRuns.id,
      set: {
        kind,
        status: "running",
        phase: "starting",
        message: null,
        artistIndex: 0,
        artistTotal,
        albumsScraped: 0,
        albumsTotal: 0,
        tracksUpserted: 0,
        startedAt: sql`now()`,
        updatedAt: sql`now()`,
        completedAt: null,
        cancelRequestedAt: null,
        error: null,
      },
    });
}

/** Call from long-running refresh loops to check if user hit Stop. */
export async function isCancelRequested(): Promise<boolean> {
  const rows = await db
    .select({ req: schema.refreshRuns.cancelRequestedAt })
    .from(schema.refreshRuns)
    .where(eq(schema.refreshRuns.id, "current"));
  return !!rows[0]?.req;
}

/** Flag the current run for cancellation. Long loops poll and exit. */
export async function requestCancel() {
  await db
    .update(schema.refreshRuns)
    .set({ cancelRequestedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(schema.refreshRuns.id, "current"));
}

export async function updateRun(fields: Partial<RefreshStatus>) {
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (fields.phase !== undefined) set.phase = fields.phase;
  if (fields.message !== undefined) set.message = fields.message;
  if (fields.artistIndex !== undefined) set.artistIndex = fields.artistIndex;
  if (fields.albumsScraped !== undefined)
    set.albumsScraped = fields.albumsScraped;
  if (fields.albumsTotal !== undefined) set.albumsTotal = fields.albumsTotal;
  if (fields.tracksUpserted !== undefined)
    set.tracksUpserted = fields.tracksUpserted;
  await db
    .update(schema.refreshRuns)
    .set(set)
    .where(eq(schema.refreshRuns.id, "current"));
}

export async function completeRun(report: RefreshStatus["status"], error?: string) {
  await db
    .update(schema.refreshRuns)
    .set({
      status: report,
      error: error ?? null,
      completedAt: new Date(),
      updatedAt: sql`now()`,
      phase: report === "done" ? "complete" : "failed",
    })
    .where(eq(schema.refreshRuns.id, "current"));
}

// If a run is marked "running" but hasn't written any progress in this window,
// we treat it as dead (Vercel function timeout, browser kill, etc.) and surface
// it as "failed" so the UI doesn't hang on "running" forever.
const STALE_RUNNING_MS = 3 * 60 * 1000;

export async function getCurrentRun(): Promise<RefreshStatus | null> {
  const rows = await db
    .select()
    .from(schema.refreshRuns)
    .where(eq(schema.refreshRuns.id, "current"));
  const r = rows[0];
  if (!r) return null;

  let status = r.status as RefreshStatus["status"];
  let error = r.error;
  if (status === "running") {
    const since = Date.now() - new Date(r.updatedAt).getTime();
    if (since > STALE_RUNNING_MS) {
      status = "failed";
      error =
        error ??
        "Run appears to have stopped mid-flight (likely hit the server time limit). Try again.";
    }
  }

  return {
    kind: r.kind as RefreshStatus["kind"],
    status,
    phase: r.phase,
    message: r.message,
    artistIndex: r.artistIndex,
    artistTotal: r.artistTotal,
    albumsScraped: r.albumsScraped,
    albumsTotal: r.albumsTotal,
    tracksUpserted: r.tracksUpserted,
    startedAt: new Date(r.startedAt),
    updatedAt: new Date(r.updatedAt),
    completedAt: r.completedAt ? new Date(r.completedAt) : null,
    cancelRequested: !!r.cancelRequestedAt,
    error,
  };
}
