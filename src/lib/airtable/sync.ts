import { db, schema } from "@/lib/db";
import { eq, notInArray, sql } from "drizzle-orm";
import { getValidAirtableAuth } from "./tokens";

// Airtable field-name normalization: we match user field names case-
// insensitively and pick the first key that looks like a match. This
// insulates us from small casing/whitespace differences in the base
// without needing a full mapping UI.
const TITLE_KEYS = [
  "title",
  "release title",
  "name",
  "track",
  "song title",
  "song",
  "release",
];
const DATE_KEYS = [
  "release date",
  "date",
  "releasedate",
  "drop date",
  "street date",
  "planned date",
];
const SPOTIFY_ID_KEYS = [
  "spotify artist id",
  "spotify id",
  "artist spotify id",
  "spotifyartistid",
];
const ARTIST_NAME_KEYS = [
  "artist",
  "artist name",
  "primary artist",
  "artists",
  "artist(s)",
];

function normalizeKey(k: string): string {
  return k.trim().toLowerCase();
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
          syncedAt: new Date(),
        })
        .where(eq(schema.upcomingReleases.id, existing.id));
    } else {
      await db.insert(schema.upcomingReleases).values({
        artistId: artist.id,
        title,
        releaseDate,
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

  // If literally nothing matched, dump the first record's field keys so the
  // admin can see which column names Airtable actually returned. This is
  // the fastest way to spot a header mismatch without adding a mapping UI.
  const sampleFieldNames =
    upserted === 0 && records.length > 0
      ? Object.keys(records[0].fields).slice(0, 20)
      : undefined;

  return {
    fetched: records.length,
    upserted,
    removed: deleted.length,
    skipped,
    errors,
    ...(sampleFieldNames ? { sampleFieldNames } : {}),
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

