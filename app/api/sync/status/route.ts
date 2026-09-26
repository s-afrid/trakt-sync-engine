import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncLogs, syncSettings, linkedAccounts } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { TraktClient } from "@/lib/clients/trakt";
import { MalClient } from "@/lib/clients/mal";
import { LetterboxdClient } from "@/lib/clients/letterboxd";

export async function GET(request: NextRequest) {
  // Check cookies
  const traktToken = request.cookies.get("trakt_token")?.value;
  const traktUsername = request.cookies.get("trakt_username")?.value;
  const malToken = request.cookies.get("mal_token")?.value;
  const traktUserCookie = request.cookies.get("trakt_user")?.value;
  const malUserCookie = request.cookies.get("mal_user")?.value;
  const letterboxdUsername = request.cookies.get("letterboxd_username")?.value;
  const letterboxdUserCookie = request.cookies.get("letterboxd_user")?.value;

  let traktUser: { username: string; name?: string; avatar?: string } | null = null;
  let malUser: { id: number; name: string; picture?: string } | null = null;
  let letterboxdUser: { username: string; displayName?: string } | null = null;

  try {
    if (traktUserCookie) traktUser = JSON.parse(traktUserCookie);
  } catch {}

  try {
    if (malUserCookie) malUser = JSON.parse(malUserCookie);
  } catch {}

  try {
    if (letterboxdUserCookie) {
      letterboxdUser = JSON.parse(letterboxdUserCookie);
    } else if (letterboxdUsername) {
      letterboxdUser = { username: letterboxdUsername };
    }
  } catch {}

  // Hydrate from DB if available
  if (db) {
    try {
      if ((!traktUser || !traktUser.avatar) && (traktUsername || traktToken)) {
        const traktAcc = await db
          .select()
          .from(linkedAccounts)
          .where(eq(linkedAccounts.provider, "trakt"))
          .limit(1);
        if (traktAcc.length > 0) {
          traktUser = {
            username: traktAcc[0].providerUsername,
            avatar: traktAcc[0].avatarUrl || traktUser?.avatar,
          };
        }
      }

      if ((!malUser || !malUser.picture) && malToken) {
        const malAcc = await db
          .select()
          .from(linkedAccounts)
          .where(eq(linkedAccounts.provider, "myanimelist"))
          .limit(1);
        if (malAcc.length > 0) {
          malUser = {
            id: parseInt(malAcc[0].providerUserId || "0", 10),
            name: malAcc[0].providerUsername,
            picture: malAcc[0].avatarUrl || malUser?.picture,
          };
        }
      }
    } catch (dbErr) {
      console.warn("DB profile lookup skipped:", dbErr);
    }
  }

  // Hydrate Trakt avatar via public client if still missing
  if ((!traktUser || !traktUser.avatar) && (traktUsername || traktUser?.username) && process.env.TRAKT_CLIENT_ID) {
    const uname = (traktUsername || traktUser?.username)!.trim();
    try {
      const client = new TraktClient(traktToken, uname);
      const tu = await client.getCurrentUser();
      traktUser = {
        username: uname,
        name: tu.name,
        avatar: tu.images?.avatar?.full || undefined,
      };
    } catch {}
  } else if (!traktUser && traktUsername) {
    traktUser = { username: traktUsername };
  }

  // Hydrate MAL user if token present but profile missing
  if (!malUser && malToken) {
    try {
      const client = new MalClient(malToken);
      const mu = await client.getCurrentUser();
      malUser = {
        id: mu.id,
        name: mu.name,
        picture: mu.picture,
      };
    } catch {}
  }

  // Hydrate Letterboxd display name if missing
  if (letterboxdUsername && (!letterboxdUser || !letterboxdUser.displayName)) {
    try {
      letterboxdUser = await LetterboxdClient.fetchUserProfile(letterboxdUsername);
    } catch {
      letterboxdUser = { username: letterboxdUsername };
    }
  }

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
      trakt: !!traktToken || !!traktUsername,
      mal: !!malToken,
      letterboxd: !!letterboxdUsername,
    },
    profiles: {
      trakt: traktUser,
      mal: malUser,
      letterboxd: letterboxdUser,
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
