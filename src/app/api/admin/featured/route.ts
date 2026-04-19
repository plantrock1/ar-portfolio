import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { asc, eq } from "drizzle-orm";

export const runtime = "nodejs";

const Kind = z.enum(["press", "media"]);

const CreateBody = z.object({
  kind: Kind,
  title: z.string().trim().min(1).max(200),
  url: z.string().trim().url().max(600),
  imageUrl: z.string().trim().url().max(600).optional().or(z.literal("")),
  source: z.string().trim().max(80).optional().or(z.literal("")),
});

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const items = await db
    .select()
    .from(schema.featuredItems)
    .orderBy(asc(schema.featuredItems.displayOrder), asc(schema.featuredItems.addedAt));
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "bad request" },
      { status: 400 },
    );
  }
  const { kind, title, url, imageUrl, source } = parsed.data;
  const imageResolved = imageUrl?.trim() || (await resolveImage(url, kind));
  const [inserted] = await db
    .insert(schema.featuredItems)
    .values({
      kind,
      title,
      url,
      imageUrl: imageResolved || null,
      source: source?.trim() || null,
    })
    .returning();
  return NextResponse.json({ item: inserted });
}

const DeleteBody = z.object({ id: z.string().uuid() });

export async function DELETE(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = DeleteBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  await db
    .delete(schema.featuredItems)
    .where(eq(schema.featuredItems.id, parsed.data.id));
  return NextResponse.json({ ok: true });
}

// Auto-derive a thumbnail for YouTube links when the user didn't provide one.
async function resolveImage(url: string, kind: "press" | "media"): Promise<string | null> {
  if (kind !== "media") return null;
  const ytId = extractYoutubeId(url);
  if (ytId) return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
  return null;
}

function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).slice(0, 11) || null;
    if (u.hostname.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v.slice(0, 11);
      // /embed/{id} or /shorts/{id}
      const m = u.pathname.match(/\/(?:embed|shorts)\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {
    // not a URL
  }
  return null;
}
