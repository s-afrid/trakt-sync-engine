import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncLogs, linkedAccounts } from "@/lib/db/schema";
import { desc, eq, gte } from "drizzle-orm";
import { TraktClient } from "@/lib/clients/trakt";
import { MalClient, MalUserAnimeItem } from "@/lib/clients/mal";
import { LetterboxdClient } from "@/lib/clients/letterboxd";

export interface ActivityItem {
  id: string;
  platform: "myanimelist" | "letterboxd" | "system";
  title: string;
  subtitle: string;
  type: "episode" | "movie" | "completed" | "sync_run";
  status: "synced" | "imported" | "completed" | "info" | "pending" | "warning" | "error";
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
    posterUrl?: string;
    fanartUrl?: string;
    screenshotUrl?: string;
    genres?: string[];
    rating?: number;
    overview?: string;
    showTitle?: string;
    details?: string;
    syncedTitles?: string[];
    itemsFetched?: number;
    moviesSyncedToTrakt?: number;
    updatedTitles?: { title: string; episodes: number; status: string }[];
    errors?: string[];
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

interface UpdatedAnimeTitle {
  title: string;
  episodes: number;
  status?: string;
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
        const cleanTitles: string[] = rawTitles.map((t: string) => decodeEntities(String(t)));

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
        const errors: string[] = Array.isArray(parsed.errors)
          ? parsed.errors.map((error: unknown) => decodeEntities(String(error)))
          : [];
        const updatedTitles: UpdatedAnimeTitle[] = rawUpdated.map((u: any) => ({
          title: decodeEntities(String(u?.title || "")),
          episodes: Number(u?.episodes) || 0,
          status: String(u?.status || ""),
        }));

        let subtitle = "";
        if (updated > 0) {
          const list = updatedTitles
            .map((t: UpdatedAnimeTitle) => `${t.title} (Ep. ${t.episodes})`)
            .join(", ");
          subtitle = `Updated ${updated} anime on MyAnimeList: ${list}`;
        } else if (errors.length > 0) {
          subtitle = `Scanned ${shows} shows • ${errors.length} MAL update error(s)`;
        } else {
          subtitle = `Scanned ${shows} shows • MyAnimeList is already up to date`;
        }

        return {
          subtitle,
          metadata: {
            totalTraktShows: shows,
            malUpdatedCount: updated,
            updatedTitles,
            errors,
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
  let malToken = request.cookies.get("mal_token")?.value;
  let letterboxdUsername = request.cookies.get("letterboxd_username")?.value || process.env.LETTERBOXD_USERNAME || "Af_Sindbad";

  // Hydrate from DB if available
  if (db) {
    try {
      const accounts = await db
        .select()
        .from(linkedAccounts)
        .orderBy(desc(linkedAccounts.updatedAt));

      for (const acc of accounts) {
        if (acc.provider === "trakt") {
          if (!traktToken && acc.accessToken) traktToken = acc.accessToken;
          if (!traktUsername && acc.providerUsername) traktUsername = acc.providerUsername;
        }
        if (acc.provider === "myanimelist" && !malToken && acc.accessToken) {
          malToken = acc.accessToken;
        }
        if (acc.provider === "letterboxd" && !letterboxdUsername && acc.providerUsername) {
          letterboxdUsername = acc.providerUsername;
        }
      }
    } catch (e) {
      console.warn("DB account lookup in 24h activity failed:", e);
    }
  }

  // Retrieve confirmed Letterboxd diary titles directly from live Letterboxd RSS
  const verifiedLbTitles = new Set<string>();
  const verifiedLbTmdbIds = new Set<number>();
  const lbPosterByTitle = new Map<string, string>();
  const lbPosterByTmdb = new Map<number, string>();

  if (letterboxdUsername) {
    try {
      const rssItems = await LetterboxdClient.fetchUserRss(letterboxdUsername);
      for (const item of rssItems) {
        if (item.filmTitle) {
          const clean = item.filmTitle.trim().toLowerCase();
          verifiedLbTitles.add(clean);
          if (item.posterUrl) lbPosterByTitle.set(clean, item.posterUrl);
        }
        if (item.title) {
          const base = item.title.split(",")[0].trim().toLowerCase();
          verifiedLbTitles.add(base);
          if (item.posterUrl) lbPosterByTitle.set(base, item.posterUrl);
        }
        if (item.tmdbId) {
          verifiedLbTmdbIds.add(item.tmdbId);
          if (item.posterUrl) lbPosterByTmdb.set(item.tmdbId, item.posterUrl);
        }
      }
    } catch (e) {
      console.warn("Live Letterboxd RSS fetch in 24h activity failed, falling back to DB logs:", e);
    }
  }

  // Fallback to DB logs if live RSS returned empty
  if (verifiedLbTitles.size === 0 && db) {
    try {
      const lbLog = await db
        .select()
        .from(syncLogs)
        .where(eq(syncLogs.type, "letterboxd_rss"))
        .orderBy(desc(syncLogs.createdAt))
        .limit(1);

      if (lbLog.length > 0 && lbLog[0].details) {
        try {
          const parsed = JSON.parse(lbLog[0].details);
          if (Array.isArray(parsed.syncedTitles)) {
            for (const t of parsed.syncedTitles) {
              verifiedLbTitles.add(String(t).trim().toLowerCase());
            }
          }
        } catch {}
      }
    } catch {}
  }

  // Retrieve live MAL user anime list to confirm actual watched status
  let malList: MalUserAnimeItem[] = [];
  if (malToken) {
    try {
      const malClient = new MalClient(malToken);
      malList = await malClient.getUserAnimeList();
    } catch (malErr) {
      console.warn("Could not fetch MAL list for 24h activity confirmation:", malErr);
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
        if (watchDate >= cutoffTime) {
          const cleanTitle = m.movie.title.trim().toLowerCase();
          const isConfirmedInLb =
            verifiedLbTitles.has(cleanTitle) ||
            (m.movie.ids.tmdb ? verifiedLbTmdbIds.has(m.movie.ids.tmdb) : false);

          const status: "imported" | "pending" = isConfirmedInLb ? "imported" : "pending";
          const subtitle = isConfirmedInLb
            ? `${m.movie.year || "Unknown"} • Confirmed in Letterboxd Diary`
            : `${m.movie.year || "Unknown"} • Watched on Trakt (Pending Letterboxd auto-import)`;

          // Poster URL resolution
          let posterUrl: string | undefined = undefined;
          if (m.movie.ids.tmdb && lbPosterByTmdb.has(m.movie.ids.tmdb)) {
            posterUrl = lbPosterByTmdb.get(m.movie.ids.tmdb);
          } else if (lbPosterByTitle.has(cleanTitle)) {
            posterUrl = lbPosterByTitle.get(cleanTitle);
          } else if (m.movie.images?.poster && m.movie.images.poster.length > 0) {
            const raw = m.movie.images.poster[0];
            posterUrl = raw.startsWith("http") ? raw : `https://${raw}`;
          }

          const fanartUrl = m.movie.images?.fanart?.[0]
            ? (m.movie.images.fanart[0].startsWith("http") ? m.movie.images.fanart[0] : `https://${m.movie.images.fanart[0]}`)
            : undefined;

          items.push({
            id: `lb-movie-${m.movie.ids.trakt}`,
            platform: "letterboxd",
            title: m.movie.title,
            subtitle,
            type: "movie",
            status,
            timestamp: watchedAt,
            metadata: {
              year: m.movie.year,
              tmdbId: m.movie.ids.tmdb,
              imdbId: m.movie.ids.imdb,
              plays: m.plays,
              url: m.movie.ids.imdb ? `https://www.imdb.com/title/${m.movie.ids.imdb}/` : undefined,
              posterUrl,
              fanartUrl,
              genres: m.movie.genres,
              rating: m.movie.rating,
              overview: m.movie.overview,
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
        
        // Only include actual anime in the MAL feed!
        const genres = h.show.genres || [];
        const isAnime = genres.includes("anime") || genres.includes("animation");
        if (!isAnime) continue;

        const watchDate = new Date(h.watched_at);
        if (watchDate >= cutoffTime) {
          const showTitleLower = h.show.title.toLowerCase();

          // Check if confirmed on MAL
          const malMatch = malList.find((item) => {
            const itemTitle = item.node.title.toLowerCase();
            return (
              itemTitle.includes(showTitleLower) ||
              showTitleLower.includes(itemTitle) ||
              (showTitleLower.includes("erased") && itemTitle.includes("boku dake"))
            );
          });

          const isConfirmedOnMal =
            malMatch &&
            malMatch.list_status &&
            malMatch.list_status.num_episodes_watched >= h.episode.number;

          const status: "synced" | "pending" = isConfirmedOnMal ? "synced" : "pending";
          const subtitle = isConfirmedOnMal
            ? `Season ${h.episode.season}, Episode ${h.episode.number}${h.episode.title ? `: "${h.episode.title}"` : ""} • Confirmed on MyAnimeList (Ep. ${malMatch.list_status.num_episodes_watched}/${malMatch.node.num_episodes || "?"})`
            : `Season ${h.episode.season}, Episode ${h.episode.number}${h.episode.title ? `: "${h.episode.title}"` : ""} • Watched on Trakt (Pending MAL sync)`;

          let animePosterUrl: string | undefined = undefined;
          if (malMatch?.node.main_picture?.large) {
            animePosterUrl = malMatch.node.main_picture.large;
          } else if (malMatch?.node.main_picture?.medium) {
            animePosterUrl = malMatch.node.main_picture.medium;
          } else if (h.show.images?.poster && h.show.images.poster.length > 0) {
            const raw = h.show.images.poster[0];
            animePosterUrl = raw.startsWith("http") ? raw : `https://${raw}`;
          }

          const episodeScreenshot = h.episode.images?.screenshot?.[0]
            ? (h.episode.images.screenshot[0].startsWith("http") ? h.episode.images.screenshot[0] : `https://${h.episode.images.screenshot[0]}`)
            : undefined;

          items.push({
            id: `mal-ep-${h.id}`,
            platform: "myanimelist",
            title: h.show.title,
            subtitle,
            type: "episode",
            status,
            timestamp: h.watched_at,
            metadata: {
              year: h.show.year,
              season: h.episode.season,
              episode: h.episode.number,
              imdbId: h.episode.ids.imdb || h.show.ids.imdb,
              tmdbId: h.episode.ids.tmdb || h.show.ids.tmdb,
              malId: malMatch?.node.id,
              url: malMatch?.node.id ? `https://myanimelist.net/anime/${malMatch.node.id}` : undefined,
              posterUrl: animePosterUrl,
              screenshotUrl: episodeScreenshot,
              showTitle: h.show.title,
              genres: h.show.genres,
              overview: h.episode.overview || h.show.overview,
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
          status:
            log.status === "error"
              ? "error"
              : log.status === "warning"
              ? "warning"
              : log.status === "success"
              ? "synced"
              : "info",
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
