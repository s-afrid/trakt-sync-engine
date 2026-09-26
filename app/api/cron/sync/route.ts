import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { linkedAccounts, syncSettings } from "@/lib/db/schema";
import { AnimeSyncService } from "@/lib/sync/anime-sync";
import { LetterboxdSyncService } from "@/lib/sync/letterboxd-sync";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  // Verify Vercel Cron authorization
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!db) {
    return NextResponse.json(
      { error: "Database not configured for automated cron sync." },
      { status: 500 }
    );
  }

  try {
    // Find all users who have Trakt connected
    const traktAccounts = await db
      .select()
      .from(linkedAccounts)
      .where(eq(linkedAccounts.provider, "trakt"));

    const summary: { userId: string; status: string; result?: unknown }[] = [];

    for (const traktAcc of traktAccounts) {
      if (!traktAcc.accessToken) continue;

      const userSettings = await db
        .select()
        .from(syncSettings)
        .where(eq(syncSettings.userId, traktAcc.userId))
        .limit(1);

      const config = userSettings[0];

      // Check if user has MAL connected
      const malAccount = await db
        .select()
        .from(linkedAccounts)
        .where(eq(linkedAccounts.userId, traktAcc.userId))
        .limit(1);

      const malAcc = malAccount.find((a) => a.provider === "myanimelist");
      const lbAcc = malAccount.find((a) => a.provider === "letterboxd");

      const userRun: {
        anime?: unknown;
        letterboxd?: unknown;
      } = {};

      if (malAcc?.accessToken && config?.syncTraktToMal) {
        try {
          const animeSync = new AnimeSyncService(
            traktAcc.accessToken,
            malAcc.accessToken
          );
          userRun.anime = await animeSync.syncTraktToMal({
            syncRatings: config?.syncRatings ?? true,
            batchLimit: 25,
          });
        } catch (e) {
          console.error(`Cron anime sync error for user ${traktAcc.userId}:`, e);
        }
      }

      if (lbAcc?.providerUsername && config?.syncLetterboxdRss) {
        try {
          const lbSync = new LetterboxdSyncService(traktAcc.accessToken);
          userRun.letterboxd = await lbSync.syncRssToTrakt(
            lbAcc.providerUsername
          );
        } catch (e) {
          console.error(`Cron Letterboxd sync error for user ${traktAcc.userId}:`, e);
        }
      }

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
