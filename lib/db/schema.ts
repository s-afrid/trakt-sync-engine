import { pgTable, text, timestamp, boolean, integer, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: varchar("id", { length: 128 }).primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const linkedAccounts = pgTable("linked_accounts", {
  id: varchar("id", { length: 128 }).primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull(),
  provider: varchar("provider", { length: 32 }).notNull(), // 'trakt' | 'myanimelist' | 'letterboxd'
  providerUserId: varchar("provider_user_id", { length: 128 }),
  providerUsername: varchar("provider_username", { length: 128 }).notNull(),
  avatarUrl: text("avatar_url"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at"),
  metadata: text("metadata"), // JSON string
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const syncSettings = pgTable("sync_settings", {
  id: varchar("id", { length: 128 }).primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull().unique(),
  syncTraktToMal: boolean("sync_trakt_to_mal").default(true).notNull(),
  syncMalToTrakt: boolean("sync_mal_to_trakt").default(false).notNull(),
  syncRatings: boolean("sync_ratings").default(true).notNull(),
  syncLetterboxdRss: boolean("sync_letterboxd_rss").default(true).notNull(),
  lastTraktSyncAt: timestamp("last_trakt_sync_at"),
  lastMalSyncAt: timestamp("last_mal_sync_at"),
  lastLetterboxdSyncAt: timestamp("last_letterboxd_sync_at"),
  status: varchar("status", { length: 32 }).default("idle").notNull(),
  lastErrorMessage: text("last_error_message"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const syncLogs = pgTable("sync_logs", {
  id: varchar("id", { length: 128 }).primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull(),
  type: varchar("type", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(), // 'success' | 'warning' | 'error'
  title: text("title").notNull(),
  details: text("details"),
  itemsCount: integer("items_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const animeIdCache = pgTable("anime_id_cache", {
  id: varchar("id", { length: 128 }).primaryKey(),
  traktId: integer("trakt_id"),
  tmdbId: integer("tmdb_id"),
  tvdbId: integer("tvdb_id"),
  malId: integer("mal_id").notNull(),
  title: text("title").notNull(),
  totalEpisodes: integer("total_episodes"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
