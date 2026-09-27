import { NextRequest, NextResponse } from "next/server";
import { AnimeSyncService } from "@/lib/sync/anime-sync";
import { LetterboxdSyncService } from "@/lib/sync/letterboxd-sync";
import { db } from "@/lib/db";
import { linkedAccounts, syncSettings, syncLogs } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    let traktToken = request.cookies.get("trakt_token")?.value;
    let traktUsername = request.cookies.get("trakt_username")?.value;
    let malToken = request.cookies.get("mal_token")?.value;
    let letterboxdUsername = request.cookies.get("letterboxd_username")?.value;

    // Check DB for tokens if cookies missing
    if (db && (!traktToken || !malToken || !letterboxdUsername)) {
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
            userId: "default_user",
            type: "trakt_to_mal",
            status: "success",
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
            userId: "default_user",
            type: "letterboxd_rss",
            status: "success",
            title: "Letterboxd RSS Sync",
            details: JSON.stringify(results.letterboxd),
            itemsCount: (results.letterboxd as { moviesSyncedToTrakt: number }).moviesSyncedToTrakt || 0,
          });
        } catch {}
      }
    }

    // Update last synced timestamps in DB
    if (db) {
      try {
        await db
          .update(syncSettings)
          .set({
            lastTraktSyncAt: new Date(),
            lastMalSyncAt: malToken ? new Date() : undefined,
            lastLetterboxdSyncAt: letterboxdUsername ? new Date() : undefined,
            status: "idle",
            updatedAt: new Date(),
          })
          .where(eq(syncSettings.userId, "default_user"));
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
