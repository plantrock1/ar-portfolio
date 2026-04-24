import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { runRefresh } from "@/lib/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const fromCron = cronSecret && auth && auth === `Bearer ${cronSecret}`;
  const admin = await isAdmin();
  if (!fromCron && !admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Admin clients can pass ?offset=N&limit=M to process just a slice,
  // avoiding Vercel's 60s timeout on large rosters. When missing, process
  // everything (the scheduled-cron path).
  const url = new URL(req.url);
  const offsetRaw = url.searchParams.get("offset");
  const limitRaw = url.searchParams.get("limit");
  const offset = offsetRaw !== null ? Number(offsetRaw) : undefined;
  const limit = limitRaw !== null ? Number(limitRaw) : undefined;

  try {
    const report = await runRefresh({
      offset: Number.isFinite(offset) ? offset : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    console.error("[cron/refresh]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "refresh failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
