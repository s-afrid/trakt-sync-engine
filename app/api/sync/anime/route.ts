import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { linkedAccounts, syncLogs, syncSettings } from "@/lib/db/schema";
import { AnimeSyncService } from "@/lib/sync/anime-sync";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  let traktToken = request.cookies.get("trakt_token")?.value;
  let malToken = request.cookies.get("mal_token")?.value;
  let traktUsername = request.cookies.get("trakt_username")?.value;
  let userId = "default_user";
  let hasTraktUserCookie = false;

  const traktUserCookie = request.cookies.get("trakt_user")?.value;
  if (traktUserCookie) {
    try {
      const traktUser = JSON.parse(traktUserCookie);
      if (traktUser.username) {
        userId = `user_${traktUser.username}`;
        hasTraktUserCookie = true;
      }
    } catch {}
  }

  let userAccounts: (typeof linkedAccounts.$inferSelect)[] = [];
  if (db && (!traktToken || !malToken)) {
    userAccounts = await db
      .select()
      .from(linkedAccounts)
      .where(eq(linkedAccounts.userId, userId))
      .orderBy(desc(linkedAccounts.updatedAt));

    if (!userAccounts.length && !hasTraktUserCookie && userId === "default_user") {
      const traktAccounts = await db
        .select()
        .from(linkedAccounts)
        .where(eq(linkedAccounts.provider, "trakt"))
        .orderBy(desc(linkedAccounts.updatedAt));
      const fallbackTrakt = traktAccounts.find((account) => account.accessToken);
      if (fallbackTrakt) {
        userId = fallbackTrakt.userId;
        userAccounts = await db
          .select()
          .from(linkedAccounts)
          .where(eq(linkedAccounts.userId, userId))
          .orderBy(desc(linkedAccounts.updatedAt));
      }
    }

    const traktAccount = userAccounts.find((account) => account.provider === "trakt");
    const malAccount = userAccounts.find((account) => account.provider === "myanimelist");
    traktToken ||= traktAccount?.accessToken || undefined;
    malToken ||= malAccount?.accessToken || undefined;
    traktUsername ||= traktAccount?.providerUsername || undefined;
  }

  if (!traktToken || !malToken) {
    return NextResponse.json(
      {
        success: false,
        error: !traktToken
          ? "A linked Trakt access token is required for anime sync."
          : "A linked MyAnimeList access token is required for anime sync.",
      },
      { status: 400 }
    );
  }

  try {
    const settings = db
      ? await db
          .select()
          .from(syncSettings)
          .where(eq(syncSettings.userId, userId))
          .limit(1)
      : [];
    const sync = new AnimeSyncService(traktToken, malToken, traktUsername);
    const anime = await sync.syncTraktToMal({
      syncRatings: settings[0]?.syncRatings ?? true,
      batchLimit: 50,
    });
    const status = anime.errors.length
      ? anime.malUpdatedCount > 0
        ? "warning"
        : "error"
      : anime.unmatchedTitles.length
        ? "warning"
        : "success";

    if (db) {
      await db.insert(syncLogs).values({
        id: `log_anime_${Date.now()}`,
        userId,
        type: "trakt_to_mal",
        status,
        title: "Dedicated Trakt to MyAnimeList Sync",
        details: JSON.stringify(anime),
        itemsCount: anime.malUpdatedCount,
      });
      await db
        .update(syncSettings)
        .set({ lastTraktSyncAt: new Date(), lastMalSyncAt: new Date(), updatedAt: new Date() })
        .where(eq(syncSettings.userId, userId));
    }

    return NextResponse.json({ success: status !== "error", userId, results: { anime } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (db) {
      try {
        await db.insert(syncLogs).values({
          id: `log_anime_err_${Date.now()}`,
          userId,
          type: "trakt_to_mal",
          status: "error",
          title: "Dedicated Trakt to MyAnimeList Sync failed",
          details: message,
          itemsCount: 0,
        });
      } catch {}
    }
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
