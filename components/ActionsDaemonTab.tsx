"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Bot,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Clock,
  Play,
  Moon,
  Sparkles,
  Zap,
  Film,
  Calendar,
  Layers,
  ArrowUpRight,
  ShieldCheck,
  Cpu,
  Terminal,
} from "lucide-react";
import { GitHubWorkflowRun, LastUpdatedMovie, GitHubActionsStatusResponse } from "@/app/api/github/actions/route";
import MoviePoster from "@/components/MoviePoster";
import { LetterboxdLogo, TraktLogo } from "@/components/icons";

function formatRelativeTime(dateString?: string): string {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return "just now";
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    if (diffMinutes < 1) return "just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return "";
  }
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null) return "--";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export default function ActionsDaemonTab() {
  const [data, setData] = useState<GitHubActionsStatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [countdown, setCountdown] = useState<number>(0);
  const [dispatchLoading, setDispatchLoading] = useState<boolean>(false);
  const [dispatchMessage, setDispatchMessage] = useState<string | null>(null);

  const fetchStatus = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/github/actions", { cache: "no-store" });
      const json: GitHubActionsStatusResponse = await res.json();
      if (!res.ok && !json.latestRun) {
        throw new Error(json.error || `HTTP error ${res.status}`);
      }
      setData(json);
      setCountdown(json.daemon?.secondsUntilNextRun || 900);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchStatus();
  }, []);

  // Real-time second-by-second countdown ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // Time to poll for new run state
          fetchStatus();
          return 900;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Auto-refresh poll every 15 seconds if enabled
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchStatus();
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const handleManualTrigger = async () => {
    setDispatchLoading(true);
    setDispatchMessage(null);
    try {
      const res = await fetch("/api/github/actions", { method: "POST" });
      const json = await res.json();
      if (res.ok) {
        setDispatchMessage("Workflow dispatched! Updating run status...");
        setTimeout(() => fetchStatus(), 2000);
      } else {
        // Fallback: open GitHub Actions workflow page directly
        window.open(
          `https://github.com/s-afrid/trakt-sync-engine/actions/workflows/letterboxd-sync.yml`,
          "_blank",
          "noopener,noreferrer"
        );
      }
    } catch {
      window.open(
        `https://github.com/s-afrid/trakt-sync-engine/actions/workflows/letterboxd-sync.yml`,
        "_blank",
        "noopener,noreferrer"
      );
    } finally {
      setDispatchLoading(false);
    }
  };

  const daemonState = data?.daemon?.state || "in_sleep";
  const isRunning = daemonState === "running";
  const isFailed = daemonState === "failed";
  const isInSleep = daemonState === "in_sleep";

  const minutesRemaining = Math.floor(countdown / 60);
  const secondsRemaining = countdown % 60;
  const countdownFormatted = `${minutesRemaining}m ${String(secondsRemaining).padStart(2, "0")}s`;

  return (
    <div className="space-y-6">
      {/* Top Header Card with Real-Time Daemon State */}
      <div
        className={`p-4 sm:p-6 rounded-2xl border transition-all duration-300 shadow-xl ${
          isRunning
            ? "bg-gradient-to-r from-success/10 via-accent/10 to-surface border-success/40 shadow-success/10"
            : isFailed
            ? "bg-gradient-to-r from-danger/10 via-surface/60 to-surface border-danger/40 shadow-danger/10"
            : "bg-gradient-to-r from-accent/10 via-accent/10 to-surface border-accent/30 shadow-accent/10"
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          {/* Status Indicator & Description */}
          <div className="flex items-start gap-4 min-w-0">
            <div
              className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 border mt-0.5 ${
                isRunning
                  ? "bg-success/15 border-success/40 text-success"
                  : isFailed
                  ? "bg-danger/15 border-danger/40 text-danger"
                  : "bg-accent/15 border-accent/30 text-accent"
              }`}
            >
              {isRunning ? (
                <RefreshCw className="h-6 w-6 animate-spin text-success" />
              ) : isFailed ? (
                <AlertCircle className="h-6 w-6 text-danger" />
              ) : (
                <Moon className="h-6 w-6 text-accent" />
              )}
            </div>

            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono uppercase tracking-wider text-ink-muted">
                  GitHub Actions Daemon Status
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border shadow-sm ${
                    isRunning
                      ? "bg-success/20 text-success border-success/40"
                      : isFailed
                      ? "bg-danger/20 text-danger border-danger/40"
                      : "bg-accent/20 text-accent border-accent/40"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isRunning
                        ? "bg-success animate-ping"
                        : isFailed
                        ? "bg-danger"
                        : "bg-accent animate-pulse"
                    }`}
                  />
                  {isRunning
                    ? "🟢 RUNNING • ACTIVE CLOUD SYNC"
                    : isFailed
                    ? "🔴 FAILED • REQUIRES REVIEW"
                    : "💤 IN SLEEP • QUIET MODE (0% CPU)"}
                </span>
              </div>

              <h2 className="text-lg sm:text-xl font-black text-ink tracking-tight">
                {isRunning
                  ? "GitHub Actions Cloud Runner is Active"
                  : isFailed
                  ? "Last GitHub Sync Run Failed"
                  : "Daemon is Sleeping Quietly"}
              </h2>

              <p className="text-xs text-ink-muted/90 leading-relaxed max-w-2xl">
                {data?.daemon?.description ||
                  "Checks Trakt scrobbles every 15 minutes. Automatically updates Letterboxd and MyAnimeList only when new watches occur."}
              </p>
            </div>
          </div>

          {/* Real-time Ticker & Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-edge">
            {/* Live Countdown Box */}
            <div className="px-4 py-2.5 rounded-xl bg-canvas/50 border border-edge flex items-center justify-between sm:justify-start gap-3">
              <div className="space-y-0.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-ink-muted block">
                  Next 15-Min Check In
                </span>
                <span className="text-base sm:text-lg font-mono font-bold text-ink flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-accent shrink-0" />
                  {countdownFormatted}
                </span>
              </div>
            </div>

            {/* Manual Trigger & Refresh Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchStatus(true)}
                disabled={refreshing}
                title="Refresh Real-Time Telemetry"
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-elevated/90 hover:bg-raised border border-edge text-xs font-semibold text-ink transition-all shadow-sm"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-accent" : ""}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>

              <button
                onClick={handleManualTrigger}
                disabled={dispatchLoading}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-accent hover:bg-accent/85 text-xs font-bold text-canvas shadow-md border border-edge transition-all"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Run Job Now</span>
              </button>
            </div>
          </div>
        </div>

        {dispatchMessage && (
          <div className="mt-3 p-2.5 rounded-lg bg-success/10 border border-success/30 text-xs text-success">
            {dispatchMessage}
          </div>
        )}
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-danger/10 border border-danger/30 text-ink flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-danger shrink-0 mt-0.5" />
          <div className="text-sm flex-1">
            <p className="font-semibold">GitHub Actions telemetry unavailable</p>
            <p className="text-danger/90 mt-0.5">{error}</p>
          </div>
          <button onClick={() => fetchStatus(true)} className="text-xs text-danger hover:text-ink underline">
            Retry
          </button>
        </div>
      )}

      {/* SPOTLIGHT SECTION: Last 2 Movies Updated Every Time App Runs */}
      <div className="p-5 sm:p-6 rounded-2xl bg-surface/90 border border-edge shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-edge pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Film className="h-4 w-4 text-danger" />
              <h3 className="text-sm sm:text-base font-bold text-ink tracking-tight">
                Last 2 Movies Updated Every Time App Runs
              </h3>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-danger/20 text-danger border border-danger/30">
                Verified Scrobbles
              </span>
            </div>
            <p className="text-xs text-ink-muted">
              The latest 2 movies detected and synchronized between Trakt history and Letterboxd.
            </p>
          </div>

          <span className="text-[11px] font-mono text-ink-subtle">
            Auto-diffed on each 15-min cycle
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center space-y-2">
            <RefreshCw className="h-6 w-6 text-accent animate-spin mx-auto" />
            <p className="text-xs text-ink-muted">Fetching latest synchronized movies...</p>
          </div>
        ) : !data?.lastUpdatedMovies || data.lastUpdatedMovies.length === 0 ? (
          <div className="p-8 text-center space-y-2 text-ink-muted text-xs">
            <Film className="h-8 w-8 text-ink-subtle mx-auto" />
            <p>No recently watched movies found in Trakt history.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.lastUpdatedMovies.map((movie, idx) => (
              <div
                key={`${movie.title}-${idx}`}
                className="group relative p-4 rounded-xl bg-canvas/40 hover:bg-surface border border-edge hover:border-ink-subtle/40 transition-all flex gap-4 shadow-sm"
              >
                {/* Ranking Pill */}
                <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md bg-ink/10 border border-edge text-[10px] font-mono text-ink-muted font-bold">
                  #{idx + 1} Latest
                </div>

                {/* Movie Poster */}
                <MoviePoster
                  src={movie.posterUrl}
                  title={movie.title}
                  year={movie.year}
                  platform="letterboxd"
                  type="movie"
                  className="w-16 sm:w-20 rounded-xl shadow-md border border-edge shrink-0"
                />

                {/* Metadata & Actions */}
                <div className="min-w-0 flex-1 flex flex-col justify-between space-y-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-danger/15 border border-danger/30 text-danger">
                        <TraktLogo size={11} className="text-[#ED1C24]" />
                        <span>Trakt Logged</span>
                      </span>

                      {movie.isLetterboxdConfirmed ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#00E054]/15 border border-[#00E054]/30 text-[#00E054]">
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          <span>Letterboxd Confirmed</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-accent/15 border border-accent/30 text-accent">
                          <Clock className="h-2.5 w-2.5" />
                          <span>Synced in State</span>
                        </span>
                      )}
                    </div>

                    <h4 className="text-sm sm:text-base font-bold text-ink group-hover:text-accent transition-colors line-clamp-1">
                      {movie.title}
                    </h4>

                    <div className="flex items-center gap-2 text-xs text-ink-muted flex-wrap">
                      {movie.year && <span>{movie.year}</span>}
                      {movie.year && <span>•</span>}
                      <span className="flex items-center gap-1 text-ink-muted">
                        <Clock className="h-3 w-3 text-ink-muted" />
                        {formatRelativeTime(movie.watchedAt)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-[10px] font-mono text-ink-subtle pt-0.5">
                      {movie.tmdbId && <span>TMDb: {movie.tmdbId}</span>}
                      {movie.tmdbId && movie.imdbId && <span>•</span>}
                      {movie.imdbId && <span>IMDb: {movie.imdbId}</span>}
                    </div>
                  </div>

                  {/* External Links */}
                  <div className="flex items-center gap-3 pt-1 border-t border-edge text-xs">
                    {movie.letterboxdUrl && (
                      <a
                        href={movie.letterboxdUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-success hover:text-success font-semibold"
                      >
                        <LetterboxdLogo size={12} className="text-[#00E054]" />
                        <span>Letterboxd</span>
                        <ArrowUpRight className="h-3 w-3" />
                      </a>
                    )}

                    {movie.url && (
                      <a
                        href={movie.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-danger hover:text-danger font-semibold"
                      >
                        <TraktLogo size={12} className="text-[#ED1C24]" />
                        <span>Trakt.tv</span>
                        <ArrowUpRight className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Engine Architecture & Diagnostics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
        {/* Metric 1: Schedule Cycle */}
        <div className="p-4 rounded-2xl bg-surface/90 border border-edge space-y-1">
          <p className="text-[10px] font-mono uppercase tracking-wider text-ink-muted">Sync Schedule</p>
          <p className="text-xl font-black text-ink">Every 15 Minutes</p>
          <p className="text-[11px] text-accent font-mono">cron: &apos;*/15 * * * *&apos;</p>
        </div>

        {/* Metric 2: Last Execution Duration */}
        <div className="p-4 rounded-2xl bg-surface/90 border border-edge space-y-1">
          <p className="text-[10px] font-mono uppercase tracking-wider text-ink-muted">Last Run Duration</p>
          <p className="text-xl font-black text-success">
            {formatDuration(data?.daemon?.lastDurationSeconds)}
          </p>
          <p className="text-[11px] text-ink-muted">
            {data?.latestRun ? formatRelativeTime(data.latestRun.updatedAt) : "Never"}
          </p>
        </div>

        {/* Metric 3: Total Runs Completed */}
        <div className="p-4 rounded-2xl bg-surface/90 border border-edge space-y-1">
          <p className="text-[10px] font-mono uppercase tracking-wider text-ink-muted">Total Cloud Runs</p>
          <p className="text-xl font-black text-accent">{data?.totalRuns || "--"}</p>
          <p className="text-[11px] text-ink-muted">Recorded on GitHub Actions</p>
        </div>

        {/* Metric 4: Auto-Refresh Status */}
        <div className="p-4 rounded-2xl bg-surface/90 border border-edge space-y-1 flex flex-col justify-between">
          <p className="text-[10px] font-mono uppercase tracking-wider text-ink-muted">Telemetry Live Polling</p>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-ink">
              {autoRefresh ? "Enabled (15s)" : "Paused"}
            </span>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                autoRefresh
                  ? "bg-success/20 text-success border border-success/30"
                  : "bg-elevated text-ink-muted border border-edge"
              }`}
            >
              {autoRefresh ? "Pause" : "Resume"}
            </button>
          </div>
          <p className="text-[10px] text-ink-subtle">Syncs live state with GitHub</p>
        </div>
      </div>

      {/* GitHub Workflow Runs History */}
      <div className="p-5 sm:p-6 rounded-2xl bg-surface/90 border border-edge shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-edge pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-accent" />
              <h3 className="text-sm sm:text-base font-bold text-ink tracking-tight">
                Live GitHub Actions Run History
              </h3>
            </div>
            <p className="text-xs text-ink-muted">
              Workflow: <code className="text-ink-muted font-mono">letterboxd-sync.yml</code> on{" "}
              <code className="text-ink-muted font-mono">s-afrid/trakt-sync-engine</code>
            </p>
          </div>

          <a
            href="https://github.com/s-afrid/trakt-sync-engine/actions/workflows/letterboxd-sync.yml"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-elevated/80 hover:bg-raised border border-edge text-xs font-semibold text-ink-muted transition-colors shrink-0"
          >
            <span>Open in GitHub</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        {loading ? (
          <div className="p-8 text-center space-y-2">
            <RefreshCw className="h-6 w-6 text-accent animate-spin mx-auto" />
            <p className="text-xs text-ink-muted">Loading GitHub Actions runs...</p>
          </div>
        ) : !data?.runs || data.runs.length === 0 ? (
          <div className="p-8 text-center space-y-2 text-ink-muted text-xs">
            <Bot className="h-8 w-8 text-ink-subtle mx-auto" />
            <p>No workflow runs recorded yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-edge overflow-x-auto">
            {data.runs.map((run) => {
              const isRunActive = run.status === "in_progress" || run.status === "queued";
              const isRunSuccess = run.conclusion === "success";
              const isRunFailure = run.conclusion === "failure" || run.conclusion === "timed_out";

              return (
                <div
                  key={run.id}
                  className="py-3 sm:py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-ink/5 px-2 rounded-xl transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Status Badge Icon */}
                    <div
                      className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 border ${
                        isRunActive
                          ? "bg-success/15 border-success/40 text-success"
                          : isRunSuccess
                          ? "bg-success/10 border-success/30 text-success"
                          : isRunFailure
                          ? "bg-danger/10 border-danger/30 text-danger"
                          : "bg-elevated border-edge text-ink-muted"
                      }`}
                    >
                      {isRunActive ? (
                        <RefreshCw className="h-4 w-4 animate-spin text-success" />
                      ) : isRunSuccess ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : isRunFailure ? (
                        <AlertCircle className="h-4 w-4 text-danger" />
                      ) : (
                        <Moon className="h-4 w-4 text-ink-muted" />
                      )}
                    </div>

                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-ink">
                          Run #{run.runNumber}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            run.event === "schedule"
                              ? "bg-accent/15 border-accent/30 text-accent"
                              : "bg-accent/15 border-accent/30 text-accent"
                          }`}
                        >
                          {run.event === "schedule" ? "Scheduled (15-min)" : "Manual Trigger"}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isRunActive
                              ? "bg-success/20 text-success border border-success/30 animate-pulse"
                              : isRunSuccess
                              ? "bg-success/10 text-success border border-success/30"
                              : "bg-danger/10 text-danger border border-danger/30"
                          }`}
                        >
                          {isRunActive ? "In Progress" : run.conclusion || run.status}
                        </span>
                      </div>

                      {run.commitMessage && (
                        <p className="text-xs text-ink-muted line-clamp-1">
                          {run.commitMessage}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-ink-muted shrink-0 justify-between sm:justify-end">
                    <div className="text-right">
                      <span className="font-mono text-ink-muted block">
                        {formatDuration(run.durationSeconds)}
                      </span>
                      <span className="text-[11px] text-ink-subtle">
                        {formatRelativeTime(run.createdAt)}
                      </span>
                    </div>

                    <a
                      href={run.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg bg-ink/10 hover:bg-ink/5 text-ink-muted hover:text-ink transition-colors"
                      title="View Run on GitHub"
                    >
                      <ArrowUpRight className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4-Pillar Architecture Contract Card */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-surface/60 via-surface to-surface/60 border border-edge space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-success" />
          <h4 className="text-xs sm:text-sm font-bold text-ink tracking-wide uppercase font-mono">
            How GitHub Actions Stays In Sleep (4-Pillar Verification Contract)
          </h4>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs text-ink-muted">
          <div className="p-3 rounded-xl bg-canvas/40 border border-edge space-y-1">
            <span className="font-bold text-ink block">1. 15-Minute Cycle</span>
            <p className="text-[11px] leading-relaxed">
              Cron executes every 15 minutes automatically in GitHub’s cloud with zero infrastructure cost.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-canvas/40 border border-edge space-y-1">
            <span className="font-bold text-ink block">2. Quiet Sleep (0% CPU)</span>
            <p className="text-[11px] leading-relaxed">
              If no new movies or episodes were watched since last cycle, the runner terminates silently in ~30s.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-canvas/40 border border-edge space-y-1">
            <span className="font-bold text-ink block">3. Automated MAL Sync</span>
            <p className="text-[11px] leading-relaxed">
              Any episode or finale watched on Trakt automatically increments count and marks series completed on MAL.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-canvas/40 border border-edge space-y-1">
            <span className="font-bold text-ink block">4. Letterboxd Auto-Import</span>
            <p className="text-[11px] leading-relaxed">
              When a movie is watched, Playwright imports the verified CSV and removes it from your Letterboxd watchlist.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
