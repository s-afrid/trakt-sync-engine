import { TraktClient, TraktShowWatched } from "../clients/trakt";
import { MalClient, MalUserAnimeItem } from "../clients/mal";
import { AnimeMapper } from "../clients/mapper";

export interface AnimeSyncResult {
  totalTraktShows: number;
  animeIdentified: number;
  malMatchesFound: number;
  malUpdatedCount: number;
  errors: string[];
  updatedTitles: { title: string; episodes: number; status: string }[];
}

export class AnimeSyncService {
  private traktClient: TraktClient;
  private malClient: MalClient;

  constructor(traktAccessToken?: string, malAccessToken?: string, traktUsername?: string) {
    this.traktClient = new TraktClient(traktAccessToken, traktUsername);
    this.malClient = new MalClient(malAccessToken);
  }

  /**
   * Syncs watched progress from Trakt to MyAnimeList
   */
  async syncTraktToMal(options?: {
    syncRatings?: boolean;
    batchLimit?: number;
  }): Promise<AnimeSyncResult> {
    const result: AnimeSyncResult = {
      totalTraktShows: 0,
      animeIdentified: 0,
      malMatchesFound: 0,
      malUpdatedCount: 0,
      errors: [],
      updatedTitles: [],
    };

    // 1. Fetch Trakt watched shows and user's current MAL list in parallel
    const [traktShows, malList] = await Promise.all([
      this.traktClient.getWatchedShows(),
      this.malClient.getUserAnimeList(),
    ]);

    result.totalTraktShows = traktShows.length;

    // Create a map of MAL anime for quick O(1) comparison: malId -> MalUserAnimeItem
    const malMap = new Map<number, MalUserAnimeItem>();
    for (const item of malList) {
      malMap.set(item.node.id, item);
    }

    // Optional ratings map
    const ratingsMap = new Map<number, number>();
    if (options?.syncRatings) {
      const traktRatings = await this.traktClient.getShowRatings();
      for (const r of traktRatings) {
        if (r.show?.ids.trakt) {
          ratingsMap.set(r.show.ids.trakt, r.rating);
        }
      }
    }

    // Process Trakt shows
    const limit = options?.batchLimit || 50;
    let processed = 0;

    for (const item of traktShows) {
      if (processed >= limit) break;

      const isAnime = this.isLikelyAnime(item);
      if (!isAnime) continue;

      result.animeIdentified++;

      // Count total watched episodes from Trakt seasons
      let traktEpisodesWatched = 0;
      if (item.seasons) {
        for (const season of item.seasons) {
          // Ignore specials (season 0) for standard MAL episode count
          if (season.number > 0 && season.episodes) {
            traktEpisodesWatched += season.episodes.length;
          }
        }
      }

      if (traktEpisodesWatched === 0 && item.plays > 0) {
        traktEpisodesWatched = item.plays;
      }

      // Resolve MAL ID
      const malId = await AnimeMapper.resolveMalId({
        title: item.show.title,
        traktId: item.show.ids.trakt,
        tmdbId: item.show.ids.tmdb,
        tvdbId: item.show.ids.tvdb,
        malClient: this.malClient,
      });

      if (!malId) {
        continue;
      }

      result.malMatchesFound++;
      const currentMalEntry = malMap.get(malId);
      const currentEpisodes = currentMalEntry?.list_status.num_episodes_watched || 0;
      const currentScore = currentMalEntry?.list_status.score || 0;
      const desiredScore = ratingsMap.get(item.show.ids.trakt);

      // Check if MAL needs updating
      const needsEpisodeUpdate = traktEpisodesWatched > currentEpisodes;
      const needsScoreUpdate =
        options?.syncRatings && desiredScore && desiredScore !== currentScore;

      if (needsEpisodeUpdate || needsScoreUpdate) {
        try {
          const totalMalEpisodes = currentMalEntry?.node.num_episodes || 0;
          let newStatus: "watching" | "completed" = "watching";

          if (totalMalEpisodes > 0 && traktEpisodesWatched >= totalMalEpisodes) {
            newStatus = "completed";
          }

          await this.malClient.updateListStatus(malId, {
            status: newStatus,
            num_watched_episodes: Math.max(traktEpisodesWatched, currentEpisodes),
            score: desiredScore || (currentScore > 0 ? currentScore : undefined),
          });

          result.malUpdatedCount++;
          result.updatedTitles.push({
            title: item.show.title,
            episodes: traktEpisodesWatched,
            status: newStatus,
          });

          processed++;
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Failed to update "${item.show.title}" (MAL ID ${malId}): ${errorMsg}`);
        }
      }
    }

    return result;
  }

  private isLikelyAnime(item: TraktShowWatched): boolean {
    const genres = item.show.genres || [];
    if (genres.includes("anime")) return true;

    // Check titles for known anime naming conventions or Asian languages
    const title = item.show.title.toLowerCase();
    if (genres.includes("animation")) {
      // If animated and from Japan / Asian origin, or has anime keywords
      return true;
    }

    return false;
  }
}
