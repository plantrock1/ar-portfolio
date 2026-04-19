import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getArtist } from "@/lib/spotify/api";
import { parseSpotifyArtistId, slugify } from "@/lib/utils";
import { eq, desc } from "drizzle-orm";

export const runtime = "nodejs";

const AddBody = z.object({
  spotifyUrl: z.string().min(1),
  role: z.string().trim().optional(),
});

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rows = await db
    .select()
    .from(schema.artists)
    .orderBy(desc(schema.artists.addedAt));
  return NextResponse.json({ artists: rows });
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = AddBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const spotifyId = parseSpotifyArtistId(parsed.data.spotifyUrl);
  if (!spotifyId) {
    return NextResponse.json(
      { error: "invalid Spotify artist URL or ID" },
      { status: 400 },
    );
  }

  const existing = await db
    .select()
    .from(schema.artists)
    .where(eq(schema.artists.spotifyId, spotifyId));
  if (existing.length) {
    return NextResponse.json({ artist: existing[0], duplicate: true });
  }

  let info;
  try {
    info = await getArtist(spotifyId);
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "failed to fetch artist from Spotify",
      },
      { status: 502 },
    );
  }

  const baseSlug = slugify(info.name) || spotifyId;
  let slug = baseSlug;
  let n = 2;
  while (
    (await db.select().from(schema.artists).where(eq(schema.artists.slug, slug)))
      .length
  ) {
    slug = `${baseSlug}-${n++}`;
  }

  const [inserted] = await db
    .insert(schema.artists)
    .values({
      spotifyId,
      name: info.name,
      slug,
      imageUrl: info.images[0]?.url ?? null,
      genres: info.genres ?? [],
      role: parsed.data.role?.trim() || null,
    })
    .returning();

  await db.insert(schema.artistSnapshots).values({
    artistId: inserted.id,
    followers: info.followers.total,
    popularity: info.popularity,
    monthlyListeners: null,
  });

  return NextResponse.json({ artist: inserted });
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
  await db.delete(schema.artists).where(eq(schema.artists.id, parsed.data.id));
  return NextResponse.json({ ok: true });
}

const PatchBody = z.object({
  id: z.string().uuid(),
  role: z.string().trim().optional(),
  displayOrder: z.number().int().optional(),
  hidden: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const { id, ...rest } = parsed.data;
  await db.update(schema.artists).set(rest).where(eq(schema.artists.id, id));
  return NextResponse.json({ ok: true });
}
