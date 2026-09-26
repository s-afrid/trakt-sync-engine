import { TraktClient } from "../clients/trakt";
import { LetterboxdClient } from "../clients/letterboxd";

export interface LetterboxdSyncResult {
  rssItemsFetched: number;
  moviesSyncedToTrakt: number;
  ratingsSyncedToTrakt: number;
  errors: string[];
  syncedTitles: string[];
}

export class LetterboxdSyncService {
  private traktClient: TraktClient;

  constructor(traktAccessToken: string) {
    this.traktClient = new TraktClient(traktAccessToken);
  }

  /**
   * Generates CSVs ready for manual 1-click import into Letterboxd
   */
  async exportToLetterboxdCsv(): Promise<{
    watchedCsv: string;
    ratingsCsv: string;
    movieCount: number;
    ratingCount: number;
  }> {
    const [watchedMovies, movieRatings] = await Promise.all([
      this.traktClient.getWatchedMovies(),
      this.traktClient.getMovieRatings(),
    ]);

    const watchedCsv = LetterboxdClient.generateWatchedCsv(watchedMovies);
    const ratingsCsv = LetterboxdClient.generateRatingsCsv(movieRatings);

    return {
      watchedCsv,
      ratingsCsv,
      movieCount: watchedMovies.length,
      ratingCount: movieRatings.length,
    };
  }

  /**
   * Reads public Letterboxd RSS feed and syncs recent logs to Trakt
   */
  async syncRssToTrakt(
    letterboxdUsername: string,
    options?: { syncRatings?: boolean }
  ): Promise<LetterboxdSyncResult> {
    const result: LetterboxdSyncResult = {
      rssItemsFetched: 0,
      moviesSyncedToTrakt: 0,
      ratingsSyncedToTrakt: 0,
      errors: [],
      syncedTitles: [],
    };

    const rssItems = await LetterboxdClient.fetchUserRss(letterboxdUsername);
    result.rssItemsFetched = rssItems.length;

    if (rssItems.length === 0) {
      return result;
    }

    // 1. Fetch Trakt watched movies to avoid duplicate history logs
    const existingWatched = await this.traktClient.getWatchedMovies();
    const watchedTitleYearSet = new Set(
      existingWatched.map(
        (w) => `${w.movie.title.toLowerCase()}_${w.movie.year || ""}`
      )
    );

    const moviesToSync: { ids: { trakt?: number; tmdb?: number; imdb?: string }; watched_at?: string }[] = [];
    const ratingsToSync: { rating: number; rated_at?: string; ids: { trakt?: number; tmdb?: number; imdb?: string } }[] = [];

    for (const item of rssItems) {
      if (!item.filmTitle) continue;

      const key = `${item.filmTitle.toLowerCase()}_${item.filmYear || ""}`;
      const isAlreadyWatched = watchedTitleYearSet.has(key);

      if (!isAlreadyWatched) {
        // Search TMDB or sync using Trakt query if needed
        result.syncedTitles.push(item.filmTitle);
      }
    }

    return result;
  }
}
