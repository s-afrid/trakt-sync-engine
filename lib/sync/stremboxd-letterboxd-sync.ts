/**
 * StremboxdLetterboxdSync — TypeScript port of the Python sync_movies_via_stremboxd()
 *
 * Flow (mirrors Harbor's lib/stremboxd/client.ts):
 *   1. POST api.stremboxd.com/auth/login  → userToken + userId
 *   2. GET  /stremio/{userId}/stream/movie/{imdbId}.json
 *          → streams[] with current watched/watchlist state + pre-signed action URLs
 *   3. GET  watchedUrl?set=true    → marks film as Watched on Letterboxd
 *   4. GET  watchlistUrl?set=false → removes from Watchlist
 *
 * No browser, no Playwright, no xvfb — pure HTTP.
 */

import { TraktClient, type TraktMovieWatched } from "../clients/trakt";

const STREMBOXD_BASE = "https://api.stremboxd.com";

const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "TraktSyncEngine/1.0",
  Accept: "application/json",
};

class StremboxdRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StremboxdRateLimitError";
  }
}

export interface StremboxdSession {
  userToken: string;
  userId: string;
  username: string;
  loginAt: number; // epoch ms
}

export interface FilmActions {
  watched: boolean;
  inWatchlist: boolean;
  watchedUrl: string | null;
  watchlistUrl: string | null;
  letterboxdUrl: string | null;
}

export interface LetterboxdSyncResult {
  newMoviesFound: number;
  pending: number;
  alreadySynced: number;
  markedWatched: number;
  removedFromWatchlist: number;
  skipped: number;
  errors: string[];
  syncedTitles: string[];
  syncedMovies: Array<{ title: string; imdbId: string; posterDataUrl?: string }>;
}

async function cacheMoviePoster(movie: TraktMovieWatched["movie"]): Promise<string | undefined> {
  const imagePath = movie.images?.poster?.[0];
  if (!imagePath) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(imagePath) ? imagePath : `https://${imagePath.replace(/^\/\//, "")}`);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".trakt.tv")) return undefined;
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) return undefined;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > 300_000) return undefined;
    const contentType = response.headers.get("content-type")?.split(";")[0] || "image/webp";
    return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return undefined;
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function stremboxdLogin(
  username: string,
  password: string
): Promise<StremboxdSession> {
  const res = await fetch(`${STREMBOXD_BASE}/auth/login`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Stremboxd login failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    userToken: string;
    user: { id: string; username: string };
  };

  return {
    userToken: data.userToken,
    userId: data.user.id,
    username: data.user.username,
    loginAt: Date.now(),
  };
}

/** Token is valid for ~24h; we refresh after 20h. */
export function isSessionFresh(session: StremboxdSession): boolean {
  const ageHours = (Date.now() - session.loginAt) / (1000 * 60 * 60);
  return ageHours < 20;
}

// ── Film actions ──────────────────────────────────────────────────────────────

function toggleSetParam(url: string, nextSet: boolean): string {
  try {
    const u = new URL(url);
    u.searchParams.set("set", String(nextSet));
    return u.toString();
  } catch {
    return url.replace(/set=[^&]+/, `set=${nextSet}`);
  }
}

export async function getFilmActions(
  userId: string,
  userToken: string,
  imdbId: string
): Promise<FilmActions | null> {
  const url = `${STREMBOXD_BASE}/stremio/${userId}/stream/movie/${encodeURIComponent(imdbId)}.json`;

  const res = await fetch(url, {
    headers: { ...HEADERS, Authorization: `Bearer ${userToken}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const message = `Stremboxd stream HTTP ${res.status}: ${body.slice(0, 200)}`;
    if (res.status === 429) throw new StremboxdRateLimitError(message);
    throw new Error(message);
  }

  const body = (await res.json()) as { streams?: Array<{ name?: string; description?: string; externalUrl?: string }> };
  const streams = body.streams ?? [];
  if (streams.length === 0) return null;

  const actions: FilmActions = {
    watched: false,
    inWatchlist: false,
    watchedUrl: null,
    watchlistUrl: null,
    letterboxdUrl: null,
  };

  for (const s of streams) {
    const name = s.name ?? "";
    const extUrl = s.externalUrl ?? "";

    // Info stream: parse description for current state
    if (name === "Letterboxd" || (!extUrl.includes("/action/") && !actions.letterboxdUrl)) {
      actions.letterboxdUrl = extUrl || null;
      for (const line of (s.description ?? "").split("\n")) {
        if (line.includes("✓ Watched")) actions.watched = true;
        if (line.includes("In Watchlist")) actions.inWatchlist = true;
      }
    }

    // Action streams — identified by URL path
    if (extUrl.includes("/watched/")) actions.watchedUrl = extUrl;
    if (extUrl.includes("/watchlist/")) actions.watchlistUrl = extUrl;
  }

  return actions;
}

// ── Main sync ─────────────────────────────────────────────────────────────────

export class StremboxdLetterboxdSync {
  private traktClient: TraktClient;

  constructor(traktToken?: string, traktUsername?: string) {
    this.traktClient = new TraktClient(traktToken, traktUsername);
  }

  /**
   * Considers only the five most recently watched Trakt movies and marks
   * unsynced entries as Watched on Letterboxd via the Stremboxd API.
   *
   * Returns the updated state (new syncedIds + latestWatchedAt) so the caller
   * can persist it to the DB.
   */
  async syncNewMovies(opts: {
    session: StremboxdSession;
    syncedImdbIds: Set<string>;     // already synced — skip these
    pendingImdbIds?: Set<string>;   // failed IDs retry even after cursor movement
    lastWatchedAt: string | null;   // ISO checkpoint retained for status and migration compatibility
  }): Promise<{
    result: LetterboxdSyncResult;
    newSyncedIds: Set<string>;
    pendingImdbIds: Set<string>;
    newLatestWatchedAt: string | null;
  }> {
    const { session, syncedImdbIds, lastWatchedAt } = opts;
    const pendingImdbIds = new Set(opts.pendingImdbIds ?? []);
    const result: LetterboxdSyncResult = {
      newMoviesFound: 0,
      pending: 0,
      alreadySynced: 0,
      markedWatched: 0,
      removedFromWatchlist: 0,
      skipped: 0,
      errors: [],
      syncedTitles: [],
      syncedMovies: [],
    };

    const newSyncedIds = new Set(syncedImdbIds);
    let newLatestWatchedAt = lastWatchedAt;

    // Fetch all watched movies from Trakt
    const allMovies: TraktMovieWatched[] = await this.traktClient.getWatchedMovies();

    // Always inspect only the five most recently watched unique movies. This
    // prevents a first sync from spending many cycles replaying old history.
    const recentMovies = allMovies
      .filter((movie) => Number.isFinite(new Date(movie.last_watched_at).getTime()))
      .sort((a, b) => new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime())
      .slice(0, 5);
    const recentImdbIds = new Set(recentMovies.map((movie) => movie.movie?.ids?.imdb).filter((id): id is string => Boolean(id)));
    // Drop retries that have aged out of the five-movie window.
    for (const imdbId of pendingImdbIds) {
      if (!recentImdbIds.has(imdbId)) pendingImdbIds.delete(imdbId);
    }
    const candidates = recentMovies.filter((movie) => {
      const imdbId = movie.movie?.ids?.imdb;
      return !imdbId || pendingImdbIds.has(imdbId) || !syncedImdbIds.has(imdbId);
    });

    result.newMoviesFound = candidates.length;
    const newestTimestamp = recentMovies.reduce((latest, movie) => Math.max(latest, new Date(movie.last_watched_at).getTime()), 0);
    if (newestTimestamp > 0) newLatestWatchedAt = new Date(newestTimestamp).toISOString();

    if (candidates.length === 0) {
      result.pending = pendingImdbIds.size;
      return { result, newSyncedIds, pendingImdbIds, newLatestWatchedAt };
    }

    // The candidate window is capped at five, keeping each invocation bounded.
    const batch = candidates;
    let attemptedCount = 0;
    let stoppedForRateLimit = false;

    for (const m of batch) {
      attemptedCount++;
      const imdbId = m.movie.ids.imdb;
      const title = m.movie.title;
      if (!imdbId) {
        result.skipped++;
        result.errors.push(`Cannot sync "${title}": Trakt did not provide an IMDb ID.`);
        continue;
      }

      // Already synced — skip
      if (syncedImdbIds.has(imdbId)) {
        result.alreadySynced++;
        newSyncedIds.add(imdbId);
        pendingImdbIds.delete(imdbId);
        continue;
      }

      try {
        const actions = await getFilmActions(session.userId, session.userToken, imdbId);

        if (!actions) {
          // Film not in Stremboxd/Letterboxd database
          result.skipped++;
          result.errors.push(`Film not found on Stremboxd for "${title}" (${imdbId}); it will be retried.`);
          pendingImdbIds.add(imdbId);
          console.warn(`[Stremboxd] Film not found: ${title} (${imdbId})`);
          continue;
        }

        let markedAsWatched = false;

        // Step 1: Mark as Watched
        if (actions.watched) {
          console.log(`[Stremboxd] ✅ ${title} — already Watched`);
          result.markedWatched++;
          markedAsWatched = true;
        } else if (actions.watchedUrl) {
          const markUrl = toggleSetParam(actions.watchedUrl, true);
          const wRes = await fetch(markUrl, {
            headers: { ...HEADERS, Authorization: `Bearer ${session.userToken}` },
            redirect: "follow",
          });
          if (wRes.status === 429) {
            const body = await wRes.text().catch(() => "");
            throw new StremboxdRateLimitError(
              `Watch toggle HTTP 429 for "${title}": ${body.slice(0, 200)}`
            );
          }
          if (wRes.ok) {
            console.log(`[Stremboxd] ✅ ${title} — marked as Watched`);
            result.markedWatched++;
            markedAsWatched = true;
          } else {
            const err = `Watch toggle HTTP ${wRes.status} for "${title}"`;
            console.warn(`[Stremboxd] ⚠️ ${err}`);
            result.errors.push(err);
          }
        } else {
          result.skipped++;
          result.errors.push(`No watched action is available for "${title}" (${imdbId}); it will be retried.`);
          console.warn(`[Stremboxd] No watchedUrl for ${title}`);
        }

        if (markedAsWatched) {
          result.syncedTitles.push(title);
          result.syncedMovies.push({ title, imdbId, posterDataUrl: await cacheMoviePoster(m.movie) });
        }

        // Step 2: Remove from Watchlist only after the watched state is confirmed.
        let watchlistRemovalConfirmed = !actions.inWatchlist;
        if (markedAsWatched && actions.watchlistUrl) {
          const wlUrl = toggleSetParam(actions.watchlistUrl, false);
          const wlRes = await fetch(wlUrl, {
            headers: { ...HEADERS, Authorization: `Bearer ${session.userToken}` },
            redirect: "follow",
          });
          if (wlRes.status === 429) {
            const body = await wlRes.text().catch(() => "");
            throw new StremboxdRateLimitError(
              `Watchlist toggle HTTP 429 for "${title}": ${body.slice(0, 200)}`
            );
          }
          if (wlRes.ok) {
            result.removedFromWatchlist++;
            watchlistRemovalConfirmed = true;
            console.log(`[Stremboxd] 🗑️  ${title} — removed from Watchlist`);
          } else if (wlRes.status === 404 && !actions.inWatchlist) {
            // The action may be absent because this film was already off the list.
            watchlistRemovalConfirmed = true;
          } else {
            const body = await wlRes.text().catch(() => "");
            const err = `Watchlist removal HTTP ${wlRes.status} for "${title}": ${body.slice(0, 200)}`;
            result.errors.push(err);
            watchlistRemovalConfirmed = false;
            console.warn(`[Stremboxd] ⚠️ ${err}`);
          }
        } else if (markedAsWatched && actions.inWatchlist) {
          result.errors.push(`Cannot remove "${title}" from the Letterboxd watchlist: no removal action was provided.`);
          watchlistRemovalConfirmed = false;
        }

        // Keep the movie retryable until both watched and watchlist states are confirmed.
        if (markedAsWatched && watchlistRemovalConfirmed) {
          newSyncedIds.add(imdbId);
          pendingImdbIds.delete(imdbId);
        } else {
          pendingImdbIds.add(imdbId);
        }

        // Small delay between films to be polite to the API
        await new Promise((r) => setTimeout(r, 500));
      } catch (e) {
        const err = `Error syncing "${title}": ${e instanceof Error ? e.message : String(e)}`;
        console.error(`[Stremboxd] ⚠️ ${err}`);
        result.errors.push(err);
        if (imdbId) pendingImdbIds.add(imdbId);
        // Stop immediately when Stremboxd rate-limits the stream lookup.
        // Continuing only creates one identical 429 per remaining movie.
        if (e instanceof StremboxdRateLimitError) {
          stoppedForRateLimit = true;
          break;
        }
      }
    }

    // Failed movies in the current five-item window remain retryable. Older
    // pending entries are discarded above by design.
    const unprocessed = stoppedForRateLimit ? batch.slice(attemptedCount) : [];
    const unprocessedIds = unprocessed.map((movie) => movie.movie.ids.imdb).filter((id): id is string => Boolean(id));
    const unprocessedWithoutId = unprocessed.filter((movie) => !movie.movie.ids.imdb).length;
    result.pending = new Set([...pendingImdbIds, ...unprocessedIds]).size + unprocessedWithoutId;

    return { result, newSyncedIds, pendingImdbIds, newLatestWatchedAt };
  }
}
