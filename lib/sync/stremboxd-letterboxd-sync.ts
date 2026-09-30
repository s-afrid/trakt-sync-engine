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
  alreadySynced: number;
  markedWatched: number;
  removedFromWatchlist: number;
  skipped: number;
  errors: string[];
  syncedTitles: string[];
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
    throw new Error(`Stremboxd stream HTTP ${res.status}: ${body.slice(0, 200)}`);
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
   * Detects newly watched Trakt movies since `lastWatchedAt` and marks them
   * as Watched on Letterboxd via the Stremboxd API.
   *
   * Returns the updated state (new syncedIds + latestWatchedAt) so the caller
   * can persist it to the DB.
   */
  async syncNewMovies(opts: {
    session: StremboxdSession;
    syncedImdbIds: Set<string>;     // already synced — skip these
    lastWatchedAt: string | null;   // ISO string — only process movies newer than this
  }): Promise<{
    result: LetterboxdSyncResult;
    newSyncedIds: Set<string>;
    newLatestWatchedAt: string | null;
  }> {
    const { session, syncedImdbIds, lastWatchedAt } = opts;
    const result: LetterboxdSyncResult = {
      newMoviesFound: 0,
      alreadySynced: 0,
      markedWatched: 0,
      removedFromWatchlist: 0,
      skipped: 0,
      errors: [],
      syncedTitles: [],
    };

    const newSyncedIds = new Set(syncedImdbIds);
    let newLatestWatchedAt = lastWatchedAt;

    // Fetch all watched movies from Trakt
    const allMovies: TraktMovieWatched[] = await this.traktClient.getWatchedMovies();

    // Filter to movies newer than lastWatchedAt
    const lastTs = lastWatchedAt ? new Date(lastWatchedAt).getTime() : 0;
    const newMovies = allMovies.filter((m) => {
      const ts = new Date(m.last_watched_at).getTime();
      return ts > lastTs;
    });

    result.newMoviesFound = newMovies.length;

    if (newMovies.length === 0) {
      return { result, newSyncedIds, newLatestWatchedAt };
    }

    const maxTs = newMovies.reduce(
      (max, m) => Math.max(max, new Date(m.last_watched_at).getTime()),
      0
    );

    for (const m of newMovies) {
      const imdbId = m.movie.ids.imdb;
      const title = m.movie.title;

      if (!imdbId) {
        result.skipped++;
        continue;
      }

      // Already synced — skip
      if (syncedImdbIds.has(imdbId)) {
        result.alreadySynced++;
        newSyncedIds.add(imdbId);
        continue;
      }

      try {
        const actions = await getFilmActions(session.userId, session.userToken, imdbId);

        if (!actions) {
          // Film not in Stremboxd/Letterboxd database
          result.skipped++;
          console.warn(`[Stremboxd] Film not found: ${title} (${imdbId})`);
          continue;
        }

        // Step 1: Mark as Watched
        if (actions.watched) {
          console.log(`[Stremboxd] ✅ ${title} — already Watched`);
          result.markedWatched++;
          result.syncedTitles.push(title);
          newSyncedIds.add(imdbId);
        } else if (actions.watchedUrl) {
          const markUrl = toggleSetParam(actions.watchedUrl, true);
          const wRes = await fetch(markUrl, {
            headers: { ...HEADERS, Authorization: `Bearer ${session.userToken}` },
            redirect: "follow",
          });
          if (wRes.ok) {
            console.log(`[Stremboxd] ✅ ${title} — marked as Watched`);
            result.markedWatched++;
            result.syncedTitles.push(title);
            newSyncedIds.add(imdbId);
          } else {
            const err = `Watch toggle HTTP ${wRes.status} for "${title}"`;
            console.warn(`[Stremboxd] ⚠️ ${err}`);
            result.errors.push(err);
          }
        } else {
          result.skipped++;
          console.warn(`[Stremboxd] No watchedUrl for ${title}`);
        }

        // Step 2: Remove from Watchlist (unconditional — safe if not in list)
        if (actions.watchlistUrl) {
          const wlUrl = toggleSetParam(actions.watchlistUrl, false);
          const wlRes = await fetch(wlUrl, {
            headers: { ...HEADERS, Authorization: `Bearer ${session.userToken}` },
            redirect: "follow",
          });
          if (wlRes.ok) {
            result.removedFromWatchlist++;
            console.log(`[Stremboxd] 🗑️  ${title} — removed from Watchlist`);
          }
          // Non-ok is fine — means it wasn't in the watchlist
        }

        // Small delay between films to be polite to the API
        await new Promise((r) => setTimeout(r, 500));
      } catch (e) {
        const err = `Error syncing "${title}": ${e instanceof Error ? e.message : String(e)}`;
        console.error(`[Stremboxd] ⚠️ ${err}`);
        result.errors.push(err);
      }
    }

    // Keep the timestamp unchanged when an item failed so the next run retries it.
    if (result.errors.length === 0) {
      newLatestWatchedAt = new Date(maxTs).toISOString();
    }

    return { result, newSyncedIds, newLatestWatchedAt };
  }
}
