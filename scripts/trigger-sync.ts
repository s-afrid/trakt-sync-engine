import { NextRequest } from "next/server";
import { GET as runSyncEngine } from "../app/api/cron/sync/route";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run the sync engine.");
  }

  console.log("Starting Trakt Sync Engine in this Node process.");
  const headers = new Headers();
  if (process.env.CRON_SECRET) {
    headers.set("authorization", `Bearer ${process.env.CRON_SECRET}`);
  }

  const request = new NextRequest("http://localhost/api/cron/sync", {
    method: "GET",
    headers,
  });
  const response = await runSyncEngine(request);
  const responseText = await response.text();

  try {
    console.log(JSON.stringify(JSON.parse(responseText), null, 2));
  } catch {
    console.log(responseText);
  }

  if (!response.ok) {
    throw new Error(`Sync engine failed with HTTP ${response.status}.`);
  }
}

main().catch((error: unknown) => {
  console.error("Trakt Sync Engine failed:", error);
  process.exitCode = 1;
});
