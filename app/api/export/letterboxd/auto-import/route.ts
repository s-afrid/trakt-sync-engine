import { NextRequest, NextResponse } from "next/server";
import { TraktClient } from "@/lib/clients/trakt";
import { LetterboxdClient } from "@/lib/clients/letterboxd";
import { db } from "@/lib/db";
import { linkedAccounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const type = body.type || "watched"; // 'watched' | 'ratings'
    const autoConfirm = Boolean(body.autoConfirm);
    const interval = body.interval ? parseInt(body.interval, 10) : undefined;
    const headless = Boolean(body.headless);

    // Retrieve Trakt token or username from cookie or DB
    let traktToken = request.cookies.get("trakt_token")?.value;
    let traktUsername = request.cookies.get("trakt_username")?.value;

    if (!traktToken && !traktUsername && db) {
      const traktAccount = await db
        .select()
        .from(linkedAccounts)
        .where(eq(linkedAccounts.provider, "trakt"))
        .limit(1);

      if (traktAccount.length > 0) {
        traktToken = traktAccount[0].accessToken || undefined;
        traktUsername = traktAccount[0].providerUsername;
      }
    }

    if (!traktToken && !traktUsername) {
      return NextResponse.json(
        { error: "Trakt account is not connected. Please connect Trakt first." },
        { status: 401 }
      );
    }

    // Letterboxd credentials
    let lbUsername = body.username || process.env.LETTERBOXD_USERNAME;
    let lbPassword = body.password || process.env.LETTERBOXD_PASSWORD;

    // Check DB for Letterboxd username if not configured in env
    if (!lbUsername && db) {
      const lbAccount = await db
        .select()
        .from(linkedAccounts)
        .where(eq(linkedAccounts.provider, "letterboxd"))
        .limit(1);

      if (lbAccount.length > 0) {
        lbUsername = lbAccount[0].providerUsername;
      }
    }

    if (!lbUsername || !lbPassword) {
      return NextResponse.json(
        {
          error:
            "Letterboxd credentials required. Please provide your Letterboxd username and password in .env or via the prompt.",
          requiresCredentials: true,
          username: lbUsername || "",
        },
        { status: 400 }
      );
    }

    // Generate CSV
    const traktClient = new TraktClient(traktToken, traktUsername);
    let csvData = "";
    let itemCount = 0;

    if (type === "ratings") {
      const ratings = await traktClient.getMovieRatings();
      csvData = LetterboxdClient.generateRatingsCsv(ratings);
      itemCount = ratings.length;
    } else {
      const watched = await traktClient.getWatchedMovies();
      csvData = LetterboxdClient.generateWatchedCsv(watched);
      itemCount = watched.length;
    }

    // Save CSV to project root
    const cwd = process.cwd();
    const csvFileName = `letterboxd_${type}_import.csv`;
    const csvFilePath = path.join(cwd, csvFileName);
    fs.writeFileSync(csvFilePath, csvData, "utf-8");

    // Locate Python executable
    const venvPythonWin = path.join(cwd, ".venv", "Scripts", "python.exe");
    const venvPythonPosix = path.join(cwd, ".venv", "bin", "python");

    let pythonPath = "python";
    if (fs.existsSync(venvPythonWin)) {
      pythonPath = venvPythonWin;
    } else if (fs.existsSync(venvPythonPosix)) {
      pythonPath = venvPythonPosix;
    }

    const scriptPath = path.join(cwd, "scripts", "automate_letterboxd_upload.py");

    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        { error: "Automation script not found at scripts/automate_letterboxd_upload.py" },
        { status: 500 }
      );
    }

    const scriptArgs = [
      scriptPath,
      "--file",
      csvFilePath,
      "--username",
      lbUsername,
      "--password",
      lbPassword,
    ];

    if (autoConfirm) {
      scriptArgs.push("--auto-confirm");
    }

    if (interval) {
      scriptArgs.push("--interval", String(interval));
    }

    if (headless) {
      scriptArgs.push("--headless");
    }

    // Launch automation in detached child process so the browser window appears to the user
    const child = spawn(pythonPath, scriptArgs, {
      cwd,
      detached: true,
      stdio: "ignore",
    });

    child.unref();

    return NextResponse.json({
      success: true,
      message:
        "Playwright automation started! A browser window is launching to log into Letterboxd and transfer your CSV file.",
      type,
      itemCount,
      csvFile: csvFileName,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
