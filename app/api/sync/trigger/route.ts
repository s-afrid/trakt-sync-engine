import { NextRequest, NextResponse } from "next/server";
import { AnimeSyncService } from "@/lib/sync/anime-sync";
import { LetterboxdSyncService } from "@/lib/sync/letterboxd-sync";
import {
  StremboxdLetterboxdSync,
  stremboxdLogin,
  isSessionFresh,
  type StremboxdSession,
} from "@/lib/sync/stremboxd-letterboxd-sync";
import { db } from "@/lib/db";
import { linkedAccounts, syncSettings, syncLogs } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    let traktToken = request.cookies.get("trakt_token")?.value;
    let traktUsername = request.cookies.get("trakt_username")?.value;
    let malToken = request.cookies.get("mal_token")?.value;
    let letterboxdUsername = request.cookies.get("letterboxd_username")?.value;
    let syncUserId = "default_user";
    const traktUserCookie = request.cookies.get("trakt_user")?.value;
    if (traktUserCookie) {
      try {
        const traktUser = JSON.parse(traktUserCookie);
        if (traktUser.username) syncUserId = `user_${traktUser.username}`;
      } catch {}
    }

    // Check DB for tokens if cookies missing
    if (db && (!traktToken || !malToken || !letterboxdUsername)) {
      const accounts = await db
        .select()
        .from(linkedAccounts)
        .orderBy(desc(linkedAccounts.updatedAt));
      for (const acc of accounts) {
        if (acc.provider === "trakt") {
          if (!traktUserCookie && syncUserId === "default_user") {
            syncUserId = acc.userId;
          }
          if (!traktToken && acc.accessToken) traktToken = acc.accessToken;
          if (!traktUsername && acc.providerUsername) traktUsername = acc.providerUsername;
        }
        if (acc.provider === "myanimelist" && !malToken && acc.accessToken) {
          malToken = acc.accessToken;
        }
        if (acc.provider === "letterboxd" && !letterboxdUsername) {
          letterboxdUsername = acc.providerUsername;
        }
      }
    }

    if (!traktToken && !traktUsername) {
      return NextResponse.json(
        { error: "Trakt account is not connected. Please connect Trakt first." },
        { status: 400 }
      );
    }

    const results: {
      anime?: unknown;
      letterboxd?: unknown;
      traktToLetterboxd?: unknown;
      timestamp: string;
    } = {
      timestamp: new Date().toISOString(),
    };

    // 1. Sync Trakt to MyAnimeList
    if (malToken) {
      const animeSync = new AnimeSyncService(traktToken, malToken, traktUsername);
      results.anime = await animeSync.syncTraktToMal({
        syncRatings: true,
        batchLimit: 50,
      });

      if (db) {
        try {
          await db.insert(syncLogs).values({
            id: `log_anime_${Date.now()}`,
            userId: syncUserId,
            type: "trakt_to_mal",
            status:
              (results.anime as { errors?: string[]; malUpdatedCount?: number }).errors?.length
                ? ((results.anime as { malUpdatedCount?: number }).malUpdatedCount
                    ? "warning"
                    : "error")
                : "success",
            title: "Trakt to MyAnimeList Sync",
            details: JSON.stringify(results.anime),
            itemsCount: (results.anime as { malUpdatedCount: number }).malUpdatedCount || 0,
          });
        } catch {}
      }
    }

    // 2. Sync Letterboxd RSS to Trakt if connected
    if (letterboxdUsername) {
      const lbSync = new LetterboxdSyncService(traktToken);
      results.letterboxd = await lbSync.syncRssToTrakt(letterboxdUsername);

      if (db) {
        try {
          await db.insert(syncLogs).values({
            id: `log_lb_${Date.now()}`,
            userId: syncUserId,
            type: "letterboxd_rss",
            status: "success",
            title: "Letterboxd RSS Sync",
            details: JSON.stringify(results.letterboxd),
            itemsCount: (results.letterboxd as { moviesSyncedToTrakt: number }).moviesSyncedToTrakt || 0,
          });
        } catch {}
      }
    }

    // 3. Sync newly watched Trakt movies to Letterboxd through Stremboxd
    const stremboxdUsername =
      process.env.STREMBOXD_USERNAME?.trim() ||
      process.env.LETTERBOXD_USERNAME?.trim() ||
      "";
    const stremboxdPassword =
      process.env.STREMBOXD_PASSWORD?.trim() ||
      process.env.LETTERBOXD_PASSWORD?.trim() ||
      "";

    if (stremboxdUsername && stremboxdPassword) {
      try {
        let config: typeof syncSettings.$inferSelect | undefined;
        if (db) {
          const rows = await db
            .select()
            .from(syncSettings)
            .where(eq(syncSettings.userId, syncUserId))
            .limit(1);
          config = rows[0];
        }

        let session: StremboxdSession | null = null;
        if (config?.stremboxdToken && config.stremboxdUserId && config.stremboxdTokenAt) {
          const candidate: StremboxdSession = {
            userToken: config.stremboxdToken,
            userId: config.stremboxdUserId,
            username: stremboxdUsername,
            loginAt: config.stremboxdTokenAt.getTime(),
          };
          if (isSessionFresh(candidate)) session = candidate;
        }

        if (!session) {
          session = await stremboxdLogin(stremboxdUsername, stremboxdPassword);
          if (db) {
            await db
              .update(syncSettings)
              .set({
                stremboxdToken: session.userToken,
                stremboxdUserId: session.userId,
                stremboxdTokenAt: new Date(session.loginAt),
                updatedAt: new Date(),
              })
              .where(eq(syncSettings.userId, syncUserId));
          }
        }

        const syncedIds = new Set<string>(
          config?.lastSyncedMovieIds
            ? (JSON.parse(config.lastSyncedMovieIds) as string[])
            : []
        );
        const lbSync = new StremboxdLetterboxdSync(traktToken, traktUsername);
        const { result, newSyncedIds, newLatestWatchedAt } =
          await lbSync.syncNewMovies({
            session,
            syncedImdbIds: syncedIds,
            lastWatchedAt: config?.latestWatchedAt ?? null,
          });
        results.traktToLetterboxd = result;

        if (db && result.newMoviesFound > 0) {
          await db
            .update(syncSettings)
            .set({
              lastSyncedMovieIds: JSON.stringify([...newSyncedIds]),
              latestWatchedAt: newLatestWatchedAt,
              lastLetterboxdSyncAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(syncSettings.userId, syncUserId));

          await db.insert(syncLogs).values({
            id: `log_lb_out_${Date.now()}`,
            userId: syncUserId,
            type: "trakt_to_letterboxd",
            status:
              result.errors.length > 0 && result.markedWatched === 0
                ? "error"
                : result.errors.length > 0
                ? "warning"
                : "success",
            title: `Trakt to Letterboxd: ${result.markedWatched} movie(s) marked watched`,
            details: JSON.stringify(result),
            itemsCount: result.markedWatched,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.traktToLetterboxd = {
          configured: true,
          newMoviesFound: 0,
          markedWatched: 0,
          removedFromWatchlist: 0,
          alreadySynced: 0,
          skipped: 0,
          errors: [message],
        };
        if (db) {
          try {
            await db.insert(syncLogs).values({
              id: `log_lb_out_err_${Date.now()}`,
              userId: syncUserId,
              type: "trakt_to_letterboxd",
              status: "error",
              title: "Trakt to Letterboxd sync failed",
              details: message,
              itemsCount: 0,
            });
          } catch {}
        }
      }
    } else {
      results.traktToLetterboxd = {
        configured: false,
        message: "Stremboxd credentials are not configured.",
      };
    }

    // Update last synced timestamps in DB
    if (db) {
      try {
        await db
          .update(syncSettings)
          .set({
            lastTraktSyncAt: new Date(),
            lastMalSyncAt: malToken ? new Date() : undefined,
            lastLetterboxdSyncAt:
              letterboxdUsername ||
              (results.traktToLetterboxd as { configured?: boolean } | undefined)?.configured === true
                ? new Date()
                : undefined,
            status: "idle",
            updatedAt: new Date(),
          })
          .where(eq(syncSettings.userId, syncUserId));
      } catch {}
    }

    return NextResponse.json({
      success: true,
      message: "Sync completed successfully!",
      results,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Sync trigger error:", err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
