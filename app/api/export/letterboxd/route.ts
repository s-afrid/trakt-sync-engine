import { NextRequest, NextResponse } from "next/server";
import { TraktClient } from "@/lib/clients/trakt";
import { LetterboxdClient } from "@/lib/clients/letterboxd";
import { db } from "@/lib/db";
import { linkedAccounts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get("type") || "watched"; // 'watched' | 'ratings'

  // Retrieve Trakt token from cookie or DB
  let traktToken = request.cookies.get("trakt_token")?.value;

  if (!traktToken && db) {
    const traktAccount = await db
      .select()
      .from(linkedAccounts)
      .where(eq(linkedAccounts.provider, "trakt"))
      .limit(1);

    if (traktAccount.length > 0 && traktAccount[0].accessToken) {
      traktToken = traktAccount[0].accessToken;
    }
  }

  if (!traktToken) {
    return NextResponse.json(
      { error: "Trakt account is not connected. Please connect Trakt first." },
      { status: 401 }
    );
  }

  try {
    const traktClient = new TraktClient(traktToken);

    if (type === "ratings") {
      const ratings = await traktClient.getMovieRatings();
      const csv = LetterboxdClient.generateRatingsCsv(ratings);

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="letterboxd_ratings_${new Date().toISOString().split("T")[0]}.csv"`,
        },
      });
    } else {
      const watched = await traktClient.getWatchedMovies();
      const csv = LetterboxdClient.generateWatchedCsv(watched);

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="letterboxd_watched_${new Date().toISOString().split("T")[0]}.csv"`,
        },
      });
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
