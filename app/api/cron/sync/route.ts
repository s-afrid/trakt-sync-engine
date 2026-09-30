import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { linkedAccounts, syncSettings, syncLogs } from "@/lib/db/schema";
import { AnimeSyncService } from "@/lib/sync/anime-sync";
import {
  StremboxdLetterboxdSync,
  stremboxdLogin,
  isSessionFresh,
  type StremboxdSession,
} from "@/lib/sync/stremboxd-letterboxd-sync";
import { eq } from "drizzle-orm";

export const maxDuration = 60; // Vercel Pro: up to 60s per invocation

export async function GET(request: NextRequest) {
  // Verify Vercel Cron authorization
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!db) {
    return NextResponse.json(
      { error: "Database not configured." },
      { status: 500 }
    );
  }

  const sbUsername =
    process.env.STREMBOXD_USERNAME?.trim() ||
    process.env.LETTERBOXD_USERNAME?.trim() ||
    "";
  const sbPassword =
    process.env.STREMBOXD_PASSWORD?.trim() ||
    process.env.LETTERBOXD_PASSWORD?.trim() ||
    "";

  try {
    const traktAccounts = await db
      .select()
      .from(linkedAccounts)
      .where(eq(linkedAccounts.provider, "trakt"));

    const summary: { userId: string; status: string; result?: unknown }[] = [];

    for (const traktAcc of traktAccounts) {
      if (!traktAcc.accessToken) continue;

      const userSettingsRows = await db
        .select()
        .from(syncSettings)
        .where(eq(syncSettings.userId, traktAcc.userId))
        .limit(1);

      const config = userSettingsRows[0];

      const allAccounts = await db
        .select()
        .from(linkedAccounts)
        .where(eq(linkedAccounts.userId, traktAcc.userId));

      const malAcc = allAccounts.find((a) => a.provider === "myanimelist");

      const userRun: { anime?: unknown; letterboxd?: unknown } = {};

      // ── 1. Trakt → MyAnimeList ──────────────────────────────────────────
      if (malAcc?.accessToken && config?.syncTraktToMal !== false) {
        try {
          const animeSync = new AnimeSyncService(
            traktAcc.accessToken,
            malAcc.accessToken
          );
          userRun.anime = await animeSync.syncTraktToMal({
            syncRatings: config?.syncRatings ?? true,
            batchLimit: 25,
          });

          await db.insert(syncLogs).values({
            id: `log_anime_${Date.now()}`,
            userId: traktAcc.userId,
            type: "trakt_to_mal",
            status: "success",
            title: "Trakt → MAL anime sync",
            details: JSON.stringify(userRun.anime),
            itemsCount:
              (userRun.anime as { malUpdatedCount?: number })?.malUpdatedCount ?? 0,
          });
        } catch (e) {
          console.error(`Cron anime sync error for user ${traktAcc.userId}:`, e);
          await db.insert(syncLogs).values({
            id: `log_anime_err_${Date.now()}`,
            userId: traktAcc.userId,
            type: "trakt_to_mal",
            status: "error",
            title: "Trakt → MAL anime sync failed",
            details: e instanceof Error ? e.message : String(e),
            itemsCount: 0,
          });
        }
      }

      // ── 2. Trakt → Letterboxd via Stremboxd ────────────────────────────
      if (sbUsername && sbPassword) {
        try {
          // Resolve or refresh Stremboxd session (cached in DB, valid 20h)
          let session: StremboxdSession | null = null;

          if (
            config?.stremboxdToken &&
            config.stremboxdUserId &&
            config.stremboxdTokenAt
          ) {
            const candidate: StremboxdSession = {
              userToken: config.stremboxdToken,
              userId: config.stremboxdUserId,
              username: sbUsername,
              loginAt: config.stremboxdTokenAt.getTime(),
            };
            if (isSessionFresh(candidate)) session = candidate;
          }

          if (!session) {
            session = await stremboxdLogin(sbUsername, sbPassword);
            // Persist to DB
            await db
              .update(syncSettings)
              .set({
                stremboxdToken: session.userToken,
                stremboxdUserId: session.userId,
                stremboxdTokenAt: new Date(session.loginAt),
                updatedAt: new Date(),
              })
              .where(eq(syncSettings.userId, traktAcc.userId));
          }

          // Load sync state from DB
          const syncedIds: Set<string> = new Set(
            config?.lastSyncedMovieIds
              ? (JSON.parse(config.lastSyncedMovieIds) as string[])
              : []
          );
          const lastWatchedAt = config?.latestWatchedAt ?? null;

          // Run the sync
          const lbSync = new StremboxdLetterboxdSync(
            traktAcc.accessToken,
            traktAcc.providerUsername ?? undefined
          );

          const { result, newSyncedIds, newLatestWatchedAt } =
            await lbSync.syncNewMovies({
              session,
              syncedImdbIds: syncedIds,
              lastWatchedAt,
            });

          userRun.letterboxd = result;

          // Persist updated state back to DB
          if (result.newMoviesFound > 0) {
            await db
              .update(syncSettings)
              .set({
                lastSyncedMovieIds: JSON.stringify([...newSyncedIds]),
                latestWatchedAt: newLatestWatchedAt,
                lastLetterboxdSyncAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(syncSettings.userId, traktAcc.userId));

            await db.insert(syncLogs).values({
              id: `log_lb_${Date.now()}`,
              userId: traktAcc.userId,
              type: "trakt_to_letterboxd",
              status:
                result.errors.length > 0 && result.markedWatched === 0
                  ? "error"
                  : result.errors.length > 0
                  ? "warning"
                  : "success",
              title: `Trakt → Letterboxd: ${result.markedWatched} movie(s) marked watched`,
              details: JSON.stringify(result),
              itemsCount: result.markedWatched,
            });
          }
        } catch (e) {
          console.error(`Cron Letterboxd sync error for user ${traktAcc.userId}:`, e);
          await db.insert(syncLogs).values({
            id: `log_lb_err_${Date.now()}`,
            userId: traktAcc.userId,
            type: "trakt_to_letterboxd",
            status: "error",
            title: "Trakt → Letterboxd sync failed",
            details: e instanceof Error ? e.message : String(e),
            itemsCount: 0,
          });
        }
      }

      // Update last sync timestamps
      await db
        .update(syncSettings)
        .set({
          lastTraktSyncAt: new Date(),
          ...(malAcc?.accessToken ? { lastMalSyncAt: new Date() } : {}),
          status: "idle",
          updatedAt: new Date(),
        })
        .where(eq(syncSettings.userId, traktAcc.userId));

      summary.push({
        userId: traktAcc.userId,
        status: "completed",
        result: userRun,
      });
    }

    return NextResponse.json({
      success: true,
      processedUsers: summary.length,
      summary,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Vercel Cron sync error:", err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
