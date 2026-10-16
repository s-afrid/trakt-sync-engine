import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { linkedAccounts, syncLogs, syncSettings } from "@/lib/db/schema";
import { and, eq, ilike } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      status = "success",
      type = "letterboxd_import",
      title = "Automated Letterboxd Import",
      details = {},
      itemsCount = 0,
      userId = "default_user",
      traktUsername,
    } = body;

    if (!db) {
      return NextResponse.json({
        success: true,
        message: "Report received (DB not configured in this environment).",
      });
    }

    const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const detailsString = typeof details === "string" ? details : JSON.stringify(details);
    let resolvedUserId = typeof userId === "string" && userId.trim() ? userId.trim() : "default_user";

    if (typeof traktUsername === "string" && traktUsername.trim()) {
      try {
        const accounts = await db
          .select({ userId: linkedAccounts.userId })
          .from(linkedAccounts)
          .where(and(
            eq(linkedAccounts.provider, "trakt"),
            ilike(linkedAccounts.providerUsername, traktUsername.trim())
          ))
          .limit(1);
        if (accounts[0]?.userId) resolvedUserId = accounts[0].userId;
      } catch (accountErr) {
        console.warn("Could not resolve sync report Trakt account:", accountErr);
      }
    }

    await db.insert(syncLogs).values({
      id: logId,
      userId: resolvedUserId,
      type,
      status: status === "success" ? "success" : status === "warning" ? "warning" : "error",
      title,
      details: detailsString,
      itemsCount: Number(itemsCount) || 0,
      createdAt: new Date(),
    });

    if (status === "success" && type === "letterboxd_direct_watch") {
      try {
        const parsedDetails = typeof details === "string" ? JSON.parse(details) : details;
        const reportedIds = Array.isArray(parsedDetails?.syncedImdbIds)
          ? parsedDetails.syncedImdbIds.map((id: unknown) => String(id)).filter(Boolean)
          : [];
        if (reportedIds.length > 0) {
          const settingsRows = await db
            .select({ lastSyncedMovieIds: syncSettings.lastSyncedMovieIds })
            .from(syncSettings)
            .where(eq(syncSettings.userId, resolvedUserId))
            .limit(1);
          const existingIds = settingsRows[0]?.lastSyncedMovieIds
            ? JSON.parse(settingsRows[0].lastSyncedMovieIds)
            : [];
          const mergedIds = new Set<string>(
            Array.isArray(existingIds) ? existingIds.map((id: unknown) => String(id)) : []
          );
          reportedIds.forEach((id: string) => mergedIds.add(id));
          await db
            .update(syncSettings)
            .set({
              lastSyncedMovieIds: JSON.stringify([...mergedIds]),
              lastLetterboxdSyncAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(syncSettings.userId, resolvedUserId));
        }
      } catch (stateErr) {
        console.warn("Could not update confirmed Letterboxd movie IDs:", stateErr);
      }
    }

    return NextResponse.json({
      success: true,
      logId,
      message: "Sync execution report recorded successfully.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error saving sync report:", err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
