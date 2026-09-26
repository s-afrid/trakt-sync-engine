import { NextRequest, NextResponse } from "next/server";
import { MalClient } from "@/lib/clients/mal";
import { db } from "@/lib/db";
import { linkedAccounts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const codeVerifier = request.cookies.get("mal_pkce_verifier")?.value;

  if (error || !code) {
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent(error || "MAL authorization was cancelled")}`
    );
  }

  if (!codeVerifier) {
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent("Missing PKCE code verifier cookie. Please retry connecting to MyAnimeList.")}`
    );
  }

  try {
    const redirectUri =
      process.env.MAL_REDIRECT_URI || `${origin}/api/auth/mal/callback`;
    const tokenData = await MalClient.exchangeCodeForToken(
      code,
      codeVerifier,
      redirectUri
    );

    const client = new MalClient(tokenData.access_token);
    const malUser = await client.getCurrentUser();

    // Check if user has an associated trakt user cookie to link accounts in DB
    const traktUserCookie = request.cookies.get("trakt_user")?.value;
    let userId = "default_user";
    if (traktUserCookie) {
      try {
        const parsed = JSON.parse(traktUserCookie);
        userId = `user_${parsed.username}`;
      } catch {}
    }

    if (db) {
      try {
        const existing = await db
          .select()
          .from(linkedAccounts)
          .where(
            and(
              eq(linkedAccounts.userId, userId),
              eq(linkedAccounts.provider, "myanimelist")
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
              providerUsername: malUser.name,
              avatarUrl: malUser.picture || null,
              updatedAt: new Date(),
            })
            .where(eq(linkedAccounts.id, existing[0].id));
        } else {
          await db.insert(linkedAccounts).values({
            id: `acc_mal_${Date.now()}`,
            userId,
            provider: "myanimelist",
            providerUserId: malUser.id.toString(),
            providerUsername: malUser.name,
            avatarUrl: malUser.picture || null,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt,
          });
        }
      } catch (dbErr) {
        console.warn("DB save skipped or failed:", dbErr);
      }
    }

    const response = NextResponse.redirect(`${origin}/?success=mal_connected`);

    // Store in cookie
    response.cookies.set("mal_token", tokenData.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: tokenData.expires_in || 3600 * 24 * 30,
      path: "/",
    });

    response.cookies.set(
      "mal_user",
      JSON.stringify({
        id: malUser.id,
        name: malUser.name,
        picture: malUser.picture || null,
      }),
      {
        secure: process.env.NODE_ENV === "production",
        maxAge: 3600 * 24 * 30,
        path: "/",
      }
    );

    // Clear PKCE cookie
    response.cookies.delete("mal_pkce_verifier");

    return response;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("MAL OAuth callback error:", err);
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent(errorMsg)}`
    );
  }
}
