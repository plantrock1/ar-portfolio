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
} from "drizzle-orm/pg-core";

export const artists = pgTable("artists", {
  id: uuid("id").primaryKey().defaultRandom(),
  spotifyId: text("spotify_id").notNull().unique(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  imageUrl: text("image_url"),
  genres: text("genres").array().notNull().default([]),
  role: text("role"),
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
    albumName: text("album_name"),
    albumImageUrl: text("album_image_url"),
    releaseDate: text("release_date"),
    durationMs: integer("duration_ms"),
    explicit: boolean("explicit").notNull().default(false),
    pinned: boolean("pinned").notNull().default(false),
    hidden: boolean("hidden").notNull().default(false),
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

export const siteSettings = pgTable("site_settings", {
  id: text("id").primaryKey(),
  bio: text("bio").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Artist = typeof artists.$inferSelect;
export type NewArtist = typeof artists.$inferInsert;
export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;
export type ArtistSnapshot = typeof artistSnapshots.$inferSelect;
export type TrackSnapshot = typeof trackSnapshots.$inferSelect;
