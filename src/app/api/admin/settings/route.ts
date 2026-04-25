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
    email: z.string().trim().optional(),
    youtube: z.string().trim().optional(),
    soundcloud: z.string().trim().optional(),
    website: z.string().trim().optional(),
  })
  .partial();

const BioPhoto = z
  .string()
  .trim()
  .max(5_500_000)
  .refine(
    (s) =>
      s === "" ||
      /^https?:\/\//i.test(s) ||
      /^data:image\/[a-zA-Z0-9+.-]+;base64,/.test(s),
    { message: "bioPhotoUrl must be a URL or image data: URL" },
  );

const SECTION_IDS = ["roster", "top_tracks", "featured_media"] as const;
const SectionOrderSchema = z.array(z.enum(SECTION_IDS)).length(3);

const RosterDesignationsSchema = z
  .array(z.string().trim().min(1).max(60))
  .max(20);

const Body = z
  .object({
    displayName: z.string().max(100).optional(),
    // Short label like "A&R", "Manager", "Producer" — drives the eyebrow
    // ("<role> Portfolio") and the browser tab suffix.
    roleTitle: z.string().max(40).optional(),
    bio: z.string().max(2000).optional(),
    bioPhotoUrl: BioPhoto.optional().or(z.null()),
    showListenerChart: z.boolean().optional(),
    showCombinedStreamsNote: z.boolean().optional(),
    showArtistStreamsNote: z.boolean().optional(),
    socials: SocialsSchema.optional(),
    sectionOrder: SectionOrderSchema.optional(),
    rosterDesignations: RosterDesignationsSchema.optional(),
  })
  .refine(
    (v) =>
      v.displayName !== undefined ||
      v.roleTitle !== undefined ||
      v.bio !== undefined ||
      v.bioPhotoUrl !== undefined ||
      v.showListenerChart !== undefined ||
      v.showCombinedStreamsNote !== undefined ||
      v.showArtistStreamsNote !== undefined ||
      v.socials !== undefined ||
      v.sectionOrder !== undefined ||
      v.rosterDesignations !== undefined,
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
  if (parsed.data.displayName !== undefined)
    patch.displayName = parsed.data.displayName.trim();
  if (parsed.data.roleTitle !== undefined)
    patch.roleTitle = parsed.data.roleTitle.trim() || "A&R";
  if (parsed.data.bio !== undefined) patch.bio = parsed.data.bio;
  if (parsed.data.bioPhotoUrl !== undefined)
    patch.bioPhotoUrl = parsed.data.bioPhotoUrl || null;
  if (parsed.data.showListenerChart !== undefined)
    patch.showListenerChart = parsed.data.showListenerChart;
  if (parsed.data.showCombinedStreamsNote !== undefined)
    patch.showCombinedStreamsNote = parsed.data.showCombinedStreamsNote;
  if (parsed.data.showArtistStreamsNote !== undefined)
    patch.showArtistStreamsNote = parsed.data.showArtistStreamsNote;
  const cleanedSocials = parsed.data.socials
    ? Object.fromEntries(
        Object.entries(parsed.data.socials).filter(
          ([, v]) => typeof v === "string" && v.length > 0,
        ),
      )
    : undefined;
  if (cleanedSocials !== undefined) patch.socials = cleanedSocials;
  if (parsed.data.sectionOrder !== undefined)
    patch.sectionOrder = parsed.data.sectionOrder;
  if (parsed.data.rosterDesignations !== undefined) {
    // Dedupe (case-insensitive) while preserving first-occurrence order
    const seen = new Set<string>();
    const cleaned = parsed.data.rosterDesignations
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .filter((s) => {
        const k = s.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    patch.rosterDesignations = cleaned;
  }

  await db
    .insert(schema.siteSettings)
    .values({
      id: "main",
      displayName: parsed.data.displayName?.trim() ?? "",
      roleTitle: parsed.data.roleTitle?.trim() || "A&R",
      bio: parsed.data.bio ?? "",
      bioPhotoUrl: parsed.data.bioPhotoUrl || null,
      showListenerChart: parsed.data.showListenerChart ?? false,
      showCombinedStreamsNote: parsed.data.showCombinedStreamsNote ?? true,
      showArtistStreamsNote: parsed.data.showArtistStreamsNote ?? true,
      socials: cleanedSocials ?? {},
    })
    .onConflictDoUpdate({
      target: schema.siteSettings.id,
      set: patch,
    });
  return NextResponse.json({ ok: true });
}
