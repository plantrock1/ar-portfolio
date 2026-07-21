import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { clearAirtableAuth } from "@/lib/airtable/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await clearAirtableAuth();
  return NextResponse.json({ ok: true });
}
