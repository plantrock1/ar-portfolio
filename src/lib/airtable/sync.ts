import { db, schema } from "@/lib/db";
import { eq, notInArray, sql } from "drizzle-orm";
import { getValidAirtableAuth } from "./tokens";

// Airtable field-name normalization: we match user field names case-
// insensitively and pick the first key that looks like a match. This
// insulates us from small casing/whitespace differences in the base
// without needing a full mapping UI.
const TITLE_KEYS = [
  "release title",
  "release name",
  "title",
  "name",
  "track",
  "song title",
  "song",
  "release",
];
// Note: "date" alone is deliberately NOT in DATE_KEYS — production label
// tables like Lexi's include many date columns (Editorial Monitoring Stop
// Date, Created Time, etc.) and matching bare "date" grabs the wrong one.
const DATE_KEYS = [
  "release date",
  "releasedate",
  "drop date",
  "street date",
  "planned date",
  "preorder date",
];
const SPOTIFY_ID_KEYS = [
  "spotify artist id",
  "spotify id",
  "artist spotify id",
  "spotifyartistid",
  "spotify uri",
  "artist spotify uri",
  "artist + spotify uri",
];
// "primary artist name" is preferred over bare "primary artist" so, in a
// schema that has both a Select (bare) and a Name lookup, we pick the
// resolvable name. Order matters — first match in this list wins.
const ARTIST_NAME_KEYS = [
  "primary artist name",
  "primary artist names",
  "primary artist",
  "artist name",
  "artist names",
  "artist",
  "artists",
];
// Pre-save / smart link for the upcoming release. Optional per row.
const PRESAVE_URL_KEYS = [
  "pre-save link",
  "pre save link",
  "presave link",
  "pre-save url",
  "presave url",
  "pre-save",
  "presave",
  "smart link",
  "smart url",
  "landing page",
];
// Audio attachment field(s) that hold a preview / demo of the release.
// Airtable returns these as arrays of attachment objects.
const AUDIO_KEYS = [
  "song file",
  "song files",
  "audio file",
  "audio",
  "preview",
  "preview clip",
  "preview clips",
  "master",
  "final mix",
  "final master",
  "mp3",
  "wav",
  "demo",
];

// Normalize an Airtable column name for fuzzy matching. Strips ALL
// parenthetical annotations — production label tables commonly use tag
// prefixes like "(Release) Release Date", "(PM) Primary Artist (Select)",
// and "(OLD) Legacy Field" to group fields by category. Users don't want
// to think about those tags when the sync tries to find "release date" or
// "primary artist" — so we drop them before matching.
function normalizeKey(k: string): string {
  return k
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Normalize an artist name for fuzzy roster matching. Strips punctuation
// (including "&", commas, etc. that Airtable may include for feature
// billing), lowercases, and collapses whitespace. Uses \p{L}\p{N} so we
// preserve non-ASCII letters and numbers.
function normalizeArtistName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Some Airtable field types return arrays (multi-select, linked-record).
// If a linked-record field returns raw record IDs (e.g. "recXXXXX"), the
// name isn't in the response and this row can't be matched — surface that
// so the admin knows the field type is wrong, not just an unknown artist.
function extractArtistNameString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === "string") return first;
  }
  return null;
}

function looksLikeAirtableRecordId(v: string): boolean {
  return /^rec[a-zA-Z0-9]{14}$/.test(v.trim());
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function pickField<T = unknown>(
  fields: Record<string, unknown>,
  candidates: string[],
): T | undefined {
  const lookup = new Map<string, unknown>();
  for (const k of Object.keys(fields)) lookup.set(normalizeKey(k), fields[k]);
  for (const c of candidates) {
    const v = lookup.get(normalizeKey(c));
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return undefined;
}

type AirtableRecord = {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
};

type ListResponse = {
  records: AirtableRecord[];
  offset?: string;
};

async function fetchAirtableRecords(args: {
  accessToken: string;
  baseId: string;
  tableName: string;
}): Promise<AirtableRecord[]> {
  const all: AirtableRecord[] = [];
  let offset: string | undefined;
  const base = `https://api.airtable.com/v0/${encodeURIComponent(
    args.baseId,
  )}/${encodeURIComponent(args.tableName)}`;

  // Paginate — Airtable returns up to 100 records per page.
  for (let page = 0; page < 30; page += 1) {
    const url = new URL(base);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${args.accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(
        `Airtable list ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as ListResponse;
    all.push(...data.records);
    if (!data.offset) break;
    offset = data.offset;
  }
  return all;
}

/**
 * Fetch upcoming-release rows from Airtable and reconcile them into the
 * upcoming_releases table. Adds new records, updates existing ones (by
 * airtable_record_id), and removes rows that no longer appear in Airtable.
 */
export async function syncUpcomingReleases(): Promise<{
  fetched: number;
  upserted: number;
  removed: number;
  skipped: number;
  errors: { record: string; reason: string }[];
}> {
  const auth = await getValidAirtableAuth();
  if (!auth.baseId || !auth.tableName) {
    throw new Error(
      "Airtable base + table not configured — set them in admin first.",
    );
  }
  const records = await fetchAirtableRecords({
    accessToken: auth.accessToken,
    baseId: auth.baseId,
    tableName: auth.tableName,
  });

  const artists = await db.select().from(schema.artists);
  const artistBySpotifyId = new Map(artists.map((a) => [a.spotifyId, a]));
  const artistByNormalizedName = new Map(
    artists.map((a) => [normalizeArtistName(a.name), a]),
  );

  let upserted = 0;
  let skipped = 0;
  const errors: { record: string; reason: string }[] = [];
  const seenRecordIds: string[] = [];
  const today = todayYmd();

  for (const rec of records) {
    const title = pickField<string>(rec.fields, TITLE_KEYS);
    const rawDate = pickField<string>(rec.fields, DATE_KEYS);
    if (!title) {
      skipped += 1;
      errors.push({ record: rec.id, reason: "missing title column" });
      continue;
    }

    // Airtable dates: YYYY-MM-DD for date columns, ISO datetime for
    // datetime columns, free text otherwise. Truncate to YYYY-MM-DD.
    const releaseDate = rawDate ? rawDate.slice(0, 10) : null;

    // Skip already-released rows so a big historical catalog table (like
    // Lexi's 1300+ row release log) doesn't flood the site with "upcoming"
    // items that already dropped. Rows with a blank date stay eligible —
    // they're likely TBD upcoming.
    if (releaseDate && releaseDate < today) {
      skipped += 1;
      continue;
    }

    // Resolve to a roster artist. Preferred paths in order:
    //   1. Spotify ID column (exact match — most reliable)
    //   2. Artist name column, normalized (fuzzy — handles casing, punct.)
    let artist: (typeof artists)[number] | undefined;
    const rawSpotify = pickField<string>(rec.fields, SPOTIFY_ID_KEYS);
    if (rawSpotify) {
      const spotifyId =
        rawSpotify.match(/[a-zA-Z0-9]{22}/)?.[0] ?? rawSpotify.trim();
      artist = artistBySpotifyId.get(spotifyId);
    }
    if (!artist) {
      const rawArtist = pickField<string | string[]>(rec.fields, ARTIST_NAME_KEYS);
      const artistNameStr = extractArtistNameString(rawArtist);
      if (artistNameStr) {
        if (looksLikeAirtableRecordId(artistNameStr)) {
          skipped += 1;
          errors.push({
            record: rec.id,
            reason:
              "artist column is a Linked Record field — needs to be text or lookup for name match",
          });
          continue;
        }
        artist = artistByNormalizedName.get(normalizeArtistName(artistNameStr));
      }
    }
    if (!artist) {
      skipped += 1;
      errors.push({
        record: rec.id,
        reason: "no roster artist matches this row",
      });
      continue;
    }

    // Pre-save/smart link: accept a plain URL or Airtable Button field
    // (object with { url, label }). Normalize to string | null.
    const rawPresave = pickField<unknown>(rec.fields, PRESAVE_URL_KEYS);
    let preSaveUrl: string | null = null;
    if (typeof rawPresave === "string" && rawPresave.trim().length > 0) {
      preSaveUrl = rawPresave.trim();
    } else if (
      rawPresave &&
      typeof rawPresave === "object" &&
      "url" in rawPresave &&
      typeof (rawPresave as { url?: unknown }).url === "string"
    ) {
      preSaveUrl = (rawPresave as { url: string }).url;
    }

    // Audio attachment — store just the attachment ID (URL rotates every
    // ~2h and would break for anyone visiting the site later). The audio
    // proxy endpoint re-fetches a fresh URL on each play using this ID
    // plus the record ID above.
    const rawAudio = pickField<unknown>(rec.fields, AUDIO_KEYS);
    let audioAttachmentId: string | null = null;
    let audioFilename: string | null = null;
    let audioMimeType: string | null = null;
    if (Array.isArray(rawAudio) && rawAudio.length > 0) {
      const first = rawAudio[0];
      if (first && typeof first === "object" && "id" in first) {
        const att = first as {
          id?: unknown;
          filename?: unknown;
          type?: unknown;
        };
        if (typeof att.id === "string") audioAttachmentId = att.id;
        if (typeof att.filename === "string") audioFilename = att.filename;
        if (typeof att.type === "string") audioMimeType = att.type;
      }
    }

    const [existing] = await db
      .select()
      .from(schema.upcomingReleases)
      .where(eq(schema.upcomingReleases.airtableRecordId, rec.id));
    if (existing) {
      await db
        .update(schema.upcomingReleases)
        .set({
          artistId: artist.id,
          title,
          releaseDate,
          preSaveUrl,
          audioAttachmentId,
          audioFilename,
          audioMimeType,
          syncedAt: new Date(),
        })
        .where(eq(schema.upcomingReleases.id, existing.id));
    } else {
      await db.insert(schema.upcomingReleases).values({
        artistId: artist.id,
        title,
        releaseDate,
        preSaveUrl,
        audioAttachmentId,
        audioFilename,
        audioMimeType,
        airtableRecordId: rec.id,
      });
    }
    seenRecordIds.push(rec.id);
    upserted += 1;
  }

  // Reconcile: rows in DB that no longer exist in Airtable get removed.
  const deleted = await db
    .delete(schema.upcomingReleases)
    .where(
      seenRecordIds.length > 0
        ? notInArray(schema.upcomingReleases.airtableRecordId, seenRecordIds)
        : sql`true`,
    )
    .returning({ id: schema.upcomingReleases.id });

  // Mark status
  await db
    .update(schema.siteSettings)
    .set({
      airtableSyncStatus: "done",
      airtableLastSyncedAt: new Date(),
      airtableLastError: errors.length > 0 ? errors[0].reason : null,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.siteSettings.id, "main"));

  // When nothing matched, surface the union of every field key seen across
  // the first several records + a breakdown of skip reasons. Union rather
  // than first-record slice because Airtable omits empty fields per record,
  // so any one row may not show every column.
  let diagnostic:
    | {
        allFieldNames: string[];
        skippedPastDates: number;
        skipReasonCounts: Record<string, number>;
      }
    | undefined;
  if (upserted === 0 && records.length > 0) {
    const keys = new Set<string>();
    for (const r of records.slice(0, 25)) {
      for (const k of Object.keys(r.fields)) keys.add(k);
    }
    const reasonCounts: Record<string, number> = {};
    for (const e of errors) {
      reasonCounts[e.reason] = (reasonCounts[e.reason] ?? 0) + 1;
    }
    const errorTotal = errors.length;
    diagnostic = {
      allFieldNames: [...keys].sort(),
      // Past-date skips don't create error rows (they're silent), so we
      // derive the count as: (total skipped) − (row-level error rows).
      skippedPastDates: Math.max(0, skipped - errorTotal),
      skipReasonCounts: reasonCounts,
    };
  }

  return {
    fetched: records.length,
    upserted,
    removed: deleted.length,
    skipped,
    errors,
    ...(diagnostic ? { diagnostic } : {}),
  };
}

/** Enumerate the OAuth user's accessible bases — used by the admin picker. */
export async function listAccessibleBases(): Promise<
  { id: string; name: string }[]
> {
  const auth = await getValidAirtableAuth();
  const res = await fetch("https://api.airtable.com/v0/meta/bases", {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `Airtable list bases ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as {
    bases: { id: string; name: string }[];
  };
  return data.bases;
}

/** Enumerate tables inside a base. Used by the admin picker. */
export async function listBaseTables(
  baseId: string,
): Promise<{ id: string; name: string }[]> {
  const auth = await getValidAirtableAuth();
  const res = await fetch(
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`,
    {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(
      `Airtable list tables ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as {
    tables: { id: string; name: string }[];
  };
  return data.tables;
}

