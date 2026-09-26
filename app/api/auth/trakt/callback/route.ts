import { NextRequest, NextResponse } from "next/server";
import { TraktClient } from "@/lib/clients/trakt";
import { db } from "@/lib/db";
import { linkedAccounts, users, syncSettings } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent(error || "No code provided from Trakt")}`
    );
  }

  try {
    const redirectUri =
      process.env.TRAKT_REDIRECT_URI || `${origin}/api/auth/trakt/callback`;
    const tokenData = await TraktClient.exchangeCodeForToken(code, redirectUri);

    const client = new TraktClient(tokenData.access_token);
    const traktUser = await client.getCurrentUser();

    // If Database is connected, persist account
    if (db) {
      try {
        const userId = `user_${traktUser.username}`;

        // Ensure user exists
        await db
          .insert(users)
          .values({ id: userId })
          .onConflictDoNothing();

        // Ensure sync settings exist
        await db
          .insert(syncSettings)
          .values({
            id: `settings_${userId}`,
            userId: userId,
          })
          .onConflictDoNothing();

        // Upsert linked account
        const existing = await db
          .select()
          .from(linkedAccounts)
          .where(
            and(
              eq(linkedAccounts.userId, userId),
              eq(linkedAccounts.provider, "trakt")
            )
          )
          .limit(1);

        const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

        if (existing.length > 0) {
          await db
            .update(linkedAccounts)
            .set({
              accessToken: tokenData.access_token,
              refreshToken: tokenData.refresh_token,
              expiresAt,
              providerUsername: traktUser.username,
              avatarUrl: traktUser.images?.avatar?.full || null,
              updatedAt: new Date(),
            })
            .where(eq(linkedAccounts.id, existing[0].id));
        } else {
          await db.insert(linkedAccounts).values({
            id: `acc_trakt_${Date.now()}`,
            userId,
            provider: "trakt",
            providerUserId: traktUser.ids.slug,
            providerUsername: traktUser.username,
            avatarUrl: traktUser.images?.avatar?.full || null,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt,
          });
        }
      } catch (dbErr) {
        console.warn("DB persist skipped or errored:", dbErr);
      }
    }

    const response = NextResponse.redirect(`${origin}/?success=trakt_connected`);

    // Store in cookie for session resilience on Vercel
    response.cookies.set("trakt_token", tokenData.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: tokenData.expires_in || 3600 * 24 * 30,
      path: "/",
    });

    response.cookies.set(
      "trakt_user",
      JSON.stringify({
        username: traktUser.username,
        avatar: traktUser.images?.avatar?.full || null,
      }),
      {
        secure: process.env.NODE_ENV === "production",
        maxAge: 3600 * 24 * 30,
        path: "/",
      }
    );

    return response;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Trakt OAuth callback error:", err);
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent(errorMsg)}`
    );
  }
}
