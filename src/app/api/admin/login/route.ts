import { NextRequest, NextResponse } from "next/server";
import { checkPassword, createAdminSession, destroyAdminSession } from "@/lib/auth";
import { z } from "zod";

export const runtime = "nodejs";

const Body = z.object({ password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!(await checkPassword(parsed.data.password))) {
    return NextResponse.json({ error: "invalid password" }, { status: 401 });
  }
  await createAdminSession();
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await destroyAdminSession();
  return NextResponse.json({ ok: true });
}
