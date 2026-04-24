import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { requestCancel } from "@/lib/refresh-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await requestCancel();
  return NextResponse.json({ ok: true });
}
