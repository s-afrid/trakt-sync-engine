import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncLogs, syncSettings } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  // Check cookies
  const traktToken = request.cookies.get("trakt_token")?.value;
  const malToken = request.cookies.get("mal_token")?.value;
  const traktUserCookie = request.cookies.get("trakt_user")?.value;
  const malUserCookie = request.cookies.get("mal_user")?.value;
  const letterboxdUsername = request.cookies.get("letterboxd_username")?.value;

  let traktUser = null;
  let malUser = null;

  try {
    if (traktUserCookie) traktUser = JSON.parse(traktUserCookie);
  } catch {}

  try {
    if (malUserCookie) malUser = JSON.parse(malUserCookie);
  } catch {}

  // Recent logs
  let recentLogs: unknown[] = [];
  let settings = null;

  if (db) {
    try {
      recentLogs = await db
        .select()
        .from(syncLogs)
        .orderBy(desc(syncLogs.createdAt))
        .limit(10);

      const foundSettings = await db
        .select()
        .from(syncSettings)
        .where(eq(syncSettings.userId, "default_user"))
        .limit(1);

      if (foundSettings.length > 0) {
        settings = foundSettings[0];
      }
    } catch {}
  }

  return NextResponse.json({
    connected: {
      trakt: !!traktToken,
      mal: !!malToken,
      letterboxd: !!letterboxdUsername,
    },
    profiles: {
      trakt: traktUser,
      mal: malUser,
      letterboxd: letterboxdUsername ? { username: letterboxdUsername } : null,
    },
    envConfigured: {
      trakt: !!(process.env.TRAKT_CLIENT_ID && process.env.TRAKT_CLIENT_SECRET),
      mal: !!(process.env.MAL_CLIENT_ID && process.env.MAL_CLIENT_SECRET),
      database: !!process.env.DATABASE_URL,
    },
    settings,
    recentLogs,
  });
}
