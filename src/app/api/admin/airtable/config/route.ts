import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { saveAirtableConfig } from "@/lib/airtable/tokens";
import { listAccessibleBases, listBaseTables } from "@/lib/airtable/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  baseId: z.string().trim().min(1).max(64).nullable(),
  tableName: z.string().trim().min(1).max(200).nullable(),
});

/** Save the chosen base + table for the deployment. */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "bad request" },
      { status: 400 },
    );
  }
  await saveAirtableConfig(parsed.data.baseId, parsed.data.tableName);
  return NextResponse.json({ ok: true });
}

/** Fetch the OAuth user's bases (or tables inside a base) for the picker. */
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const forBase = url.searchParams.get("tablesFor");
  try {
    if (forBase) {
      const tables = await listBaseTables(forBase);
      return NextResponse.json({ tables });
    }
    const bases = await listAccessibleBases();
    return NextResponse.json({ bases });
  } catch (e) {
    const message = e instanceof Error ? e.message : "airtable API failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
