import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { runDeepRefresh } from "@/lib/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const fromCron = cronSecret && auth && auth === `Bearer ${cronSecret}`;
  const admin = await isAdmin();
  if (!fromCron && !admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const report = await runDeepRefresh();
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    console.error("[cron/deep-refresh]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "deep refresh failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
