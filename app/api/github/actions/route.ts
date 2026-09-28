import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { linkedAccounts } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { TraktClient } from "@/lib/clients/trakt";
import { LetterboxdClient } from "@/lib/clients/letterboxd";

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  runNumber: number;
  status: "queued" | "in_progress" | "completed" | string;
  conclusion: "success" | "failure" | "cancelled" | "timed_out" | null | string;
  event: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  commitMessage?: string;
  durationSeconds?: number;
}

export interface LastUpdatedMovie {
  title: string;
  year?: number;
  watchedAt: string;
  posterUrl?: string;
  tmdbId?: number;
  imdbId?: string;
  plays?: number;
  url?: string;
  isLetterboxdConfirmed: boolean;
  letterboxdUrl?: string;
}

export interface DaemonStatusInfo {
  state: "running" | "in_sleep" | "failed";
  statusLabel: string;
  description: string;
  isQuietSleep: boolean;
  lastRunAt?: string;
  lastDurationSeconds?: number;
  nextScheduledRunAt: string;
  secondsUntilNextRun: number;
}

export interface GitHubActionsStatusResponse {
  success: boolean;
  repo: string;
  workflow: string;
  daemon: DaemonStatusInfo;
  latestRun: GitHubWorkflowRun | null;
  runs: GitHubWorkflowRun[];
  totalRuns: number;
  lastUpdatedMovies: LastUpdatedMovie[];
  error?: string;
}

export async function GET(request: NextRequest) {
  try {
    const owner = process.env.GITHUB_REPOSITORY_OWNER || "s-afrid";
    const repo = process.env.GITHUB_REPOSITORY_NAME || "trakt-sync-engine";
    const workflow = "letterboxd-sync.yml";

    // Extract user credentials
    let traktToken = request.cookies.get("trakt_token")?.value;
    let traktUsername = request.cookies.get("trakt_username")?.value || process.env.TRAKT_USERNAME || "afsindbad";
    let letterboxdUsername =
      request.cookies.get("letterboxd_username")?.value || process.env.LETTERBOXD_USERNAME || "Af_Sindbad";

    if (db) {
      try {
        const accounts = await db
          .select()
          .from(linkedAccounts)
          .orderBy(desc(linkedAccounts.updatedAt));

        for (const acc of accounts) {
          if (acc.provider === "trakt") {
            if (!traktToken && acc.accessToken) traktToken = acc.accessToken;
            if (acc.providerUsername) traktUsername = acc.providerUsername;
          }
          if (acc.provider === "letterboxd" && acc.providerUsername) {
            letterboxdUsername = acc.providerUsername;
          }
        }
      } catch (dbErr) {
        console.warn("DB account lookup in github actions status skipped:", dbErr);
      }
    }

    // GitHub API headers (unauthenticated or with GITHUB_TOKEN if available)
    const ghHeaders: Record<string, string> = {
      "User-Agent": "TraktSyncEngine/1.0",
      Accept: "application/vnd.github+json",
    };

    if (process.env.GITHUB_TOKEN) {
      ghHeaders["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const runsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/runs?per_page=10`;

    // Fetch GitHub workflow runs, Trakt watched movies, and Letterboxd RSS in parallel
    const [ghRes, watchedMovies, lbRss] = await Promise.all([
      fetch(runsUrl, { headers: ghHeaders, cache: "no-store" }).catch(() => null),
      (async () => {
        try {
          const traktClient = new TraktClient(traktToken, traktUsername);
          return await traktClient.getWatchedMovies();
        } catch {
          return [];
        }
      })(),
      (async () => {
        try {
          return await LetterboxdClient.fetchUserRss(letterboxdUsername);
        } catch {
          return [];
        }
      })(),
    ]);

    // 1. Process GitHub Action runs
    let rawRuns: any[] = [];
    let totalRuns = 0;
    if (ghRes && ghRes.ok) {
      const ghData = await ghRes.json().catch(() => ({}));
      rawRuns = ghData.workflow_runs || [];
      totalRuns = ghData.total_count || 0;
    }

    const runs: GitHubWorkflowRun[] = rawRuns.map((r: any) => {
      let durationSeconds: number | undefined = undefined;
      if (r.created_at && r.updated_at) {
        const diff = new Date(r.updated_at).getTime() - new Date(r.created_at).getTime();
        if (diff > 0) durationSeconds = Math.round(diff / 1000);
      }

      return {
        id: r.id,
        name: r.name,
        runNumber: r.run_number,
        status: r.status,
        conclusion: r.conclusion,
        event: r.event,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        htmlUrl: r.html_url,
        commitMessage: r.head_commit?.message?.split("\n")[0] || "",
        durationSeconds,
      };
    });

    const latestRun = runs[0] || null;

    // 2. Calculate next scheduled 15-minute cron mark (00, 15, 30, 45 mins)
    const now = new Date();
    const currentMinutes = now.getUTCMinutes();
    const currentSeconds = now.getUTCSeconds();
    const remainder = currentMinutes % 15;
    const minutesToNext = 15 - remainder;
    const nextRunDate = new Date(now.getTime() + (minutesToNext * 60 - currentSeconds) * 1000);
    const secondsUntilNextRun = Math.max(0, Math.round((nextRunDate.getTime() - now.getTime()) / 1000));

    // 3. Determine Daemon State
    let daemonState: "running" | "in_sleep" | "failed" = "in_sleep";
    let statusLabel = "In Sleep (Quiet Mode)";
    let description = "Daemon is in Quiet Sleep consuming 0% CPU. Next automated check in scheduled interval.";
    let isQuietSleep = true;

    if (latestRun) {
      if (latestRun.status === "in_progress" || latestRun.status === "queued") {
        daemonState = "running";
        statusLabel = "Active Sync in Progress";
        description = "GitHub Actions runner is actively executing and diffing Trakt ➔ Letterboxd & MAL in the cloud.";
        isQuietSleep = false;
      } else if (latestRun.conclusion === "failure" || latestRun.conclusion === "timed_out") {
        daemonState = "failed";
        statusLabel = "Workflow Failed";
        description = "The last GitHub Actions run encountered an error. Check execution logs on GitHub.";
        isQuietSleep = false;
      } else if (latestRun.conclusion === "success") {
        daemonState = "in_sleep";
        statusLabel = "In Sleep (Quiet Mode)";
        description = "Trakt is up to date. Daemon is quietly waiting for the next 15-minute cycle.";
        isQuietSleep = true;
      }
    }

    const daemon: DaemonStatusInfo = {
      state: daemonState,
      statusLabel,
      description,
      isQuietSleep,
      lastRunAt: latestRun ? latestRun.updatedAt || latestRun.createdAt : undefined,
      lastDurationSeconds: latestRun?.durationSeconds,
      nextScheduledRunAt: nextRunDate.toISOString(),
      secondsUntilNextRun,
    };

    // 4. Extract Last 2 Movies Updated Every Time App Runs
    const verifiedLbTitles = new Set<string>();
    const verifiedLbTmdbIds = new Set<number>();
    for (const item of lbRss) {
      if (item.filmTitle) verifiedLbTitles.add(item.filmTitle.trim().toLowerCase());
      if (item.title) verifiedLbTitles.add(item.title.split(",")[0].trim().toLowerCase());
      if (item.tmdbId) verifiedLbTmdbIds.add(item.tmdbId);
    }

    const sortedMovies = [...watchedMovies].sort((a, b) => {
      const timeA = a.last_watched_at ? new Date(a.last_watched_at).getTime() : 0;
      const timeB = b.last_watched_at ? new Date(b.last_watched_at).getTime() : 0;
      return timeB - timeA;
    });

    const lastUpdatedMovies: LastUpdatedMovie[] = sortedMovies.slice(0, 2).map((m) => {
      const cleanTitle = m.movie.title.trim().toLowerCase();
      const isConfirmed =
        verifiedLbTitles.has(cleanTitle) ||
        (m.movie.ids?.tmdb ? verifiedLbTmdbIds.has(m.movie.ids.tmdb) : false);

      const imdbId = m.movie.ids?.imdb;
      const tmdbId = m.movie.ids?.tmdb;
      const posterUrl = imdbId ? `https://images.metahub.space/poster/medium/${imdbId}/img` : undefined;

      const slug = m.movie.ids?.slug || m.movie.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const letterboxdUrl = tmdbId
        ? `https://letterboxd.com/tmdb/${tmdbId}`
        : `https://letterboxd.com/film/${slug}/`;

      return {
        title: m.movie.title,
        year: m.movie.year,
        watchedAt: m.last_watched_at || m.last_updated_at || new Date().toISOString(),
        posterUrl,
        tmdbId,
        imdbId,
        plays: m.plays,
        url: `https://trakt.tv/movies/${m.movie.ids?.slug || m.movie.ids?.trakt}`,
        isLetterboxdConfirmed: isConfirmed,
        letterboxdUrl,
      };
    });

    return NextResponse.json({
      success: true,
      repo: `${owner}/${repo}`,
      workflow,
      daemon,
      latestRun,
      runs,
      totalRuns,
      lastUpdatedMovies,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("GET /api/github/actions error:", err);
    return NextResponse.json(
      {
        success: false,
        error: msg,
        repo: "s-afrid/trakt-sync-engine",
        workflow: "letterboxd-sync.yml",
        daemon: {
          state: "in_sleep",
          statusLabel: "In Sleep (Quiet Mode)",
          description: "Could not query GitHub Actions API; falling back to default quiet schedule.",
          isQuietSleep: true,
          nextScheduledRunAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          secondsUntilNextRun: 900,
        },
        latestRun: null,
        runs: [],
        totalRuns: 0,
        lastUpdatedMovies: [],
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const owner = process.env.GITHUB_REPOSITORY_OWNER || "s-afrid";
    const repo = process.env.GITHUB_REPOSITORY_NAME || "trakt-sync-engine";
    const workflow = "letterboxd-sync.yml";
    const token = process.env.GITHUB_TOKEN;

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          error: "GITHUB_TOKEN is not configured on this server. You can trigger it directly on GitHub.",
          githubUrl: `https://github.com/${owner}/${repo}/actions/workflows/${workflow}`,
        },
        { status: 400 }
      );
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": "TraktSyncEngine/1.0",
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ref: "main" }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json(
        { success: false, error: `GitHub dispatch failed (${res.status}): ${err}` },
        { status: res.status }
      );
    }

    return NextResponse.json({
      success: true,
      message: "GitHub Actions workflow dispatched successfully!",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
