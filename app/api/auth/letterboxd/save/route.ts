import { NextRequest, NextResponse } from "next/server";
import { LetterboxdClient } from "@/lib/clients/letterboxd";
import { db } from "@/lib/db";
import { linkedAccounts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const { username } = await request.json();

    if (!username || typeof username !== "string" || !username.trim()) {
      return NextResponse.json(
        { error: "A valid Letterboxd username is required." },
        { status: 400 }
      );
    }

    const cleanUsername = username.trim().toLowerCase();

    // Verify user profile / RSS feed works
    try {
      await LetterboxdClient.fetchUserRss(cleanUsername);
    } catch {
      // Don't fail completely if user has no RSS entries yet, but log it
    }

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
              eq(linkedAccounts.provider, "letterboxd")
            )
          )
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(linkedAccounts)
            .set({
              providerUsername: cleanUsername,
              updatedAt: new Date(),
            })
            .where(eq(linkedAccounts.id, existing[0].id));
        } else {
          await db.insert(linkedAccounts).values({
            id: `acc_lb_${Date.now()}`,
            userId,
            provider: "letterboxd",
            providerUsername: cleanUsername,
          });
        }
      } catch (dbErr) {
        console.warn("DB save skipped for letterboxd:", dbErr);
      }
    }

    const response = NextResponse.json({
      success: true,
      username: cleanUsername,
    });

    response.cookies.set("letterboxd_username", cleanUsername, {
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
