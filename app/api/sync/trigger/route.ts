import { NextRequest, NextResponse } from "next/server";
import { TraktClient } from "@/lib/clients/trakt";
import { db } from "@/lib/db";
import { linkedAccounts, syncSettings, syncLogs } from "@/lib/db/schema";
import { and, eq, ilike } from "drizzle-orm";
import { StremboxdLetterboxdSync, isSessionFresh, stremboxdLogin, type StremboxdSession } from "@/lib/sync/stremboxd-letterboxd-sync";
import { decryptCredentials } from "@/lib/security/credential-vault";

export const maxDuration = 60;

function getTraktUsername(request: NextRequest): string | null {
  try {
    const value = request.cookies.get("trakt_user")?.value;
    const parsed = value ? JSON.parse(value) : null;
    return typeof parsed?.username === "string" ? parsed.username.trim() : null;
  } catch { return null; }
}

export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json({ success: false, error: "DATABASE_URL is required to persist safe sync progress." }, { status: 503 });
  }
  const cronSecret = process.env.CRON_SECRET;
  const schedulerAuthorized = Boolean(cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`);
  const cookieToken = request.cookies.get("trakt_token")?.value;
  if (!schedulerAuthorized && !cookieToken && !getTraktUsername(request)) {
    return NextResponse.json({ success: false, error: "Connect a Trakt username before starting a sync." }, { status: 401 });
  }

  const cookieUsername = getTraktUsername(request);
  const username = cookieUsername || process.env.TRAKT_USERNAME?.trim() || null;
  let userId = username ? `user_${username}` : "default_user";
  let traktToken = cookieToken || process.env.TRAKT_ACCESS_TOKEN?.trim() || "";
  let linkedTraktUsername: string | null = null;
  let savedLetterboxdCredentials: { username: string; password: string } | null = null;
  let refreshToken: string | null = null;
  let expiresAt: Date | null = null;
  let settings: typeof syncSettings.$inferSelect | undefined;

  try {
    if (db) {
      let accounts = await db.select().from(linkedAccounts).where(eq(linkedAccounts.userId, userId));
      if (accounts.length === 0 && username && !cookieUsername) {
        const match = await db.select().from(linkedAccounts).where(and(eq(linkedAccounts.provider, "trakt"), ilike(linkedAccounts.providerUsername, username))).limit(2);
        if (match.length === 1) {
          userId = match[0].userId;
          accounts = await db.select().from(linkedAccounts).where(eq(linkedAccounts.userId, userId));
        } else if (match.length > 1) {
          throw new Error("TRAKT_USERNAME matches more than one account. Choose a unique Trakt username.");
        }
      }
      if (!username && accounts.length) {
        const allTraktAccounts = await db.select().from(linkedAccounts).where(eq(linkedAccounts.provider, "trakt"));
        const accountIds = [...new Set(allTraktAccounts.map((account) => account.userId))];
        if (accountIds.length !== 1) throw new Error("More than one Trakt account is connected. Set TRAKT_USERNAME to select the account for scheduled sync.");
        userId = accountIds[0];
        accounts = await db.select().from(linkedAccounts).where(eq(linkedAccounts.userId, userId));
      } else if (!username && accounts.length === 0) {
        const allTraktAccounts = await db.select().from(linkedAccounts).where(eq(linkedAccounts.provider, "trakt"));
        const accountIds = [...new Set(allTraktAccounts.map((account) => account.userId))];
        if (accountIds.length === 1) {
          userId = accountIds[0];
          accounts = await db.select().from(linkedAccounts).where(eq(linkedAccounts.userId, userId));
        } else if (accountIds.length > 1) {
          throw new Error("More than one Trakt account is connected. Set TRAKT_USERNAME to select the account for scheduled sync.");
        }
      }
      const traktAccount = accounts.find((account) => account.provider === "trakt");
      linkedTraktUsername = traktAccount?.providerUsername || null;
      const letterboxdAccount = accounts.find((account) => account.provider === "letterboxd");
      if (letterboxdAccount?.metadata) {
        try {
          const metadata = JSON.parse(letterboxdAccount.metadata) as { encryptedAutomationCredentials?: unknown };
          savedLetterboxdCredentials = decryptCredentials(metadata.encryptedAutomationCredentials);
        } catch (error) {
          throw new Error(`Could not decrypt saved Letterboxd credentials: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (traktAccount?.accessToken) {
        traktToken = traktAccount.accessToken;
        refreshToken = traktAccount.refreshToken;
        expiresAt = traktAccount.expiresAt;
        if (!username) userId = traktAccount.userId;
      }
      const rows = await db.select().from(syncSettings).where(eq(syncSettings.userId, userId)).limit(1);
      settings = rows[0];
    }

    const traktUsername = username || linkedTraktUsername || process.env.TRAKT_USERNAME?.trim() || undefined;
    if (!traktToken && !traktUsername) throw new Error("No Trakt account is configured. Connect Trakt or set TRAKT_USERNAME for a public profile.");
    if (!process.env.TRAKT_CLIENT_ID?.trim()) throw new Error("TRAKT_CLIENT_ID is required to read Trakt history.");
    if (traktToken && expiresAt && expiresAt.getTime() <= Date.now() + 60_000) {
      if (!refreshToken) throw new Error("The Trakt access token expired. Reconnect Trakt to continue.");
      const origin = request.nextUrl.origin;
      const redirectUri = process.env.TRAKT_REDIRECT_URI || `${origin}/api/auth/trakt/callback`;
      const refreshed = await TraktClient.refreshAccessToken(refreshToken, redirectUri);
      traktToken = refreshed.access_token;
      if (db) {
        await db.update(linkedAccounts).set({ accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token, expiresAt: new Date(Date.now() + refreshed.expires_in * 1000), updatedAt: new Date() })
          .where(and(eq(linkedAccounts.userId, userId), eq(linkedAccounts.provider, "trakt")));
      }
    }

    const envStremboxdUsername = process.env.STREMBOXD_USERNAME?.trim() || "";
    const envStremboxdPassword = process.env.STREMBOXD_PASSWORD?.trim() || "";
    const envLetterboxdUsername = process.env.LETTERBOXD_USERNAME?.trim() || "";
    const envLetterboxdPassword = process.env.LETTERBOXD_PASSWORD?.trim() || "";
    const storedComplete = Boolean(savedLetterboxdCredentials?.username && savedLetterboxdCredentials.password);
    const envStremboxdComplete = Boolean(envStremboxdUsername && envStremboxdPassword);
    const envLetterboxdComplete = Boolean(envLetterboxdUsername && envLetterboxdPassword);
    const automationCredentials = storedComplete
      ? savedLetterboxdCredentials!
      : envStremboxdComplete
        ? { username: envStremboxdUsername, password: envStremboxdPassword }
        : envLetterboxdComplete
          ? { username: envLetterboxdUsername, password: envLetterboxdPassword }
          : null;
    const stremboxdUsername = automationCredentials?.username || "";
    const stremboxdPassword = automationCredentials?.password || "";
    if (!stremboxdUsername || !stremboxdPassword) throw new Error("Letterboxd automation credentials are missing. Configure STREMBOXD_USERNAME/PASSWORD or LETTERBOXD_USERNAME/PASSWORD on the server.");

    if (db && !settings) {
      const id = `settings_${userId}`;
      await db.insert(syncSettings).values({ id, userId }).onConflictDoNothing();
      settings = (await db.select().from(syncSettings).where(eq(syncSettings.userId, userId)).limit(1))[0];
    }

    let session: StremboxdSession | null = null;
    if (settings?.stremboxdToken && settings.stremboxdUserId && settings.stremboxdTokenAt) {
      const candidate: StremboxdSession = { userToken: settings.stremboxdToken, userId: settings.stremboxdUserId, username: stremboxdUsername, loginAt: settings.stremboxdTokenAt.getTime() };
      if (isSessionFresh(candidate)) session = candidate;
    }
    if (!session) {
      session = await stremboxdLogin(stremboxdUsername, stremboxdPassword);
      if (db) await db.update(syncSettings).set({ stremboxdToken: session.userToken, stremboxdUserId: session.userId, stremboxdTokenAt: new Date(session.loginAt), updatedAt: new Date() }).where(eq(syncSettings.userId, userId));
    }

    let alreadySynced = new Set<string>();
    let pendingImdbIds = new Set<string>();
    if (settings?.lastSyncedMovieIds) {
      try {
        const parsed = JSON.parse(settings.lastSyncedMovieIds);
        if (Array.isArray(parsed)) {
          for (const value of parsed.map(String)) {
            if (value.startsWith("pending:")) pendingImdbIds.add(value.slice("pending:".length));
            else alreadySynced.add(value);
          }
        }
      } catch { console.warn("Ignoring malformed persisted Letterboxd movie ID set."); }
    }
    const sync = new StremboxdLetterboxdSync(traktToken, traktUsername);
    const { result, newSyncedIds, pendingImdbIds: newPendingImdbIds, newLatestWatchedAt } = await sync.syncNewMovies({ session, syncedImdbIds: alreadySynced, pendingImdbIds, lastWatchedAt: settings?.latestWatchedAt ?? null });
    const status = result.errors.length ? (result.markedWatched ? "warning" : "error") : "success";

    if (db) {
      const persistedIds = [...newSyncedIds, ...[...newPendingImdbIds].map((id) => `pending:${id}`)];
      await db.update(syncSettings).set({ lastSyncedMovieIds: JSON.stringify(persistedIds), latestWatchedAt: newLatestWatchedAt, lastLetterboxdSyncAt: new Date(), lastTraktSyncAt: new Date(), status: "idle", lastErrorMessage: result.errors.length ? result.errors.join("\n").slice(0, 4000) : null, updatedAt: new Date() }).where(eq(syncSettings.userId, userId));
      await db.insert(syncLogs).values({ id: `log_lb_${Date.now()}`, userId, type: "trakt_to_letterboxd", status, title: `Trakt → Letterboxd: ${result.markedWatched} movie(s) marked watched`, details: JSON.stringify(result), itemsCount: result.markedWatched });
    }

    const hasErrors = result.errors.length > 0;
    return NextResponse.json({
      success: !hasErrors,
      error: hasErrors ? result.errors.join(" ") : undefined,
      results: { timestamp: new Date().toISOString(), traktToLetterboxd: result },
    }, { status: hasErrors ? 502 : 200 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (db) {
      try {
        await db.insert(syncLogs).values({ id: `log_lb_err_${Date.now()}`, userId, type: "trakt_to_letterboxd", status: "error", title: "Trakt → Letterboxd sync failed", details: detail.slice(0, 4000), itemsCount: 0 });
      } catch (logError) { console.error("Failed to record sync failure:", logError); }
    }
    console.error("Trakt to Letterboxd sync failed:", error);
    return NextResponse.json({ success: false, error: detail }, { status: 500 });
  }
}
