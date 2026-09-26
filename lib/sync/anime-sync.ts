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

    // 1. Fetch Trakt watched shows, recent episode history, and user's current MAL list in parallel
    const [traktShows, traktEpisodeHistory, malList] = await Promise.all([
      this.traktClient.getWatchedShows(),
      this.traktClient.getUserEpisodeHistory(500),
      this.malClient.getUserAnimeList(),
    ]);

    result.totalTraktShows = traktShows.length;

    // Create a map of showTraktId -> { maxEp: number, uniqueEps: Set<number>, maxSeason: number }
    const showHistoryMap = new Map<
      number,
      { maxEp: number; uniqueEps: Set<number>; maxSeason: number }
    >();

    for (const h of traktEpisodeHistory) {
      const showId = h.show?.ids?.trakt;
      if (!showId || !h.episode) continue;

      let entry = showHistoryMap.get(showId);
      if (!entry) {
        entry = { maxEp: 0, uniqueEps: new Set<number>(), maxSeason: 1 };
        showHistoryMap.set(showId, entry);
      }
      if (h.episode.number) {
        entry.uniqueEps.add(h.episode.number);
        if (h.episode.number > entry.maxEp) {
          entry.maxEp = h.episode.number;
        }
      }
      if (h.episode.season && h.episode.season > entry.maxSeason) {
        entry.maxSeason = h.episode.season;
      }
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

      // 1. Gather all signals for episode progress
      let maxEpisodeWatched = 0;
      let uniqueEpisodesWatched = 0;

      // Signal A: Seasons data (present if connected via OAuth)
      if (item.seasons && item.seasons.length > 0) {
        for (const season of item.seasons) {
          if (season.number > 0 && season.episodes) {
            uniqueEpisodesWatched += season.episodes.length;
            for (const ep of season.episodes) {
              if (ep.number > maxEpisodeWatched) {
                maxEpisodeWatched = ep.number;
              }
            }
          }
        }
      }

      // Signal B: Pre-fetched recent episode history (from Trakt history)
      const historyInfo = showHistoryMap.get(item.show.ids.trakt);
      if (historyInfo) {
        if (historyInfo.maxEp > maxEpisodeWatched) {
          maxEpisodeWatched = historyInfo.maxEp;
        }
        if (historyInfo.uniqueEps.size > uniqueEpisodesWatched) {
          uniqueEpisodesWatched = historyInfo.uniqueEps.size;
        }
      }

      // Signal C: If still no episode detail (e.g. watched beyond 500 history items and no seasons)
      if (maxEpisodeWatched === 0 && !item.seasons) {
        try {
          const specificHistory = await this.traktClient.getShowEpisodeHistory(
            item.show.ids.trakt,
            100
          );
          if (specificHistory.length > 0) {
            for (const h of specificHistory) {
              if (h.episode?.number && h.episode.number > maxEpisodeWatched) {
                maxEpisodeWatched = h.episode.number;
              }
            }
            uniqueEpisodesWatched = new Set(
              specificHistory.map((h) => h.episode?.number).filter(Boolean)
            ).size;
          }
        } catch {
          // Graceful fallback
        }
      }

      // Signal D: Trakt plays count
      const traktPlays = item.plays || 0;

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

      const totalMalEpisodes =
        currentMalEntry?.node.num_episodes || item.show.aired_episodes || 0;

      // Determine completion status:
      // A user is completed if:
      // 1. Highest watched episode reached or exceeded total episodes (e.g. Ep 12 of 12)
      // 2. Or unique episodes watched reached total episodes
      // 3. Or Trakt plays count reached aired episodes
      const isCompleted =
        totalMalEpisodes > 0 &&
        (maxEpisodeWatched >= totalMalEpisodes ||
          uniqueEpisodesWatched >= totalMalEpisodes ||
          traktPlays >= totalMalEpisodes);

      let targetEpisodes = Math.max(maxEpisodeWatched, uniqueEpisodesWatched, traktPlays);
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
          await this.malClient.updateListStatus(malId, {
            status: newStatus,
            num_watched_episodes: Math.max(targetEpisodes, currentEpisodes),
            score: desiredScore || (currentScore > 0 ? currentScore : undefined),
          });

          result.malUpdatedCount++;
          result.updatedTitles.push({
            title: item.show.title,
            episodes: targetEpisodes,
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
