import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { linkedAccounts } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { TraktClient, TraktShowWatched } from "@/lib/clients/trakt";
import { MalClient, MalUserAnimeItem } from "@/lib/clients/mal";

export interface ContinueWatchingItem {
  id: string;
  platform: "myanimelist" | "trakt";
  type: "anime" | "show";
  title: string;
  year?: number;
  posterUrl?: string;
  completedEpisodes: number;
  totalEpisodes?: number;
  progressPercent?: number;
  lastWatchedEpisode?: string;
  nextEpisode?: string;
  completedEpisodesList?: number[];
  lastWatchedAt?: string;
  url?: string;
  genres?: string[];
  rating?: number;
  metadata?: {
    traktId?: number;
    tmdbId?: number;
    imdbId?: string;
    tvdbId?: number;
    malId?: number;
  };
}

export async function GET(request: NextRequest) {
  try {
    // Extract credentials
    let traktToken = request.cookies.get("trakt_token")?.value;
    let traktUsername = request.cookies.get("trakt_username")?.value || process.env.TRAKT_USERNAME || "afsindbad";
    let malToken = request.cookies.get("mal_token")?.value;

    const traktUserCookie = request.cookies.get("trakt_user")?.value;
    if (traktUserCookie) {
      try {
        const parsed = JSON.parse(traktUserCookie);
        if (parsed.username) traktUsername = parsed.username;
      } catch {}
    }

    // Hydrate from DB if available
    if (db) {
      try {
        const accounts = await db
          .select()
          .from(linkedAccounts)
          .orderBy(desc(linkedAccounts.updatedAt));

        for (const acc of accounts) {
          if (acc.provider === "trakt") {
            if (acc.accessToken) traktToken = acc.accessToken;
            if (acc.providerUsername) traktUsername = acc.providerUsername;
          }
          if (acc.provider === "myanimelist" && !malToken && acc.accessToken) {
            malToken = acc.accessToken;
          }
        }
      } catch (e) {
        console.warn("DB account lookup in continue-watching failed:", e);
      }
    }

    const items: ContinueWatchingItem[] = [];
    const fetchPromises: Promise<void>[] = [];

    // 1. MyAnimeList - Anime currently watching
    if (malToken) {
      fetchPromises.push(
        (async () => {
          try {
            const malClient = new MalClient(malToken);
            const watchingAnime = await malClient.getUserAnimeList("watching").catch(() => []);

            for (const item of watchingAnime) {
              const node = item.node;
              if (!node) continue;
              const completedCount = item.list_status?.num_episodes_watched || 0;
              const totalCount = node.num_episodes || 0;

              // If marked completed, skip
              if (totalCount > 0 && completedCount >= totalCount) {
                continue;
              }

              const percent = totalCount > 0 ? Math.min(Math.round((completedCount / totalCount) * 100), 100) : undefined;
              const nextEp = totalCount > 0 && completedCount >= totalCount ? undefined : `Episode ${completedCount + 1}`;

              // Generate array of completed episode numbers
              const epList: number[] = [];
              for (let i = 1; i <= completedCount; i++) {
                epList.push(i);
              }

              items.push({
                id: `mal-watching-${node.id}`,
                platform: "myanimelist",
                type: "anime",
                title: node.title,
                posterUrl: node.main_picture?.large || node.main_picture?.medium,
                completedEpisodes: completedCount,
                totalEpisodes: totalCount > 0 ? totalCount : undefined,
                progressPercent: percent,
                lastWatchedEpisode: completedCount > 0 ? `Episode ${completedCount}` : "Not started",
                nextEpisode: nextEp,
                completedEpisodesList: epList,
                lastWatchedAt: item.list_status?.updated_at,
                rating: item.list_status?.score && item.list_status.score > 0 ? item.list_status.score : undefined,
                url: `https://myanimelist.net/anime/${node.id}`,
                metadata: {
                  malId: node.id,
                },
              });
            }
          } catch (e) {
            console.warn("Error fetching MAL watching anime:", e);
          }
        })()
      );
    }

    // 2. Trakt - TV Shows with progress in progress
    if (traktUsername || traktToken) {
      fetchPromises.push(
        (async () => {
          try {
            const traktClient = new TraktClient(traktToken, traktUsername);
            const [watchedShows, episodeHistory] = await Promise.all([
              traktClient.getWatchedShows().catch(() => []),
              traktClient.getUserEpisodeHistory(500).catch(() => []),
            ]);

            // Index history by show ID and title
            const historyByShowId = new Map<number, { season: number; number: number; title: string; watchedAt: string }[]>();
            const historyByTitle = new Map<string, { season: number; number: number; title: string; watchedAt: string }[]>();

            for (const h of episodeHistory) {
              if (!h.show || !h.episode) continue;
              const entry = {
                season: h.episode.season,
                number: h.episode.number,
                title: h.episode.title,
                watchedAt: h.watched_at,
              };
              if (h.show.ids?.trakt) {
                if (!historyByShowId.has(h.show.ids.trakt)) historyByShowId.set(h.show.ids.trakt, []);
                historyByShowId.get(h.show.ids.trakt)!.push(entry);
              }
              const titleKey = h.show.title.toLowerCase().trim();
              if (!historyByTitle.has(titleKey)) historyByTitle.set(titleKey, []);
              historyByTitle.get(titleKey)!.push(entry);
            }

            for (const item of watchedShows) {
              const show = item.show;
              if (!show) continue;
              const showId = show.ids?.trakt;

              const totalAired = show.aired_episodes || 0;
              const histEntries = (showId ? historyByShowId.get(showId) : null) || historyByTitle.get(show.title.toLowerCase().trim()) || [];

              // Collect watched episodes from seasons if present, or from history
              const watchedEps: { season: number; number: number; lastWatched: string }[] = [];
              if (item.seasons && item.seasons.length > 0) {
                for (const season of item.seasons) {
                  if (season.number === 0) continue;
                  for (const ep of season.episodes || []) {
                    watchedEps.push({
                      season: season.number,
                      number: ep.number,
                      lastWatched: ep.last_watched_at,
                    });
                  }
                }
              } else if (histEntries.length > 0) {
                const seen = new Set<string>();
                for (const h of histEntries) {
                  if (h.season === 0) continue;
                  const key = `${h.season}-${h.number}`;
                  if (!seen.has(key)) {
                    seen.add(key);
                    watchedEps.push({
                      season: h.season,
                      number: h.number,
                      lastWatched: h.watchedAt,
                    });
                  }
                }
              }

              // Sort to find the latest watched episode
              watchedEps.sort((a, b) => new Date(b.lastWatched).getTime() - new Date(a.lastWatched).getTime());
              const latestEp = watchedEps[0];

              const uniqueCount = watchedEps.length;
              const plays = item.plays || 0;

              // Completion checks:
              // 1. Plays >= total aired
              const isCompletedByPlays = totalAired > 0 && plays >= totalAired;
              // 2. Unique watched episodes in history >= total aired
              const isCompletedByHistory = totalAired > 0 && uniqueCount >= totalAired;
              // 3. Finale episode watched (season finale / series finale)
              const isCompletedByFinale = totalAired > 0 && latestEp && latestEp.number >= totalAired;

              if (isCompletedByPlays || isCompletedByHistory || isCompletedByFinale) {
                continue; // Show is fully completed
              }

              // Determine completed count (unique watched episodes or total plays)
              let completedCount = uniqueCount > 0 ? uniqueCount : plays;
              if (completedCount === 0) continue;

              const lastWatchedFormatted = latestEp
                ? `S${String(latestEp.season).padStart(2, "0")}E${String(latestEp.number).padStart(2, "0")}`
                : undefined;

              const percent = totalAired > 0 ? Math.min(Math.round((completedCount / totalAired) * 100), 100) : undefined;
              const nextEp = latestEp
                ? `S${String(latestEp.season).padStart(2, "0")}E${String(latestEp.number + 1).padStart(2, "0")}`
                : undefined;

              // Generate array of completed episode numbers
              const epList: number[] = [];
              for (let i = 1; i <= completedCount; i++) {
                epList.push(i);
              }

              const posterUrl = show.ids?.imdb
                ? `https://images.metahub.space/poster/medium/${show.ids.imdb}/img`
                : undefined;

              items.push({
                id: `trakt-show-progress-${show.ids.trakt}`,
                platform: "trakt",
                type: "show",
                title: show.title,
                year: show.year,
                posterUrl,
                completedEpisodes: completedCount,
                totalEpisodes: totalAired > 0 ? totalAired : undefined,
                progressPercent: percent,
                lastWatchedEpisode: lastWatchedFormatted,
                nextEpisode: nextEp,
                completedEpisodesList: epList,
                lastWatchedAt: item.last_watched_at || (latestEp ? latestEp.lastWatched : undefined),
                genres: show.genres,
                url: `https://trakt.tv/shows/${show.ids.slug || show.ids.trakt}`,
                metadata: {
                  traktId: show.ids.trakt,
                  tmdbId: show.ids.tmdb,
                  imdbId: show.ids.imdb,
                  tvdbId: show.ids.tvdb,
                },
              });
            }
          } catch (e) {
            console.warn("Error fetching Trakt in-progress shows:", e);
          }
        })()
      );
    }

    await Promise.all(fetchPromises);

    // Sort by latest watched activity descending
    items.sort((a, b) => {
      const timeA = a.lastWatchedAt ? new Date(a.lastWatchedAt).getTime() : 0;
      const timeB = b.lastWatchedAt ? new Date(b.lastWatchedAt).getTime() : 0;
      return timeB - timeA;
    });

    const summary = {
      total: items.length,
      animeCount: items.filter((i) => i.platform === "myanimelist").length,
      showCount: items.filter((i) => i.platform === "trakt").length,
      totalEpisodesWatched: items.reduce((acc, i) => acc + i.completedEpisodes, 0),
    };

    return NextResponse.json({
      success: true,
      summary,
      items,
    });
  } catch (error: unknown) {
    console.error("GET /api/continue-watching error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load continue watching items",
        items: [],
      },
      { status: 500 }
    );
  }
}
