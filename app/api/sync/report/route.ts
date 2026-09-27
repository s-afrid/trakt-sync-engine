import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncLogs } from "@/lib/db/schema";

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
    } = body;

    if (!db) {
      return NextResponse.json({
        success: true,
        message: "Report received (DB not configured in this environment).",
      });
    }

    const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const detailsString = typeof details === "string" ? details : JSON.stringify(details);

    await db.insert(syncLogs).values({
      id: logId,
      userId,
      type,
      status: status === "success" ? "success" : status === "warning" ? "warning" : "error",
      title,
      details: detailsString,
      itemsCount: Number(itemsCount) || 0,
      createdAt: new Date(),
    });

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
