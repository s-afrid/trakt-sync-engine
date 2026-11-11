import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { linkedAccounts, syncLogs } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { isCredentialEncryptionConfigured } from "@/lib/security/credential-vault";

function cookieUsername(request: NextRequest): string | null {
  try {
    const value = request.cookies.get("trakt_user")?.value;
    const parsed = value ? JSON.parse(value) : null;
    return typeof parsed?.username === "string" ? parsed.username : null;
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  const credentialEncryptionConfigured = isCredentialEncryptionConfigured();
  const username = cookieUsername(request) || process.env.TRAKT_USERNAME || null;
  const userId = username ? `user_${username}` : "default_user";
  let traktProfile: { username: string; avatar?: string | null } | null = username ? { username } : null;
  let letterboxdProfile: { username: string; avatar?: string | null } | null = request.cookies.get("letterboxd_username")?.value
    ? { username: request.cookies.get("letterboxd_username")!.value, avatar: (() => {
        try { return JSON.parse(request.cookies.get("letterboxd_user")?.value || "{}").avatar || null; }
        catch { return null; }
      })() }
    : process.env.LETTERBOXD_USERNAME ? { username: process.env.LETTERBOXD_USERNAME } : null;
  let traktConnected = Boolean(request.cookies.get("trakt_token")?.value);
  let automationCredentialsStored = false;
  let recentRuns: Array<{ id: string; type: string; title: string; status: string; itemsCount: number; createdAt: Date; details: string | null }> = [];

  if (db) {
    try {
      let accounts = await db.select().from(linkedAccounts).where(eq(linkedAccounts.userId, userId));
      if (!username && accounts.length === 0) {
        // Single-account deployments can use the existing DB connection without a browser cookie.
        const candidates = await db.select().from(linkedAccounts);
        const distinctUsers = [...new Set(candidates.filter((a) => a.provider === "trakt").map((a) => a.userId))];
        if (distinctUsers.length === 1) accounts = candidates.filter((a) => a.userId === distinctUsers[0]);
      }
      for (const account of accounts) {
        if (account.provider === "trakt" && account.accessToken) {
          traktConnected = true;
          traktProfile = { username: account.providerUsername, avatar: account.avatarUrl };
        } else if (account.provider === "trakt" && account.providerUsername) {
          traktProfile = { username: account.providerUsername, avatar: account.avatarUrl };
        }
        if (account.provider === "letterboxd" && account.providerUsername) {
          letterboxdProfile = { username: account.providerUsername, avatar: account.avatarUrl };
          try {
            const metadata = JSON.parse(account.metadata || "{}") as { encryptedAutomationCredentials?: unknown };
            automationCredentialsStored = Boolean(metadata.encryptedAutomationCredentials);
          } catch { automationCredentialsStored = false; }
        }
      }
      const logUserId = accounts[0]?.userId || userId;
      recentRuns = await db.select({ id: syncLogs.id, type: syncLogs.type, title: syncLogs.title, status: syncLogs.status, itemsCount: syncLogs.itemsCount, createdAt: syncLogs.createdAt, details: syncLogs.details })
        .from(syncLogs).where(eq(syncLogs.userId, logUserId)).orderBy(desc(syncLogs.createdAt)).limit(10);
    } catch (error) { console.error("Could not load sync dashboard status:", error); }
  }

  return NextResponse.json({
    connected: { trakt: Boolean(traktProfile?.username), letterboxd: Boolean(letterboxdProfile) },
    traktPublicMode: Boolean(traktProfile?.username && !traktConnected),
    profiles: { trakt: traktProfile, letterboxd: letterboxdProfile },
    setup: {
      traktClientConfigured: Boolean(process.env.TRAKT_CLIENT_ID),
      traktRedirectUri: process.env.TRAKT_REDIRECT_URI || `${request.nextUrl.origin}/api/auth/trakt/callback`,
      letterboxdAutomationConfigured: Boolean(
        (process.env.STREMBOXD_USERNAME && process.env.STREMBOXD_PASSWORD) ||
        (process.env.LETTERBOXD_USERNAME && process.env.LETTERBOXD_PASSWORD) ||
        (automationCredentialsStored && credentialEncryptionConfigured)
      ),
      automationCredentialsStored,
      credentialEncryptionConfigured,
      databaseConfigured: Boolean(db),
    },
    recentRuns,
  }, { headers: { "Cache-Control": "no-store" } });
}
