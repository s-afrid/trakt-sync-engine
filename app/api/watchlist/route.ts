import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { linkedAccounts } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { TraktClient, TraktWatchlistItem } from "@/lib/clients/trakt";
import { MalClient, MalUserAnimeItem } from "@/lib/clients/mal";
import { LetterboxdClient, LetterboxdRssItem } from "@/lib/clients/letterboxd";

export interface WatchlistItem {
  id: string;
  platform: "trakt" | "letterboxd" | "myanimelist";
  type: "movie" | "show" | "anime";
  title: string;
  year?: number;
  overview?: string;
  rating?: number;
  posterUrl?: string;
  genres?: string[];
  totalEpisodes?: number;
  url?: string;
  listedAt?: string;
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
    // Extract credentials from cookies or environment
    let traktToken = request.cookies.get("trakt_token")?.value;
    let traktUsername = request.cookies.get("trakt_username")?.value || process.env.TRAKT_USERNAME || "afsindbad";
    let malToken = request.cookies.get("mal_token")?.value;
    let letterboxdUsername = request.cookies.get("letterboxd_username")?.value || process.env.LETTERBOXD_USERNAME || "Af_Sindbad";
    let letterboxdCookies = request.cookies.get("letterboxd_cookies")?.value;

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
          if (acc.provider === "letterboxd") {
            if (!letterboxdUsername && acc.providerUsername) letterboxdUsername = acc.providerUsername;
            if (!letterboxdCookies && acc.accessToken) letterboxdCookies = acc.accessToken;
          }
        }
      } catch (e) {
        console.warn("DB account lookup in watchlist failed:", e);
      }
    }

    const items: WatchlistItem[] = [];
    const watchedMovieTitles = new Set<string>();
    const watchedTmdbIds = new Set<number>();
    const completedShowTitles = new Set<string>();
    const startedShowTitles = new Set<string>();

    // 1. Fetch Trakt Watched data first (to know which movies & shows are completed/started)
    let traktClient: TraktClient | null = null;
    if (traktUsername || traktToken) {
      traktClient = new TraktClient(traktToken, traktUsername);
      try {
        const [watchedMovies, watchedShows] = await Promise.all([
          traktClient.getWatchedMovies().catch(() => []),
          traktClient.getWatchedShows().catch(() => []),
        ]);

        for (const wm of watchedMovies) {
          if (wm.movie?.title) watchedMovieTitles.add(wm.movie.title.trim().toLowerCase());
          if (wm.movie?.ids?.tmdb) watchedTmdbIds.add(wm.movie.ids.tmdb);
        }

        for (const ws of watchedShows) {
          const title = ws.show?.title?.trim().toLowerCase();
          if (!title) continue;
          const totalAired = ws.show?.aired_episodes || 0;
          const completedEps = ws.seasons?.reduce((acc, s) => acc + (s.episodes?.length || 0), 0) || 0;

          if (totalAired > 0 && completedEps >= totalAired) {
            completedShowTitles.add(title);
          } else if (completedEps > 0) {
            startedShowTitles.add(title);
          }
        }
      } catch (e) {
        console.warn("Error fetching Trakt watched history for watchlist filter:", e);
      }
    }

    // 2. Fetch Letterboxd Diary RSS (to cross-check watched Letterboxd movies)
    if (letterboxdUsername) {
      try {
        const lbDiary = await LetterboxdClient.fetchUserRss(letterboxdUsername).catch(() => []);
        for (const it of lbDiary) {
          if (it.filmTitle) watchedMovieTitles.add(it.filmTitle.trim().toLowerCase());
          if (it.tmdbId) watchedTmdbIds.add(it.tmdbId);
        }
      } catch {}
    }

    // 3. Fetch Watchlists in Parallel
    const fetchPromises: Promise<void>[] = [];

    // --- Trakt Watchlist ---
    if (traktClient) {
      fetchPromises.push(
        (async () => {
          try {
            const [watchlistMovies, watchlistShows] = await Promise.all([
              traktClient!.getWatchlistMovies().catch(() => []),
              traktClient!.getWatchlistShows().catch(() => []),
            ]);

            // Filter out completed movies
            for (const item of watchlistMovies) {
              const m = item.movie;
              if (!m) continue;
              const titleLower = m.title.trim().toLowerCase();
              if (watchedMovieTitles.has(titleLower) || (m.ids?.tmdb && watchedTmdbIds.has(m.ids.tmdb))) {
                continue; // Skip completed movie
              }

              items.push({
                id: `trakt-movie-${m.ids.trakt}`,
                platform: "trakt",
                type: "movie",
                title: m.title,
                year: m.year,
                overview: m.overview,
                rating: m.rating ? Math.round(m.rating * 10) / 10 : undefined,
                genres: m.genres,
                url: `https://trakt.tv/movies/${m.ids.slug || m.ids.trakt}`,
                listedAt: item.listed_at,
                metadata: {
                  traktId: m.ids.trakt,
                  tmdbId: m.ids.tmdb,
                  imdbId: m.ids.imdb,
                },
              });
            }

            // Filter out completed shows
            for (const item of watchlistShows) {
              const s = item.show;
              if (!s) continue;
              const titleLower = s.title.trim().toLowerCase();
              if (completedShowTitles.has(titleLower)) {
                continue; // Skip completed show
              }

              items.push({
                id: `trakt-show-${s.ids.trakt}`,
                platform: "trakt",
                type: "show",
                title: s.title,
                year: s.year,
                overview: s.overview,
                rating: s.rating ? Math.round(s.rating * 10) / 10 : undefined,
                genres: s.genres,
                totalEpisodes: s.aired_episodes,
                url: `https://trakt.tv/shows/${s.ids.slug || s.ids.trakt}`,
                listedAt: item.listed_at,
                metadata: {
                  traktId: s.ids.trakt,
                  tmdbId: s.ids.tmdb,
                  imdbId: s.ids.imdb,
                },
              });
            }
          } catch (e) {
            console.warn("Trakt watchlist fetch failed:", e);
          }
        })()
      );
    }

    // --- Letterboxd Watchlist ---
    if (letterboxdUsername) {
      fetchPromises.push(
        (async () => {
          try {
            const rssItems = await LetterboxdClient.fetchUserWatchlistRss(
              letterboxdUsername,
              letterboxdCookies
            ).catch(() => []);

            for (const it of rssItems) {
              const titleLower = (it.filmTitle || it.title).trim().toLowerCase();
              if (watchedMovieTitles.has(titleLower) || (it.tmdbId && watchedTmdbIds.has(it.tmdbId))) {
                continue; // Skip completed film
              }

              items.push({
                id: `lb-${it.guid || it.tmdbId || it.filmTitle}`,
                platform: "letterboxd",
                type: "movie",
                title: it.filmTitle || it.title,
                year: it.filmYear,
                posterUrl: it.posterUrl,
                url: it.reviewLink || `https://letterboxd.com/film/${encodeURIComponent(it.filmTitle || it.title)}/`,
                metadata: {
                  tmdbId: it.tmdbId,
                },
              });
            }
          } catch (e) {
            console.warn("Letterboxd watchlist RSS fetch failed:", e);
          }
        })()
      );
    }

    // --- MyAnimeList Plan to Watch ---
    if (malToken) {
      fetchPromises.push(
        (async () => {
          try {
            const malClient = new MalClient(malToken);
            const planToWatch = await malClient.getUserAnimeList("plan_to_watch").catch(() => []);

            for (const item of planToWatch) {
              const node = item.node;
              if (!node) continue;
              const status = item.list_status?.status;
              if (status === "completed" || status === "watching") {
                continue; // Skip completed or in-progress anime
              }

              items.push({
                id: `mal-${node.id}`,
                platform: "myanimelist",
                type: "anime",
                title: node.title,
                posterUrl: node.main_picture?.large || node.main_picture?.medium,
                totalEpisodes: node.num_episodes,
                rating: item.list_status?.score && item.list_status.score > 0 ? item.list_status.score : undefined,
                url: `https://myanimelist.net/anime/${node.id}`,
                listedAt: item.list_status?.updated_at,
                metadata: {
                  malId: node.id,
                },
              });
            }
          } catch (e) {
            console.warn("MAL plan_to_watch fetch failed:", e);
          }
        })()
      );
    }

    await Promise.all(fetchPromises);

    // Compute Summary counts
    const summary = {
      total: items.length,
      traktCount: items.filter((i) => i.platform === "trakt").length,
      letterboxdCount: items.filter((i) => i.platform === "letterboxd").length,
      malCount: items.filter((i) => i.platform === "myanimelist").length,
      moviesCount: items.filter((i) => i.type === "movie").length,
      showsCount: items.filter((i) => i.type === "show").length,
      animeCount: items.filter((i) => i.type === "anime").length,
    };

    return NextResponse.json({
      success: true,
      summary,
      items,
    });
  } catch (error: unknown) {
    console.error("GET /api/watchlist error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load watchlist",
        items: [],
      },
      { status: 500 }
    );
  }
}
