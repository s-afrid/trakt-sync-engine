import { TraktClient, TraktShowWatched } from "../clients/trakt";
import { MalClient, MalUserAnimeItem } from "../clients/mal";
import { AnimeMapper } from "../clients/mapper";

export interface AnimeSyncResult {
  totalTraktShows: number;
  animeIdentified: number;
  malMatchesFound: number;
  malUpdatedCount: number;
  errors: string[];
  unmatchedTitles: string[];
  updatedTitles: {
    title: string;
    episodes: number;
    status: string;
    malId: number;
    verified: boolean;
  }[];
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
      unmatchedTitles: [],
      updatedTitles: [],
    };

    // 1. Fetch Trakt watched shows, recent episode history, and user's current MAL list in parallel
    const [traktShows, traktEpisodeHistory, malList] = await Promise.all([
      this.traktClient.getWatchedShows(),
      this.traktClient.getUserEpisodeHistory(500),
      this.malClient.getUserAnimeList(),
    ]);

    result.totalTraktShows = traktShows.length;

    // Count unique episodes by season and episode number. Episode numbers
    // restart at 1 each season, so deduplicating on episode number alone
    // undercounts multi-season anime (for example S1E5 and S2E5).
    const showEpisodeMap = new Map<number, Set<string>>();

    for (const h of traktEpisodeHistory) {
      const showId = h.show?.ids?.trakt;
      if (!showId || !h.episode) continue;

      if (!h.episode.number || h.episode.season <= 0) continue;
      let episodes = showEpisodeMap.get(showId);
      if (!episodes) {
        episodes = new Set<string>();
        showEpisodeMap.set(showId, episodes);
      }
      episodes.add(`${h.episode.season}:${h.episode.number}`);
    }

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

      // Merge Trakt's watched-season data and history by season/episode key.
      const watchedEpisodeKeys = new Set<string>();

      // Signal A: Seasons data (present if connected via OAuth)
      if (item.seasons && item.seasons.length > 0) {
        for (const season of item.seasons) {
          if (season.number > 0 && season.episodes) {
            for (const ep of season.episodes) {
              if (ep.number > 0) watchedEpisodeKeys.add(`${season.number}:${ep.number}`);
            }
          }
        }
      }

      // Add recent history as well; duplicates across the two Trakt sources
      // collapse to the same key while repeated episode numbers in new seasons do not.
      for (const key of showEpisodeMap.get(item.show.ids.trakt) ?? []) {
        watchedEpisodeKeys.add(key);
      }

      // Signal B: For shows absent from the watched-season response, fetch
      // this show's history directly rather than infer progress from show plays.
      if (watchedEpisodeKeys.size === 0) {
        try {
          const specificHistory = await this.traktClient.getShowEpisodeHistory(
            item.show.ids.trakt,
            100
          );
          if (specificHistory.length > 0) {
            for (const h of specificHistory) {
              if (h.episode?.number > 0 && h.episode.season > 0) {
                watchedEpisodeKeys.add(`${h.episode.season}:${h.episode.number}`);
              }
            }
          }
        } catch {
          // Graceful fallback
        }
      }

      // Prefer the exact title already present on this user's MAL list. This
      // avoids a stale/shared ID cache sending progress to a different anime.
      const normalizedTitle = this.normalizeTitle(item.show.title);
      const existingTitleMatch = malList.find(
        (malItem) => this.normalizeTitle(malItem.node.title) === normalizedTitle
      );

      const malId = existingTitleMatch?.node.id ?? await AnimeMapper.resolveMalId({
        title: item.show.title,
        traktId: item.show.ids.trakt,
        tmdbId: item.show.ids.tmdb,
        tvdbId: item.show.ids.tvdb,
        malClient: this.malClient,
      });

      if (!malId) {
        result.unmatchedTitles.push(item.show.title);
        continue;
      }

      result.malMatchesFound++;
      const currentMalEntry = malMap.get(malId);
      const currentEpisodes = currentMalEntry?.list_status.num_episodes_watched || 0;
      const currentScore = currentMalEntry?.list_status.score || 0;
      const desiredScore = ratingsMap.get(item.show.ids.trakt);

      const totalMalEpisodes =
        currentMalEntry?.node.num_episodes || item.show.aired_episodes || 0;

      // Completion is based on distinct watched episodes, not the maximum
      // episode number or show play count. Both are misleading for multiple
      // seasons, where episode numbering restarts at 1.
      const isCompleted =
        totalMalEpisodes > 0 &&
        watchedEpisodeKeys.size >= totalMalEpisodes;

      let targetEpisodes = watchedEpisodeKeys.size;
      if (isCompleted && totalMalEpisodes > 0) {
        targetEpisodes = totalMalEpisodes;
      } else if (totalMalEpisodes > 0 && targetEpisodes > totalMalEpisodes) {
        targetEpisodes = totalMalEpisodes;
      }

      const newStatus: "watching" | "completed" = isCompleted ? "completed" : "watching";

      // Check if MAL needs updating
      const needsEpisodeUpdate =
        targetEpisodes > currentEpisodes ||
        (isCompleted && currentMalEntry?.list_status.status !== "completed");
      const needsScoreUpdate =
        options?.syncRatings && desiredScore && desiredScore !== currentScore;

      if (needsEpisodeUpdate || needsScoreUpdate) {
        try {
          const savedStatus = await this.malClient.updateListStatus(malId, {
            status: newStatus,
            num_watched_episodes: Math.max(targetEpisodes, currentEpisodes),
            score: desiredScore || (currentScore > 0 ? currentScore : undefined),
          });

          const savedEpisodes = savedStatus.num_episodes_watched;
          const expectedEpisodes = Math.max(targetEpisodes, currentEpisodes);
          if (savedEpisodes < expectedEpisodes) {
            throw new Error(
              `MAL accepted the update but returned ${savedEpisodes} watched episodes; expected ${expectedEpisodes}`
            );
          }

          result.malUpdatedCount++;
          result.updatedTitles.push({
            title: item.show.title,
            episodes: savedEpisodes,
            status: savedStatus.status,
            malId,
            verified: true,
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

  private normalizeTitle(title: string): string {
    return title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\(\d{4}\)/g, "")
      .replace(/[^a-z0-9]/g, "");
  }
}
