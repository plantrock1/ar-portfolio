import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

const Body = z.object({
  bio: z.string().max(2000),
});

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  await db
    .insert(schema.siteSettings)
    .values({ id: "main", bio: parsed.data.bio })
    .onConflictDoUpdate({
      target: schema.siteSettings.id,
      set: { bio: parsed.data.bio, updatedAt: sql`now()` },
    });
  return NextResponse.json({ ok: true });
}
