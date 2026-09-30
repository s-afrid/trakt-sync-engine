import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

// Load .env manually
const envPath = new URL("../.env", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
try {
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?/);
    if (m) process.env[m[1]] = m[2];
  }
} catch {}

const sql = neon(process.env.DATABASE_URL);

const alters = [
  "ALTER TABLE sync_settings ADD COLUMN IF NOT EXISTS last_synced_movie_ids TEXT",
  "ALTER TABLE sync_settings ADD COLUMN IF NOT EXISTS latest_watched_at TEXT",
  "ALTER TABLE sync_settings ADD COLUMN IF NOT EXISTS stremboxd_token TEXT",
  "ALTER TABLE sync_settings ADD COLUMN IF NOT EXISTS stremboxd_user_id TEXT",
  "ALTER TABLE sync_settings ADD COLUMN IF NOT EXISTS stremboxd_token_at TIMESTAMP",
];

for (const q of alters) {
  await sql(q);
  console.log("✅", q.slice(0, 70));
}
console.log("Done — Neon DB columns added.");
