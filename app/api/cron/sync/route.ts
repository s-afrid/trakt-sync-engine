import { NextRequest, NextResponse } from "next/server";
import { POST as triggerSync } from "@/app/api/sync/trigger/route";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  return triggerSync(request);
}
