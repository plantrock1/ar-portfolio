import {
  pgTable,
  text,
  integer,
  bigint,
  timestamp,
  boolean,
  uuid,
  index,
  unique,
  jsonb,
} from "drizzle-orm/pg-core";

export type ArtistSocials = {
  instagram?: string;
  tiktok?: string;
  twitter?: string;
  email?: string;
  soundcloud?: string;
  website?: string;
  /** Legacy — kept so existing data isn't dropped, but hidden from new UI. */
  youtube?: string;
};

export const artists = pgTable("artists", {
  id: uuid("id").primaryKey().defaultRandom(),
  spotifyId: text("spotify_id").notNull().unique(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  imageUrl: text("image_url"),
  genres: text("genres").array().notNull().default([]),
  role: text("role"),
  bio: text("bio").notNull().default(""),
  socials: jsonb("socials").$type<ArtistSocials>().notNull().default({}),
  displayOrder: integer("display_order").notNull().default(0),
  hidden: boolean("hidden").notNull().default(false),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spotifyId: text("spotify_id").notNull(),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isrc: text("isrc"),
    albumName: text("album_name"),
    albumImageUrl: text("album_image_url"),
    releaseDate: text("release_date"),
    durationMs: integer("duration_ms"),
    explicit: boolean("explicit").notNull().default(false),
    pinned: boolean("pinned").notNull().default(false),
    hidden: boolean("hidden").notNull().default(false),
    isPrimary: boolean("is_primary").notNull().default(false),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tracks_artist_id_idx").on(t.artistId),
    unique("tracks_artist_spotify_unique").on(t.artistId, t.spotifyId),
  ],
);

export const artistSnapshots = pgTable(
  "artist_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    followers: bigint("followers", { mode: "number" }),
    monthlyListeners: bigint("monthly_listeners", { mode: "number" }),
    popularity: integer("popularity"),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("artist_snapshots_artist_id_captured_at_idx").on(
      t.artistId,
      t.capturedAt,
    ),
    unique("artist_snapshots_artist_day_unique").on(t.artistId, t.capturedAt),
  ],
);

export const trackSnapshots = pgTable(
  "track_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    streams: bigint("streams", { mode: "number" }),
    popularity: integer("popularity"),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("track_snapshots_track_id_captured_at_idx").on(
      t.trackId,
      t.capturedAt,
    ),
  ],
);

export const refreshRuns = pgTable("refresh_runs", {
  id: text("id").primaryKey(), // single 'current' row
  kind: text("kind").notNull(), // 'shallow' | 'deep'
  status: text("status").notNull(), // 'idle' | 'running' | 'done' | 'failed'
  phase: text("phase"),
  message: text("message"),
  artistIndex: integer("artist_index").notNull().default(0),
  artistTotal: integer("artist_total").notNull().default(0),
  albumsScraped: integer("albums_scraped").notNull().default(0),
  albumsTotal: integer("albums_total").notNull().default(0),
  tracksUpserted: integer("tracks_upserted").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  error: text("error"),
});

export const siteSettings = pgTable("site_settings", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull().default(""),
  bio: text("bio").notNull().default(""),
  bioPhotoUrl: text("bio_photo_url"),
  socials: jsonb("socials").$type<ArtistSocials>().notNull().default({}),
  showListenerChart: boolean("show_listener_chart").notNull().default(false),
  spotifySpDc: text("spotify_sp_dc"),
  spotifySessionStatus: text("spotify_session_status").notNull().default("unknown"),
  spotifySessionUpdatedAt: timestamp("spotify_session_updated_at", {
    withTimezone: true,
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const featuredItems = pgTable("featured_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // 'press' | 'media'
  title: text("title").notNull(),
  url: text("url").notNull(),
  imageUrl: text("image_url"),
  source: text("source"), // optional label, e.g., "Rolling Stone" or "YouTube"
  displayOrder: integer("display_order").notNull().default(0),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Artist = typeof artists.$inferSelect;
export type NewArtist = typeof artists.$inferInsert;
export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;
export type ArtistSnapshot = typeof artistSnapshots.$inferSelect;
export type TrackSnapshot = typeof trackSnapshots.$inferSelect;
