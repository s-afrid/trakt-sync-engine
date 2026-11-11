import { NextRequest, NextResponse } from "next/server";
import { TraktClient } from "@/lib/clients/trakt";
import { db } from "@/lib/db";
import { linkedAccounts, syncSettings, users } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    if (!process.env.TRAKT_CLIENT_ID?.trim()) {
      return NextResponse.json({ error: "TRAKT_CLIENT_ID is required to look up public Trakt profiles." }, { status: 503 });
    }
    const body = await request.json();
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(username)) {
      return NextResponse.json({ error: "Enter a valid Trakt username." }, { status: 400 });
    }
    // Public profile lookup avoids OAuth token exchange. It still requires the Trakt API client ID.
    const profile = await new TraktClient(undefined, username).getCurrentUser();
    if (!db) return NextResponse.json({ error: "DATABASE_URL is required to save connected profiles." }, { status: 503 });
    const userId = `user_${profile.username}`;
    await db.insert(users).values({ id: userId }).onConflictDoNothing();
    await db.insert(syncSettings).values({ id: `settings_${userId}`, userId }).onConflictDoNothing();
    const existing = await db.select().from(linkedAccounts)
      .where(and(eq(linkedAccounts.userId, userId), eq(linkedAccounts.provider, "trakt"))).limit(1);
    const avatarUrl = profile.images?.avatar?.full || null;
    if (existing.length) {
      await db.update(linkedAccounts).set({
        providerUsername: profile.username,
        providerUserId: profile.ids.slug,
        avatarUrl,
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        updatedAt: new Date(),
      })
        .where(eq(linkedAccounts.id, existing[0].id));
    } else {
      await db.insert(linkedAccounts).values({
        id: `acc_trakt_${Date.now()}`, userId, provider: "trakt", providerUserId: profile.ids.slug,
        providerUsername: profile.username, avatarUrl,
      });
    }
    const response = NextResponse.json({ success: true, username: profile.username, avatar: avatarUrl });
    response.cookies.set("trakt_user", JSON.stringify({ username: profile.username, avatar: avatarUrl }), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", maxAge: 3600 * 24 * 365,
      path: "/", sameSite: "lax",
    });
    response.cookies.delete("trakt_token");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
