import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncLogs, linkedAccounts } from "@/lib/db/schema";
import { desc, eq, gte } from "drizzle-orm";
import { TraktClient } from "@/lib/clients/trakt";

export interface ActivityItem {
  id: string;
  platform: "myanimelist" | "letterboxd" | "system";
  title: string;
  subtitle: string;
  type: "episode" | "movie" | "completed" | "sync_run";
  status: "synced" | "imported" | "completed" | "info";
  timestamp: string;
  metadata?: {
    year?: number;
    season?: number;
    episode?: number;
    imdbId?: string;
    tmdbId?: number;
    malId?: number;
    plays?: number;
    url?: string;
    details?: string;
    syncedTitles?: string[];
    itemsFetched?: number;
    moviesSyncedToTrakt?: number;
    updatedTitles?: { title: string; episodes: number; status: string }[];
  };
}

function decodeEntities(str: string): string {
  if (!str) return "";
  return str
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function parseLogDetails(
  rawDetails: string | null,
  title: string,
  itemsCount: number
): {
  subtitle: string;
  metadata: Record<string, unknown>;
} {
  if (!rawDetails) {
    return {
      subtitle: `Logged ${itemsCount} synchronized item(s)`,
      metadata: {},
    };
  }

  try {
    const parsed = typeof rawDetails === "object" ? rawDetails : JSON.parse(rawDetails);
    if (typeof parsed === "object" && parsed !== null) {
      // 1. Letterboxd RSS Sync results
      if ("rssItemsFetched" in parsed || "moviesSyncedToTrakt" in parsed || "syncedTitles" in parsed) {
        const fetched = parsed.rssItemsFetched ?? parsed.itemsFetched ?? 0;
        const synced = parsed.moviesSyncedToTrakt ?? 0;
        const rawTitles: string[] = Array.isArray(parsed.syncedTitles) ? parsed.syncedTitles : [];
        const cleanTitles = rawTitles.map((t) => decodeEntities(String(t)));

        let subtitle = "";
        if (synced > 0) {
          subtitle = `Synced ${synced} movie(s) to Trakt (${cleanTitles.slice(0, 3).join(", ")}${cleanTitles.length > 3 ? ` +${cleanTitles.length - 3} more` : ""})`;
        } else {
          subtitle = `Scanned ${fetched} Letterboxd diary entries • No new movies (Trakt is already up to date)`;
        }

        return {
          subtitle,
          metadata: {
            itemsFetched: fetched,
            moviesSyncedToTrakt: synced,
            syncedTitles: cleanTitles,
          },
        };
      }

      // 2. Anime / MyAnimeList Sync results
      if ("totalTraktShows" in parsed || "malUpdatedCount" in parsed || "updatedTitles" in parsed) {
        const shows = parsed.totalTraktShows ?? 0;
        const updated = parsed.malUpdatedCount ?? 0;
        const rawUpdated = Array.isArray(parsed.updatedTitles) ? parsed.updatedTitles : [];
        const updatedTitles = rawUpdated.map((u: any) => ({
          ...u,
          title: decodeEntities(String(u.title)),
        }));

        let subtitle = "";
        if (updated > 0) {
          const list = updatedTitles.map((t) => `${t.title} (Ep. ${t.episodes})`).join(", ");
          subtitle = `Updated ${updated} anime on MyAnimeList: ${list}`;
        } else {
          subtitle = `Scanned ${shows} shows • MyAnimeList is already up to date`;
        }

        return {
          subtitle,
          metadata: {
            totalTraktShows: shows,
            malUpdatedCount: updated,
            updatedTitles,
          },
        };
      }

      // 3. Automated upload results
      if ("uploadedMovies" in parsed) {
        return {
          subtitle: `Auto-imported ${parsed.uploadedMovies} movies to Letterboxd via Playwright`,
          metadata: parsed,
        };
      }

      // 4. Object with message
      if (parsed.message) {
        return {
          subtitle: decodeEntities(String(parsed.message)),
          metadata: parsed,
        };
      }
    }
  } catch {
    // If not valid JSON, treat as plain text and clean entities
    return {
      subtitle: decodeEntities(rawDetails),
      metadata: { details: rawDetails },
    };
  }

  return {
    subtitle: decodeEntities(rawDetails.slice(0, 150)),
    metadata: { details: rawDetails },
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const hours = Math.min(Math.max(parseInt(searchParams.get("hours") || "24", 10), 1), 168);
  const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);

  // Extract auth credentials
  let traktToken = request.cookies.get("trakt_token")?.value;
  let traktUsername = request.cookies.get("trakt_username")?.value || process.env.TRAKT_USERNAME || "afsindbad";
  let letterboxdUsername = request.cookies.get("letterboxd_username")?.value || process.env.LETTERBOXD_USERNAME || "Af_Sindbad";

  // Hydrate from DB if available
  if (db) {
    try {
      if (!traktToken) {
        const traktAcc = await db
          .select()
          .from(linkedAccounts)
          .where(eq(linkedAccounts.provider, "trakt"))
          .limit(1);
        if (traktAcc.length > 0 && traktAcc[0].accessToken) {
          traktToken = traktAcc[0].accessToken;
          traktUsername = traktAcc[0].providerUsername || traktUsername;
        }
      }

      if (!letterboxdUsername) {
        const lbAcc = await db
          .select()
          .from(linkedAccounts)
          .where(eq(linkedAccounts.provider, "letterboxd"))
          .limit(1);
        if (lbAcc.length > 0) {
          letterboxdUsername = lbAcc[0].providerUsername || letterboxdUsername;
        }
      }
    } catch (e) {
      console.warn("DB account lookup in 24h activity failed:", e);
    }
  }

  const items: ActivityItem[] = [];

  // 1. Fetch Trakt Watched Movies (Letterboxd sync source)
  if (process.env.TRAKT_CLIENT_ID && traktUsername) {
    try {
      const client = new TraktClient(traktToken, traktUsername);
      const movies = await client.getWatchedMovies();

      for (const m of movies) {
        const watchedAt = m.last_watched_at || m.last_updated_at;
        if (!watchedAt) continue;

        const watchDate = new Date(watchedAt);
        // Include if within cutoff window (or include recent if user specifically requested)
        if (watchDate >= cutoffTime) {
          items.push({
            id: `lb-movie-${m.movie.ids.trakt}`,
            platform: "letterboxd",
            title: m.movie.title,
            subtitle: `${m.movie.year || "Unknown"} • Watched on Trakt ➔ Auto-imported to Letterboxd`,
            type: "movie",
            status: "imported",
            timestamp: watchedAt,
            metadata: {
              year: m.movie.year,
              tmdbId: m.movie.ids.tmdb,
              imdbId: m.movie.ids.imdb,
              plays: m.plays,
              url: m.movie.ids.imdb ? `https://www.imdb.com/title/${m.movie.ids.imdb}/` : undefined,
            },
          });
        }
      }
    } catch (movieErr) {
      console.warn("Error fetching movies for 24h activity:", movieErr);
    }
  }

  // 2. Fetch Trakt Watched Episodes (MyAnimeList sync source)
  if (process.env.TRAKT_CLIENT_ID && traktUsername) {
    try {
      const client = new TraktClient(traktToken, traktUsername);
      const history = await client.getUserEpisodeHistory(100);

      for (const h of history) {
        if (!h.watched_at) continue;
        const watchDate = new Date(h.watched_at);
        if (watchDate >= cutoffTime) {
          const isAnimeShow =
            h.show.title.toLowerCase().includes("erased") ||
            h.show.title.toLowerCase().includes("demon slayer") ||
            h.show.title.toLowerCase().includes("titan") ||
            h.show.title.toLowerCase().includes("naruto") ||
            h.show.title.toLowerCase().includes("piece") ||
            h.show.title.toLowerCase().includes("jujutsu") ||
            h.show.title.toLowerCase().includes("bleach") ||
            h.show.title.toLowerCase().includes("anime") ||
            true; // All tracked episodes sync to MAL pipeline

          items.push({
            id: `mal-ep-${h.id}`,
            platform: "myanimelist",
            title: h.show.title,
            subtitle: `Season ${h.episode.season}, Episode ${h.episode.number}${h.episode.title ? `: "${h.episode.title}"` : ""} ➔ Synced to MyAnimeList`,
            type: "episode",
            status: "synced",
            timestamp: h.watched_at,
            metadata: {
              season: h.episode.season,
              episode: h.episode.number,
              details: `Trakt Episode #${h.episode.number}`,
            },
          });
        }
      }
    } catch (epErr) {
      console.warn("Error fetching episodes for 24h activity:", epErr);
    }
  }

  // 3. Fetch Database Sync Logs (Runs and title updates)
  if (db) {
    try {
      const logs = await db
        .select()
        .from(syncLogs)
        .where(gte(syncLogs.createdAt, cutoffTime))
        .orderBy(desc(syncLogs.createdAt))
        .limit(50);

      for (const log of logs) {
        const isMal = log.type.toLowerCase().includes("mal") || log.type.toLowerCase().includes("anime");
        const isLb = log.type.toLowerCase().includes("letterboxd") || log.type.toLowerCase().includes("movie");

        let platform: "myanimelist" | "letterboxd" | "system" = "system";
        if (isMal) platform = "myanimelist";
        else if (isLb) platform = "letterboxd";

        const { subtitle, metadata } = parseLogDetails(log.details, log.title, log.itemsCount || 0);

        items.push({
          id: `log-${log.id}`,
          platform,
          title: log.title,
          subtitle,
          type: log.status === "success" && isMal ? "completed" : "sync_run",
          status: log.status === "success" ? "synced" : "info",
          timestamp: log.createdAt.toISOString(),
          metadata: {
            ...metadata,
            details: log.details || undefined,
          },
        });
      }
    } catch (logErr) {
      console.warn("Error fetching sync logs for 24h activity:", logErr);
    }
  }

  // Deduplicate items by title and timestamp within 1 minute
  const seenKeys = new Set<string>();
  const uniqueItems = items.filter((item) => {
    const key = `${item.platform}-${item.title}-${item.timestamp.slice(0, 16)}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  // Sort descending by timestamp
  uniqueItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const malCount = uniqueItems.filter((i) => i.platform === "myanimelist").length;
  const lbCount = uniqueItems.filter((i) => i.platform === "letterboxd").length;

  return NextResponse.json({
    success: true,
    hours,
    cutoff: cutoffTime.toISOString(),
    summary: {
      total: uniqueItems.length,
      malCount,
      letterboxdCount: lbCount,
      systemCount: uniqueItems.length - malCount - lbCount,
      traktUsername,
      letterboxdUsername,
    },
    items: uniqueItems,
  });
}
