import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getCurrentRun } from "@/lib/refresh-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const run = await getCurrentRun();
  return NextResponse.json({ run });
}
