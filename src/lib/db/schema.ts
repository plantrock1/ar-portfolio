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
    spotifyId: text("spotify_id").notNull().unique(),
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
  (t) => [index("tracks_artist_id_idx").on(t.artistId)],
);

export const artistSnapshots = pgTable(
  "artist_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    followers: bigint("followers", { mode: "number" }).notNull(),
    monthlyListeners: bigint("monthly_listeners", { mode: "number" }),
    popularity: integer("popularity").notNull(),
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
    popularity: integer("popularity").notNull(),
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

export type Artist = typeof artists.$inferSelect;
export type NewArtist = typeof artists.$inferInsert;
export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;
export type ArtistSnapshot = typeof artistSnapshots.$inferSelect;
export type TrackSnapshot = typeof trackSnapshots.$inferSelect;
