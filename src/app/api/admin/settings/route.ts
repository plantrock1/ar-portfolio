import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

const SocialsSchema = z
  .object({
    instagram: z.string().trim().optional(),
    tiktok: z.string().trim().optional(),
    twitter: z.string().trim().optional(),
    youtube: z.string().trim().optional(),
    soundcloud: z.string().trim().optional(),
    website: z.string().trim().optional(),
  })
  .partial();

const Body = z
  .object({
    bio: z.string().max(2000).optional(),
    showListenerChart: z.boolean().optional(),
    socials: SocialsSchema.optional(),
  })
  .refine(
    (v) =>
      v.bio !== undefined ||
      v.showListenerChart !== undefined ||
      v.socials !== undefined,
    { message: "no fields to update" },
  );

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const patch: Record<string, unknown> = { updatedAt: sql`now()` };
  if (parsed.data.bio !== undefined) patch.bio = parsed.data.bio;
  if (parsed.data.showListenerChart !== undefined)
    patch.showListenerChart = parsed.data.showListenerChart;
  const cleanedSocials = parsed.data.socials
    ? Object.fromEntries(
        Object.entries(parsed.data.socials).filter(
          ([, v]) => typeof v === "string" && v.length > 0,
        ),
      )
    : undefined;
  if (cleanedSocials !== undefined) patch.socials = cleanedSocials;

  await db
    .insert(schema.siteSettings)
    .values({
      id: "main",
      bio: parsed.data.bio ?? "",
      showListenerChart: parsed.data.showListenerChart ?? false,
      socials: cleanedSocials ?? {},
    })
    .onConflictDoUpdate({
      target: schema.siteSettings.id,
      set: patch,
    });
  return NextResponse.json({ ok: true });
}
