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

function normalizeTitle(s: string) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

function findBestMovieMatch(
  searchResults: { movie: { title: string; year?: number; ids: { trakt: number; slug: string; imdb?: string; tmdb?: number }; overview?: string; rating?: number; genres?: string[] } }[],
  targetTitle: string,
  targetYear?: number
) {
  const normTarget = normalizeTitle(targetTitle);

  // 1. Exact normalized title and exact year
  if (targetYear) {
    const exact = searchResults.find((r) => {
      const m = r.movie;
      if (!m || !m.title) return false;
      return normalizeTitle(m.title) === normTarget && m.year === targetYear;
    });
    if (exact?.movie) return exact.movie;
  }

  // 2. Exact normalized title and year within +/- 1 (due to release date shifts)
  if (targetYear) {
    const near = searchResults.find((r) => {
      const m = r.movie;
      if (!m || !m.title) return false;
      return normalizeTitle(m.title) === normTarget && m.year && Math.abs(m.year - targetYear) <= 1;
    });
    if (near?.movie) return near.movie;
  }

  // 3. Exact normalized title without year requirement
  if (!targetYear) {
    const any = searchResults.find((r) => {
      const m = r.movie;
      if (!m || !m.title) return false;
      return normalizeTitle(m.title) === normTarget;
    });
    if (any?.movie) return any.movie;
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    // Extract credentials from cookies or environment
    let traktToken = request.cookies.get("trakt_token")?.value;
    let traktUsername = request.cookies.get("trakt_username")?.value || process.env.TRAKT_USERNAME || "afsindbad";
    let malToken = request.cookies.get("mal_token")?.value;
    let letterboxdUsername = request.cookies.get("letterboxd_username")?.value || process.env.LETTERBOXD_USERNAME || "Af_Sindbad";
    let letterboxdCookies = request.cookies.get("letterboxd_cookies")?.value;

    const traktUserCookie = request.cookies.get("trakt_user")?.value;
    if (traktUserCookie) {
      try {
        const parsed = JSON.parse(traktUserCookie);
        if (parsed.username) traktUsername = parsed.username;
      } catch {}
    }

    const letterboxdUserCookie = request.cookies.get("letterboxd_user")?.value;
    if (letterboxdUserCookie) {
      try {
        const parsed = JSON.parse(letterboxdUserCookie);
        if (parsed.username) letterboxdUsername = parsed.username;
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
          if (acc.provider === "letterboxd") {
            if (acc.providerUsername) letterboxdUsername = acc.providerUsername;
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
          const plays = ws.plays || 0;
          const completedEps = ws.seasons?.reduce((acc, s) => acc + (s.episodes?.length || 0), 0) || 0;

          if (totalAired > 0 && (plays >= totalAired || completedEps >= totalAired)) {
            completedShowTitles.add(title);
          } else if (plays > 0 || completedEps > 0) {
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
                posterUrl: m.ids?.imdb ? `https://images.metahub.space/poster/medium/${m.ids.imdb}/img` : undefined,
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

            // Filter out completed or started shows (started shows are moved to Continue Watching)
            for (const item of watchlistShows) {
              const s = item.show;
              if (!s) continue;
              const titleLower = s.title.trim().toLowerCase();
              if (completedShowTitles.has(titleLower) || startedShowTitles.has(titleLower)) {
                continue; // Skip completed or in-progress show
              }

              items.push({
                id: `trakt-show-${s.ids.trakt}`,
                platform: "trakt",
                type: "show",
                title: s.title,
                year: s.year,
                overview: s.overview,
                posterUrl: s.ids?.imdb ? `https://images.metahub.space/poster/medium/${s.ids.imdb}/img` : undefined,
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
            const rawItems = await LetterboxdClient.fetchUserWatchlistRss(
              letterboxdUsername,
              letterboxdCookies
            ).catch(() => []);

            for (const it of rawItems) {
              const filmTitle = (it.filmTitle || it.title).trim();
              const titleLower = filmTitle.toLowerCase();

              if (watchedMovieTitles.has(titleLower) || (it.tmdbId && watchedTmdbIds.has(it.tmdbId))) {
                continue; // Skip completed film
              }

              let tmdbId = it.tmdbId;
              let imdbId: string | undefined = undefined;
              let overview: string | undefined = undefined;
              let rating: number | undefined = undefined;
              let genres: string[] | undefined = undefined;
              let posterUrl = it.posterUrl;

              // Enrich with Trakt/TMDb metadata if traktClient is available
              if (traktClient && (!tmdbId || !posterUrl)) {
                try {
                  const searchResults = await traktClient.searchMovie(filmTitle, it.filmYear);
                  if (searchResults && searchResults.length > 0) {
                    const matched = findBestMovieMatch(searchResults, filmTitle, it.filmYear);
                    if (matched) {
                      if (!tmdbId && matched.ids?.tmdb) tmdbId = matched.ids.tmdb;
                      if (matched.ids?.imdb) imdbId = matched.ids.imdb;
                      if (matched.overview) overview = matched.overview;
                      if (matched.rating) rating = Math.round(matched.rating * 10) / 10;
                      if (matched.genres) genres = matched.genres;

                      if (tmdbId && watchedTmdbIds.has(tmdbId)) {
                        continue;
                      }

                      if (!posterUrl && imdbId) {
                        posterUrl = `https://images.metahub.space/poster/medium/${imdbId}/img`;
                      }
                    }
                  }
                } catch {}
              }

              // Fallback to scraping Letterboxd film page if poster or overview is still missing
              if ((!posterUrl || !overview) && it.reviewLink) {
                try {
                  const pageRes = await fetch(it.reviewLink, {
                    headers: {
                      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
                      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    },
                  });
                  if (pageRes.ok) {
                    const pageHtml = await pageRes.text();
                    if (!posterUrl) {
                      const ogImg = pageHtml.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1]
                        || pageHtml.match(/<meta\s+name="twitter:image"\s+content="([^"]+)"/i)?.[1];
                      if (ogImg) posterUrl = ogImg;
                    }
                    if (!overview) {
                      const ogDesc = pageHtml.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i)?.[1];
                      if (ogDesc) overview = ogDesc;
                    }
                  }
                } catch {}
              }

              items.push({
                id: `lb-${it.guid || tmdbId || filmTitle}`,
                platform: "letterboxd",
                type: "movie",
                title: filmTitle,
                year: it.filmYear,
                overview,
                rating,
                genres,
                posterUrl,
                url: it.reviewLink || `https://letterboxd.com/film/${encodeURIComponent(filmTitle)}/`,
                metadata: {
                  tmdbId,
                  imdbId,
                },
              });
            }
          } catch (e) {
            console.warn("Letterboxd watchlist fetch failed:", e);
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
