import { NextRequest, NextResponse } from "next/server";
import { TraktClient } from "@/lib/clients/trakt";
import { db } from "@/lib/db";
import { linkedAccounts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const { username } = await request.json();

    if (!username || typeof username !== "string" || !username.trim()) {
      return NextResponse.json(
        { error: "A valid Trakt username is required." },
        { status: 400 }
      );
    }

    const cleanUsername = username.trim();
    const client = new TraktClient(undefined, cleanUsername);
    const traktUser = await client.getCurrentUser();

    if (db) {
      try {
        const userId = `user_${cleanUsername}`;
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

        if (existing.length > 0) {
          await db
            .update(linkedAccounts)
            .set({
              providerUsername: cleanUsername,
              avatarUrl: traktUser.images?.avatar?.full || null,
              updatedAt: new Date(),
            })
            .where(eq(linkedAccounts.id, existing[0].id));
        } else {
          await db.insert(linkedAccounts).values({
            id: `acc_trakt_${Date.now()}`,
            userId,
            provider: "trakt",
            providerUserId: cleanUsername,
            providerUsername: cleanUsername,
            avatarUrl: traktUser.images?.avatar?.full || null,
          });
        }
      } catch (dbErr) {
        console.warn("DB save skipped:", dbErr);
      }
    }

    const response = NextResponse.json({
      success: true,
      user: {
        username: cleanUsername,
        avatar: traktUser.images?.avatar?.full || null,
      },
    });

    response.cookies.set("trakt_username", cleanUsername, {
      secure: process.env.NODE_ENV === "production",
      maxAge: 3600 * 24 * 365,
      path: "/",
    });

    response.cookies.set(
      "trakt_user",
      JSON.stringify({
        username: cleanUsername,
        avatar: traktUser.images?.avatar?.full || null,
      }),
      {
        secure: process.env.NODE_ENV === "production",
        maxAge: 3600 * 24 * 365,
        path: "/",
      }
    );

    return response;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
