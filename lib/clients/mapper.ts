import { MalClient } from "./mal";
import { db } from "../db";
import { animeIdCache } from "../db/schema";
import { eq, or } from "drizzle-orm";

interface MappingItem {
  mal_id?: number;
  anidb_id?: number;
  anilist_id?: number;
  kitsu_id?: number;
  thetvdb_id?: number;
  themoviedb_id?: number;
  title?: string;
}

// In-memory cache for fast lookups in serverless lifecycle
const memoryCache = new Map<string, number>();

// Community Anime Mapping repository
const MAPPING_URL =
  "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json";

let remoteMappingCache: MappingItem[] | null = null;
let lastRemoteFetch = 0;

async function getRemoteMappings(): Promise<MappingItem[]> {
  const now = Date.now();
  // Cache in memory for 12 hours
  if (remoteMappingCache && now - lastRemoteFetch < 12 * 60 * 60 * 1000) {
    return remoteMappingCache;
  }

  try {
    const res = await fetch(MAPPING_URL, { next: { revalidate: 43200 } });
    if (res.ok) {
      remoteMappingCache = await res.json();
      lastRemoteFetch = now;
      return remoteMappingCache || [];
    }
  } catch (err) {
    console.warn("Failed to fetch Fribb anime mapping:", err);
  }

  return remoteMappingCache || [];
}

export class AnimeMapper {
  static async resolveMalId(params: {
    title: string;
    tmdbId?: number;
    tvdbId?: number;
    traktId?: number;
    malClient?: MalClient;
  }): Promise<number | null> {
    const { title, tmdbId, tvdbId, traktId, malClient } = params;

    // 1. Check in-memory key
    const memKey = `${traktId ?? ""}-${tmdbId ?? ""}-${tvdbId ?? ""}-${title.toLowerCase()}`;
    if (memoryCache.has(memKey)) {
      return memoryCache.get(memKey)!;
    }

    // 2. Check Database Cache if DB is configured
    if (db) {
      try {
        const conditions = [];
        if (traktId) conditions.push(eq(animeIdCache.traktId, traktId));
        if (tmdbId) conditions.push(eq(animeIdCache.tmdbId, tmdbId));
        if (tvdbId) conditions.push(eq(animeIdCache.tvdbId, tvdbId));

        if (conditions.length > 0) {
          const cached = await db
            .select()
            .from(animeIdCache)
            .where(or(...conditions))
            .limit(1);

          if (cached.length > 0 && cached[0].malId) {
            memoryCache.set(memKey, cached[0].malId);
            return cached[0].malId;
          }
        }
      } catch (err) {
        console.warn("DB anime cache lookup error:", err);
      }
    }

    // 3. Check Remote Mappings dataset (TMDB/TVDB match)
    const mappings = await getRemoteMappings();
    const match = mappings.find((item) => {
      if (tmdbId && item.themoviedb_id === tmdbId) return true;
      if (tvdbId && item.thetvdb_id === tvdbId) return true;
      return false;
    });

    if (match && match.mal_id) {
      memoryCache.set(memKey, match.mal_id);
      await this.saveToDbCache({
        traktId,
        tmdbId,
        tvdbId,
        malId: match.mal_id,
        title,
      });
      return match.mal_id;
    }

    // 4. Fallback: Search MAL directly by title if malClient is provided
    if (malClient) {
      try {
        // Clean title: remove suffixes like (TV), (2024), Season 2
        const cleanTitle = title.replace(/\(\d{4}\)/g, "").trim();
        const searchResults = await malClient.searchAnime(cleanTitle);

        if (searchResults.length > 0) {
          const foundId = searchResults[0].id;
          memoryCache.set(memKey, foundId);
          await this.saveToDbCache({
            traktId,
            tmdbId,
            tvdbId,
            malId: foundId,
            title,
          });
          return foundId;
        }
      } catch (err) {
        console.warn(`MAL title search failed for "${title}":`, err);
      }
    }

    return null;
  }

  private static async saveToDbCache(entry: {
    traktId?: number;
    tmdbId?: number;
    tvdbId?: number;
    malId: number;
    title: string;
  }) {
    if (!db) return;
    try {
      await db.insert(animeIdCache).values({
        id: `cache_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        traktId: entry.traktId,
        tmdbId: entry.tmdbId,
        tvdbId: entry.tvdbId,
        malId: entry.malId,
        title: entry.title,
      });
    } catch {
      // Ignore unique collision or transient errors
    }
  }
}
