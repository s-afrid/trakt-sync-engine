import { NextRequest, NextResponse } from "next/server";
import { LetterboxdClient } from "@/lib/clients/letterboxd";
import { db } from "@/lib/db";
import { linkedAccounts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { encryptCredentials } from "@/lib/security/credential-vault";
import { stremboxdLogin } from "@/lib/sync/stremboxd-letterboxd-sync";

export async function POST(request: NextRequest) {
  try {
    if (!request.cookies.get("trakt_user")?.value) {
      return NextResponse.json({ error: "Connect a Trakt username before linking Letterboxd." }, { status: 401 });
    }
    const body = await request.json();
    const username = body?.username;
    const automationUsername = body?.automationUsername;
    const password = body?.password;

    if (!username || typeof username !== "string" || !username.trim()) {
      return NextResponse.json(
        { error: "A valid Letterboxd username is required." },
        { status: 400 }
      );
    }

    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(cleanUsername)) {
      return NextResponse.json({ error: "Enter a valid Letterboxd username." }, { status: 400 });
    }
    if (password !== undefined && (typeof password !== "string" || password.length > 512)) {
      return NextResponse.json({ error: "Password must be 512 characters or fewer." }, { status: 400 });
    }
    if (automationUsername !== undefined && (typeof automationUsername !== "string" || automationUsername.length > 128)) {
      return NextResponse.json({ error: "Automation login username must be 128 characters or fewer." }, { status: 400 });
    }
    const lbProfile = await LetterboxdClient.fetchUserProfile(cleanUsername);
    const cleanAutomationUsername = typeof automationUsername === "string" && automationUsername.trim()
      ? automationUsername.trim()
      : cleanUsername;
    const encryptedCredentials = typeof password === "string" && password.length > 0
      ? encryptCredentials({ username: cleanAutomationUsername, password })
      : null;
    if (encryptedCredentials) await stremboxdLogin(cleanAutomationUsername, password as string);

    const traktUserCookie = request.cookies.get("trakt_user")?.value;
    let userId = "default_user";
    if (traktUserCookie) {
      try {
        const parsed = JSON.parse(traktUserCookie);
        userId = `user_${parsed.username}`;
      } catch {}
    }

    if (!db) return NextResponse.json({ error: "DATABASE_URL is required to store account settings." }, { status: 503 });
    const existing = await db
      .select()
      .from(linkedAccounts)
      .where(and(eq(linkedAccounts.userId, userId), eq(linkedAccounts.provider, "letterboxd")))
      .limit(1);
    const oldMetadata = (() => {
      try { return JSON.parse(existing[0]?.metadata || "{}"); }
      catch { return {}; }
    })() as Record<string, unknown>;
    const nextMetadata = encryptedCredentials
      ? JSON.stringify({ ...oldMetadata, encryptedAutomationCredentials: encryptedCredentials })
      : existing[0]?.metadata || null;

    if (existing.length > 0) {
      await db.update(linkedAccounts).set({
        providerUsername: cleanUsername,
        avatarUrl: lbProfile.avatar || existing[0].avatarUrl,
        metadata: nextMetadata,
        updatedAt: new Date(),
      }).where(eq(linkedAccounts.id, existing[0].id));
    } else {
      await db.insert(linkedAccounts).values({
        id: `acc_lb_${Date.now()}`,
        userId,
        provider: "letterboxd",
        providerUsername: cleanUsername,
        avatarUrl: lbProfile.avatar || null,
        metadata: nextMetadata,
      });
    }

    const response = NextResponse.json({
      success: true,
      username: cleanUsername,
      displayName: lbProfile.displayName,
      avatar: lbProfile.avatar,
      automationCredentialsStored: Boolean(encryptedCredentials || oldMetadata.encryptedAutomationCredentials),
    });

    response.cookies.set("letterboxd_username", cleanUsername, {
      secure: process.env.NODE_ENV === "production",
      maxAge: 3600 * 24 * 365,
      path: "/",
    });

    response.cookies.set("letterboxd_user", JSON.stringify(lbProfile), {
      secure: process.env.NODE_ENV === "production",
      maxAge: 3600 * 24 * 365,
      path: "/",
    });

    return response;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete("letterboxd_username");
  return response;
}
