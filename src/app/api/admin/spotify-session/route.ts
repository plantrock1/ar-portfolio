import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { setSpotifySession, getSpotifySession } from "@/lib/spotify/session";

export const runtime = "nodejs";

const Body = z.object({
  spDc: z.string().trim().min(20).max(500),
});

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const session = await getSpotifySession();
  return NextResponse.json({
    hasSession: !!session.spDc,
    // Only send a masked preview to the client, never the full value
    preview: session.spDc ? mask(session.spDc) : null,
    status: session.status,
    updatedAt: session.updatedAt,
  });
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  await setSpotifySession(parsed.data.spDc.trim());
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await setSpotifySession(null);
  return NextResponse.json({ ok: true });
}

function mask(v: string) {
  if (v.length <= 8) return "****";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}
