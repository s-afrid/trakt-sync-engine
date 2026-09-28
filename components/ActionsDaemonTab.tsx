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
            ? "bg-gradient-to-r from-emerald-950/60 via-blue-950/40 to-[#0D111A] border-emerald-500/40 shadow-emerald-950/30"
            : isFailed
            ? "bg-gradient-to-r from-red-950/50 via-slate-900/60 to-[#0D111A] border-red-500/40 shadow-red-950/30"
            : "bg-gradient-to-r from-blue-950/40 via-indigo-950/30 to-[#0D111A] border-blue-500/30 shadow-indigo-950/20"
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          {/* Status Indicator & Description */}
          <div className="flex items-start gap-4 min-w-0">
            <div
              className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 border mt-0.5 ${
                isRunning
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                  : isFailed
                  ? "bg-red-500/15 border-red-500/40 text-red-400"
                  : "bg-blue-500/15 border-blue-500/30 text-blue-400"
              }`}
            >
              {isRunning ? (
                <RefreshCw className="h-6 w-6 animate-spin text-emerald-400" />
              ) : isFailed ? (
                <AlertCircle className="h-6 w-6 text-red-400" />
              ) : (
                <Moon className="h-6 w-6 text-blue-400" />
              )}
            </div>

            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
                  GitHub Actions Daemon Status
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border shadow-sm ${
                    isRunning
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                      : isFailed
                      ? "bg-red-500/20 text-red-300 border-red-500/40"
                      : "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isRunning
                        ? "bg-emerald-400 animate-ping"
                        : isFailed
                        ? "bg-red-400"
                        : "bg-indigo-400 animate-pulse"
                    }`}
                  />
                  {isRunning
                    ? "🟢 RUNNING • ACTIVE CLOUD SYNC"
                    : isFailed
                    ? "🔴 FAILED • REQUIRES REVIEW"
                    : "💤 IN SLEEP • QUIET MODE (0% CPU)"}
                </span>
              </div>

              <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
                {isRunning
                  ? "GitHub Actions Cloud Runner is Active"
                  : isFailed
                  ? "Last GitHub Sync Run Failed"
                  : "Daemon is Sleeping Quietly"}
              </h2>

              <p className="text-xs text-slate-300/90 leading-relaxed max-w-2xl">
                {data?.daemon?.description ||
                  "Checks Trakt scrobbles every 15 minutes. Automatically updates Letterboxd and MyAnimeList only when new watches occur."}
              </p>
            </div>
          </div>

          {/* Real-time Ticker & Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-white/[0.06]">
            {/* Live Countdown Box */}
            <div className="px-4 py-2.5 rounded-xl bg-black/50 border border-white/[0.08] flex items-center justify-between sm:justify-start gap-3">
              <div className="space-y-0.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
                  Next 15-Min Check In
                </span>
                <span className="text-base sm:text-lg font-mono font-bold text-white flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-blue-400 shrink-0" />
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
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition-all shadow-sm"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-blue-400" : ""}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>

              <button
                onClick={handleManualTrigger}
                disabled={dispatchLoading}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-xs font-bold text-white shadow-md border border-white/10 transition-all"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Run Job Now</span>
              </button>
            </div>
          </div>
        </div>

        {dispatchMessage && (
          <div className="mt-3 p-2.5 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-xs text-emerald-300">
            {dispatchMessage}
          </div>
        )}
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-200 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div className="text-sm flex-1">
            <p className="font-semibold">GitHub Actions telemetry unavailable</p>
            <p className="text-red-300/90 mt-0.5">{error}</p>
          </div>
          <button onClick={() => fetchStatus(true)} className="text-xs text-red-400 hover:text-red-200 underline">
            Retry
          </button>
        </div>
      )}

      {/* SPOTLIGHT SECTION: Last 2 Movies Updated Every Time App Runs */}
      <div className="p-5 sm:p-6 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Film className="h-4 w-4 text-red-400" />
              <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
                Last 2 Movies Updated Every Time App Runs
              </h3>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-500/20 text-red-300 border border-red-500/30">
                Verified Scrobbles
              </span>
            </div>
            <p className="text-xs text-slate-400">
              The latest 2 movies detected and synchronized between Trakt history and Letterboxd.
            </p>
          </div>

          <span className="text-[11px] font-mono text-slate-500">
            Auto-diffed on each 15-min cycle
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center space-y-2">
            <RefreshCw className="h-6 w-6 text-blue-400 animate-spin mx-auto" />
            <p className="text-xs text-slate-400">Fetching latest synchronized movies...</p>
          </div>
        ) : !data?.lastUpdatedMovies || data.lastUpdatedMovies.length === 0 ? (
          <div className="p-8 text-center space-y-2 text-slate-400 text-xs">
            <Film className="h-8 w-8 text-slate-600 mx-auto" />
            <p>No recently watched movies found in Trakt history.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.lastUpdatedMovies.map((movie, idx) => (
              <div
                key={`${movie.title}-${idx}`}
                className="group relative p-4 rounded-xl bg-black/40 hover:bg-[#111726] border border-white/[0.06] hover:border-slate-600/80 transition-all flex gap-4 shadow-sm"
              >
                {/* Ranking Pill */}
                <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-[10px] font-mono text-slate-400 font-bold">
                  #{idx + 1} Latest
                </div>

                {/* Movie Poster */}
                <MoviePoster
                  src={movie.posterUrl}
                  title={movie.title}
                  year={movie.year}
                  platform="letterboxd"
                  type="movie"
                  className="w-16 sm:w-20 rounded-xl shadow-md border border-white/[0.08] shrink-0"
                />

                {/* Metadata & Actions */}
                <div className="min-w-0 flex-1 flex flex-col justify-between space-y-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-500/15 border border-red-500/30 text-red-300">
                        <TraktLogo size={11} className="text-[#ED1C24]" />
                        <span>Trakt Logged</span>
                      </span>

                      {movie.isLetterboxdConfirmed ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#00E054]/15 border border-[#00E054]/30 text-[#00E054]">
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          <span>Letterboxd Confirmed</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-blue-500/15 border border-blue-500/30 text-blue-300">
                          <Clock className="h-2.5 w-2.5" />
                          <span>Synced in State</span>
                        </span>
                      )}
                    </div>

                    <h4 className="text-sm sm:text-base font-bold text-white group-hover:text-blue-300 transition-colors line-clamp-1">
                      {movie.title}
                    </h4>

                    <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                      {movie.year && <span>{movie.year}</span>}
                      {movie.year && <span>•</span>}
                      <span className="flex items-center gap-1 text-slate-300">
                        <Clock className="h-3 w-3 text-slate-400" />
                        {formatRelativeTime(movie.watchedAt)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500 pt-0.5">
                      {movie.tmdbId && <span>TMDb: {movie.tmdbId}</span>}
                      {movie.tmdbId && movie.imdbId && <span>•</span>}
                      {movie.imdbId && <span>IMDb: {movie.imdbId}</span>}
                    </div>
                  </div>

                  {/* External Links */}
                  <div className="flex items-center gap-3 pt-1 border-t border-white/[0.04] text-xs">
                    {movie.letterboxdUrl && (
                      <a
                        href={movie.letterboxdUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-semibold"
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
                        className="inline-flex items-center gap-1 text-red-400 hover:text-red-300 font-semibold"
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
        <div className="p-4 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] space-y-1">
          <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Sync Schedule</p>
          <p className="text-xl font-black text-white">Every 15 Minutes</p>
          <p className="text-[11px] text-blue-400 font-mono">cron: &apos;*/15 * * * *&apos;</p>
        </div>

        {/* Metric 2: Last Execution Duration */}
        <div className="p-4 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] space-y-1">
          <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Last Run Duration</p>
          <p className="text-xl font-black text-emerald-400">
            {formatDuration(data?.daemon?.lastDurationSeconds)}
          </p>
          <p className="text-[11px] text-slate-400">
            {data?.latestRun ? formatRelativeTime(data.latestRun.updatedAt) : "Never"}
          </p>
        </div>

        {/* Metric 3: Total Runs Completed */}
        <div className="p-4 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] space-y-1">
          <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Total Cloud Runs</p>
          <p className="text-xl font-black text-indigo-400">{data?.totalRuns || "--"}</p>
          <p className="text-[11px] text-slate-400">Recorded on GitHub Actions</p>
        </div>

        {/* Metric 4: Auto-Refresh Status */}
        <div className="p-4 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] space-y-1 flex flex-col justify-between">
          <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Telemetry Live Polling</p>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-white">
              {autoRefresh ? "Enabled (15s)" : "Paused"}
            </span>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                autoRefresh
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "bg-slate-800 text-slate-400 border border-slate-700"
              }`}
            >
              {autoRefresh ? "Pause" : "Resume"}
            </button>
          </div>
          <p className="text-[10px] text-slate-500">Syncs live state with GitHub</p>
        </div>
      </div>

      {/* GitHub Workflow Runs History */}
      <div className="p-5 sm:p-6 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-indigo-400" />
              <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
                Live GitHub Actions Run History
              </h3>
            </div>
            <p className="text-xs text-slate-400">
              Workflow: <code className="text-slate-300 font-mono">letterboxd-sync.yml</code> on{" "}
              <code className="text-slate-300 font-mono">s-afrid/trakt-sync-engine</code>
            </p>
          </div>

          <a
            href="https://github.com/s-afrid/trakt-sync-engine/actions/workflows/letterboxd-sync.yml"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-300 transition-colors shrink-0"
          >
            <span>Open in GitHub</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        {loading ? (
          <div className="p-8 text-center space-y-2">
            <RefreshCw className="h-6 w-6 text-blue-400 animate-spin mx-auto" />
            <p className="text-xs text-slate-400">Loading GitHub Actions runs...</p>
          </div>
        ) : !data?.runs || data.runs.length === 0 ? (
          <div className="p-8 text-center space-y-2 text-slate-400 text-xs">
            <Bot className="h-8 w-8 text-slate-600 mx-auto" />
            <p>No workflow runs recorded yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04] overflow-x-auto">
            {data.runs.map((run) => {
              const isRunActive = run.status === "in_progress" || run.status === "queued";
              const isRunSuccess = run.conclusion === "success";
              const isRunFailure = run.conclusion === "failure" || run.conclusion === "timed_out";

              return (
                <div
                  key={run.id}
                  className="py-3 sm:py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.02] px-2 rounded-xl transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Status Badge Icon */}
                    <div
                      className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 border ${
                        isRunActive
                          ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                          : isRunSuccess
                          ? "bg-emerald-950/50 border-emerald-800/40 text-emerald-400"
                          : isRunFailure
                          ? "bg-red-950/50 border-red-800/40 text-red-400"
                          : "bg-slate-800 border-slate-700 text-slate-400"
                      }`}
                    >
                      {isRunActive ? (
                        <RefreshCw className="h-4 w-4 animate-spin text-emerald-400" />
                      ) : isRunSuccess ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : isRunFailure ? (
                        <AlertCircle className="h-4 w-4 text-red-400" />
                      ) : (
                        <Moon className="h-4 w-4 text-slate-400" />
                      )}
                    </div>

                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-white">
                          Run #{run.runNumber}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            run.event === "schedule"
                              ? "bg-blue-500/15 border-blue-500/30 text-blue-300"
                              : "bg-purple-500/15 border-purple-500/30 text-purple-300"
                          }`}
                        >
                          {run.event === "schedule" ? "Scheduled (15-min)" : "Manual Trigger"}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isRunActive
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse"
                              : isRunSuccess
                              ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/30"
                              : "bg-red-950/60 text-red-400 border border-red-800/30"
                          }`}
                        >
                          {isRunActive ? "In Progress" : run.conclusion || run.status}
                        </span>
                      </div>

                      {run.commitMessage && (
                        <p className="text-xs text-slate-400 line-clamp-1">
                          {run.commitMessage}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-slate-400 shrink-0 justify-between sm:justify-end">
                    <div className="text-right">
                      <span className="font-mono text-slate-300 block">
                        {formatDuration(run.durationSeconds)}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {formatRelativeTime(run.createdAt)}
                      </span>
                    </div>

                    <a
                      href={run.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white transition-colors"
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
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900/60 via-[#0D111A] to-slate-900/60 border border-white/[0.08] space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <h4 className="text-xs sm:text-sm font-bold text-white tracking-wide uppercase font-mono">
            How GitHub Actions Stays In Sleep (4-Pillar Verification Contract)
          </h4>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs text-slate-400">
          <div className="p-3 rounded-xl bg-black/40 border border-white/[0.04] space-y-1">
            <span className="font-bold text-slate-200 block">1. 15-Minute Cycle</span>
            <p className="text-[11px] leading-relaxed">
              Cron executes every 15 minutes automatically in GitHub’s cloud with zero infrastructure cost.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-black/40 border border-white/[0.04] space-y-1">
            <span className="font-bold text-slate-200 block">2. Quiet Sleep (0% CPU)</span>
            <p className="text-[11px] leading-relaxed">
              If no new movies or episodes were watched since last cycle, the runner terminates silently in ~30s.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-black/40 border border-white/[0.04] space-y-1">
            <span className="font-bold text-slate-200 block">3. Automated MAL Sync</span>
            <p className="text-[11px] leading-relaxed">
              Any episode or finale watched on Trakt automatically increments count and marks series completed on MAL.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-black/40 border border-white/[0.04] space-y-1">
            <span className="font-bold text-slate-200 block">4. Letterboxd Auto-Import</span>
            <p className="text-[11px] leading-relaxed">
              When a movie is watched, Playwright imports the verified CSV and removes it from your Letterboxd watchlist.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
