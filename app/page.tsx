"use client";

import React, { useState, useEffect } from "react";
import {
  Film,
  Tv,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Settings,
  Layers,
  Sparkles,
  ArrowRight,
  Database,
  Calendar,
  Bot,
  Lock,
  Play,
  X,
  Terminal,
  Copy,
  Check,
  Clock,
  Trash2,
  Key,
  Bookmark,
  PlayCircle,
} from "lucide-react";
import { TraktLogo, MalLogo, LetterboxdLogo, HarborMark } from "@/components/icons";
import Activity24hTab from "@/components/Activity24hTab";
import LetterboxdSessionModal from "@/components/LetterboxdSessionModal";
import WatchlistTab from "@/components/WatchlistTab";
import ContinueWatchingTab from "@/components/ContinueWatchingTab";

interface SyncStatus {
  connected: {
    trakt: boolean;
    mal: boolean;
    letterboxd: boolean;
  };
  profiles: {
    trakt: { username: string; name?: string; avatar?: string } | null;
    mal: { id: number; name: string; picture?: string } | null;
    letterboxd: { username: string; displayName?: string; avatar?: string } | null;
  };
  envConfigured: {
    trakt: boolean;
    mal: boolean;
    database: boolean;
  };
}

interface SyncRunResult {
  anime?: {
    totalTraktShows: number;
    animeIdentified: number;
    malMatchesFound: number;
    malUpdatedCount: number;
    errors: string[];
    updatedTitles: { title: string; episodes: number; status: string }[];
  };
  letterboxd?: {
    rssItemsFetched: number;
    moviesSyncedToTrakt: number;
    syncedTitles: string[];
    errors: string[];
  };
  traktToLetterboxd?: {
    configured?: boolean;
    message?: string;
    newMoviesFound?: number;
    alreadySynced?: number;
    markedWatched?: number;
    removedFromWatchlist?: number;
    skipped?: number;
    errors?: string[];
    syncedTitles?: string[];
  };
  timestamp: string;
}

interface GitHubRunStatus {
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

export default function Dashboard() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncResult, setSyncResult] = useState<SyncRunResult | null>(null);
  const [githubRun, setGithubRun] = useState<GitHubRunStatus | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Letterboxd input
  const [lbUsername, setLbUsername] = useState<string>("");
  const [lbAvatarUrl, setLbAvatarUrl] = useState<string>("");
  const [lbSaving, setLbSaving] = useState<boolean>(false);
  const [showLbInput, setShowLbInput] = useState<boolean>(false);

  // Trakt direct username input
  const [traktUsernameInput, setTraktUsernameInput] = useState<string>("");
  const [traktSaving, setTraktSaving] = useState<boolean>(false);
  const [showTraktInput, setShowTraktInput] = useState<boolean>(false);

  // Playwright automated import state
  const [showAutoImportModal, setShowAutoImportModal] = useState<boolean>(false);
  const [autoImportType, setAutoImportType] = useState<"watched" | "ratings">("watched");
  const [autoImportPassword, setAutoImportPassword] = useState<string>("");
  const [autoImportAutoConfirm, setAutoImportAutoConfirm] = useState<boolean>(false);
  const [autoImportRecurring, setAutoImportRecurring] = useState<boolean>(false);
  const [autoImportHeadless, setAutoImportHeadless] = useState<boolean>(false);
  const [autoImportLoading, setAutoImportLoading] = useState<boolean>(false);
  const [autoImportMessage, setAutoImportMessage] = useState<string | null>(null);
  const [autoImportError, setAutoImportError] = useState<string | null>(null);
  const [isCloudHost, setIsCloudHost] = useState<boolean>(false);
  const [copiedDaemon, setCopiedDaemon] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "activity24h" | "watchlist" | "continueWatching"
  >("dashboard");
  const [isActivityTabDeleted, setIsActivityTabDeleted] = useState<boolean>(false);
  const [showSessionModal, setShowSessionModal] = useState<boolean>(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/sync/status");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (data.profiles?.letterboxd?.username) {
          setLbUsername(data.profiles.letterboxd.username);
        }
        if (data.profiles?.letterboxd?.avatar) {
          setLbAvatarUrl(data.profiles.letterboxd.avatar);
        }
        if (data.profiles?.trakt?.username) {
          setTraktUsernameInput(data.profiles.trakt.username);
        }
      }
    } catch (e) {
      console.error("Failed to load status:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Parse URL query params for errors or success
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const err = params.get("error");
      if (err) setErrorMsg(decodeURIComponent(err));

      const isLocal =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname.endsWith(".local");
      setIsCloudHost(!isLocal);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const refreshRun = async () => {
      try {
        const res = await fetch("/api/github/actions", { cache: "no-store" });
        const data = await res.json();
        if (active && data.latestRun) {
          setGithubRun(data.latestRun);
        }
      } catch (error) {
        console.error("Failed to load GitHub Actions run:", error);
      }
    };
    refreshRun();
    const timer = window.setInterval(refreshRun, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const handleCopyDaemon = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText("npm run schedule:letterboxd -- --headless");
      setCopiedDaemon(true);
      setTimeout(() => setCopiedDaemon(false), 2500);
    }
  };

  const handleSaveLetterboxd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lbUsername.trim()) return;

    setLbSaving(true);
    try {
      const res = await fetch("/api/auth/letterboxd/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: lbUsername,
          avatarUrl: lbAvatarUrl,
        }),
      });
      if (res.ok) {
        await fetchStatus();
        setShowLbInput(false);
      } else {
        const err = await res.json();
        setErrorMsg(err.error || "Failed to save Letterboxd username");
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLbSaving(false);
    }
  };

  const handleSaveTraktUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!traktUsernameInput.trim()) return;

    setTraktSaving(true);
    try {
      const res = await fetch("/api/auth/trakt/username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: traktUsernameInput }),
      });
      if (res.ok) {
        await fetchStatus();
        setShowTraktInput(false);
      } else {
        const err = await res.json();
        setErrorMsg(err.error || "Failed to save Trakt username");
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setTraktSaving(false);
    }
  };

  const handleTriggerSync = async () => {
    setSyncing(true);
    setErrorMsg(null);
    setSyncResult(null);

    try {
      const res = await fetch("/api/sync/trigger", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Failed to run the sync engine");
      } else {
        setSyncResult({
          ...data.results,
          timestamp: data.results?.timestamp || new Date().toISOString(),
        });
        await fetchStatus();
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  };

  const handleTriggerAutoImport = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAutoImportLoading(true);
    setAutoImportError(null);
    setAutoImportMessage(null);

    try {
      const res = await fetch("/api/export/letterboxd/auto-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: autoImportType,
          username: lbUsername || status?.profiles?.letterboxd?.username,
          password: autoImportPassword,
          autoConfirm: autoImportAutoConfirm || autoImportRecurring,
          interval: autoImportRecurring ? 15 : undefined,
          headless: autoImportHeadless,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAutoImportError(data.error || "Failed to start automation");
      } else {
        setAutoImportMessage(data.message || "Browser automation started successfully!");
      }
    } catch (err: unknown) {
      setAutoImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutoImportLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-ink py-6 sm:py-10 px-3 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8">
        {/* Header — Harbor lockup + telemetry */}
        <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-edge gap-4">
          <div>
            <div className="flex items-center gap-3.5">
              <HarborMark
                size={40}
                className="text-accent animate-harbor-bob shrink-0 drop-shadow-[0_8px_22px_rgb(244_162_92_/_0.28)]"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="harbor-wordmark text-2xl sm:text-3xl font-semibold tracking-tight text-ink leading-none">
                    Harbor
                  </h1>
                  <span className="hidden sm:inline h-1 w-1 rounded-full bg-ink-subtle" />
                  <span className="text-xs sm:text-sm font-medium text-ink-muted">
                    Trakt Sync Engine
                  </span>
                  <span className="harbor-chip harbor-chip-success normal-case tracking-normal shrink-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                    Live 15-Min Daemon
                  </span>
                </div>
                <p className="text-xs text-ink-muted mt-1.5 leading-relaxed">
                  Autonomous 3-way synchronization across Trakt.tv, MyAnimeList, and Letterboxd.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            <button
              onClick={handleTriggerSync}
              disabled={syncing || !status?.connected?.trakt}
              className={`w-full md:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs tracking-wider uppercase transition-all ${
                syncing
                  ? "bg-elevated text-ink-muted cursor-not-allowed border border-edge"
                  : !status?.connected?.trakt
                  ? "bg-surface text-ink-subtle cursor-not-allowed border border-edge"
                  : "bg-accent text-canvas hover:bg-accent/85 border border-accent/40 shadow-lg shadow-accent/20"
              }`}
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Running Engine..." : "Trigger Sync Engine"}
            </button>
          </div>
        </div>

        {githubRun && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-edge bg-surface px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-semibold text-ink">GitHub Actions sync: {githubRun.status === "completed" ? githubRun.conclusion || "completed" : githubRun.status}</p>
              <p className="text-xs text-ink-muted">Started {new Date(githubRun.createdAt).toLocaleString()} · Detailed sync results appear in the 24h Updates activity log.</p>
            </div>
            <a href={githubRun.htmlUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-accent hover:underline shrink-0">
              View run output <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        )}

        {/* Navigation Tabs - Haulix Obsidian Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-edge pb-3">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none py-0.5">
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`shrink-0 flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                activeTab === "dashboard"
                  ? "bg-elevated text-ink border border-accent/40 shadow-sm"
                  : "text-ink-muted hover:text-ink hover:bg-ink/5"
              }`}
            >
              <Layers className="h-4 w-4 text-accent" />
              <span>Dashboard</span>
            </button>

            <button
              onClick={() => setActiveTab("watchlist")}
              className={`shrink-0 flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                activeTab === "watchlist"
                  ? "bg-elevated text-ink border border-accent/40 shadow-sm"
                  : "text-ink-muted hover:text-ink hover:bg-ink/5"
              }`}
            >
              <Bookmark className="h-4 w-4 text-accent" />
              <span>Watchlist</span>
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-accent/20 text-accent border border-accent/30">
                3-Way
              </span>
            </button>

            <button
              onClick={() => setActiveTab("continueWatching")}
              className={`shrink-0 flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                activeTab === "continueWatching"
                  ? "bg-elevated text-ink border border-success/40 shadow-sm"
                  : "text-ink-muted hover:text-ink hover:bg-ink/5"
              }`}
            >
              <PlayCircle className="h-4 w-4 text-success" />
              <span>Continue Watching</span>
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-success/20 text-success border border-success/30">
                Active
              </span>
            </button>

            {!isActivityTabDeleted ? (
              <button
                onClick={() => setActiveTab("activity24h")}
                className={`shrink-0 flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                  activeTab === "activity24h"
                    ? "bg-elevated text-ink border border-accent/40 shadow-sm"
                    : "text-ink-muted hover:text-ink hover:bg-ink/5"
                }`}
              >
                <Clock className="h-4 w-4 text-danger" />
                <span>24h Updates <span className="hidden sm:inline">& Posters</span></span>
                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-danger/20 text-danger border border-danger/30">
                  Live Log
                </span>
              </button>
            ) : (
              <button
                onClick={() => {
                  setIsActivityTabDeleted(false);
                  setActiveTab("activity24h");
                }}
                className="shrink-0 text-xs text-ink-subtle hover:text-accent px-3 py-1.5 flex items-center gap-1.5 transition-colors font-medium"
                title="Restore the 24h activity tab"
              >
                <span>+ Restore 24h Updates Tab</span>
              </button>
            )}
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2">
            {!isActivityTabDeleted && activeTab === "activity24h" && (
              <button
                onClick={() => {
                  setIsActivityTabDeleted(true);
                  setActiveTab("dashboard");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-edge hover:border-danger/20 bg-danger/10 text-xs text-ink-muted hover:text-danger transition-colors font-medium"
                title="Dismiss or delete this inspection tab"
              >
                <Trash2 className="h-3.5 w-3.5 text-danger" />
                <span>Delete Tab</span>
              </button>
            )}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-semibold bg-success/10 text-success border border-success/30 font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              Daily Vercel Sync
            </span>
          </div>
        </div>

        {activeTab === "watchlist" ? (
          <WatchlistTab />
        ) : activeTab === "continueWatching" ? (
          <ContinueWatchingTab />
        ) : activeTab === "activity24h" && !isActivityTabDeleted ? (
          <Activity24hTab
            onDeleteTab={() => {
              setIsActivityTabDeleted(true);
              setActiveTab("dashboard");
            }}
          />
        ) : (
          <>
            {/* Global Error Banner */}
        {errorMsg && (
          <div className="p-4 rounded-xl bg-danger/10 border border-danger/30 text-ink flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-danger shrink-0 mt-0.5" />
            <div className="text-sm flex-1">
              <p className="font-semibold">Notice</p>
              <p className="text-danger/90 mt-0.5">{errorMsg}</p>
            </div>
            <button
              onClick={() => setErrorMsg(null)}
              className="text-xs text-danger hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Environment / Credentials Check Alert */}
        {status && (!status.envConfigured.trakt || !status.envConfigured.mal) && (
          <div className="p-4 rounded-xl bg-accent/10 border border-accent/30 text-ink flex items-start gap-3">
            <Settings className="h-5 w-5 text-accent shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold">Setup Credentials in .env</p>
              <p className="text-accent/80 mt-0.5">
                Missing API keys:{" "}
                {[
                  !status.envConfigured.trakt && "TRAKT_CLIENT_ID / SECRET",
                  !status.envConfigured.mal && "MAL_CLIENT_ID / SECRET",
                ]
                  .filter(Boolean)
                  .join(", ")}
                . Copy <code className="bg-accent/10 px-1 py-0.5 rounded text-accent">.env.example</code> to <code className="bg-accent/10 px-1 py-0.5 rounded text-accent">.env</code> and fill in your developer keys.
              </p>
            </div>
          </div>
        )}

        {/* 3 Main Connection Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* 1. Trakt Card */}
          <div className="p-5 sm:p-6 rounded-2xl bg-surface/90 border border-edge border-t-2 border-t-[#ED1C24] hover:border-ink-subtle/40 transition-all shadow-sm hover:shadow-xl hover:shadow-black/40 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-danger/10 flex items-center justify-center border border-danger/20">
                    <TraktLogo size={18} className="text-[#ED1C24]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-ink">Trakt.tv</h3>
                    <p className="text-xs text-ink-muted">Primary Source</p>
                  </div>
                </div>
                {status?.connected?.trakt ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-success/10 text-success border border-success/30">
                    <CheckCircle2 className="h-3 w-3" /> Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-elevated text-ink-muted">
                    Disconnected
                  </span>
                )}
              </div>

              {status?.connected?.trakt && status.profiles.trakt && !showTraktInput ? (
                <div className="p-3.5 rounded-xl bg-surface/60 border border-edge flex items-center gap-3.5">
                  <div className="relative shrink-0">
                    {status.profiles.trakt.avatar ? (
                      <img
                        src={`/api/proxy/image?url=${encodeURIComponent(status.profiles.trakt.avatar)}`}
                        alt={status.profiles.trakt.username}
                        referrerPolicy="no-referrer"
                        className="h-12 w-12 rounded-full border-2 border-danger/60 object-cover shadow-md"
                        onError={(e) => {
                          const target = e.currentTarget;
                          if (!target.dataset.fallback) {
                            target.dataset.fallback = "true";
                            target.src = status.profiles.trakt!.avatar!;
                          } else {
                            target.style.display = "none";
                          }
                        }}
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-full bg-danger/15 text-ink font-bold flex items-center justify-center border-2 border-danger/50 shadow-md">
                        {status.profiles.trakt.username[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-[#ED1C24] p-0.5 border-2 border-canvas flex items-center justify-center shadow">
                      <TraktLogo size={10} className="text-ink" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">
                      {status.profiles.trakt.name || status.profiles.trakt.username}
                    </p>
                    <p className="text-xs text-ink-muted truncate">
                      @{status.profiles.trakt.username}
                    </p>
                    <a
                      href={`https://trakt.tv/users/${status.profiles.trakt.username}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-danger hover:text-danger font-medium mt-0.5 transition-colors"
                    >
                      View Profile
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSaveTraktUsername} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-ink-muted mb-1">
                      Trakt Username
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. your_username"
                      value={traktUsernameInput}
                      onChange={(e) => setTraktUsernameInput(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-surface border border-edge text-sm text-ink placeholder-ink-subtle focus:outline-none focus:ring-1 focus:ring-danger"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={traktSaving || !traktUsernameInput.trim()}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold bg-danger hover:bg-danger/85 text-ink transition-colors disabled:opacity-50"
                    >
                      {traktSaving ? "Connecting..." : status?.connected?.trakt ? "Save Changes" : "Connect Trakt"}
                    </button>
                    {showTraktInput && (
                      <button
                        type="button"
                        onClick={() => setShowTraktInput(false)}
                        className="px-3 py-2.5 rounded-xl text-xs font-medium bg-elevated hover:bg-raised text-ink-muted transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>

            <div className="pt-4 border-t border-edge">
              {status?.connected?.trakt ? (
                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setTraktUsernameInput(status.profiles.trakt?.username || "");
                      setShowTraktInput(!showTraktInput);
                    }}
                    className="text-ink-muted hover:text-ink transition-colors"
                  >
                    {showTraktInput ? "Close Edit" : "Change Username"}
                  </button>
                  <a
                    href="/api/auth/trakt/authorize"
                    className="text-ink-subtle hover:text-ink-muted transition-colors"
                  >
                    Use OAuth
                  </a>
                </div>
              ) : (
                <div className="flex items-center justify-between text-[11px] text-ink-muted">
                  <span>Keeps cinejoy connected</span>
                  <a
                    href="/api/auth/trakt/authorize"
                    className="text-danger hover:text-danger transition-colors"
                  >
                    Use OAuth
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* 2. MyAnimeList Card */}
          <div className="p-5 sm:p-6 rounded-2xl bg-surface/90 border border-edge border-t-2 border-t-accent hover:border-ink-subtle/40 transition-all shadow-sm hover:shadow-xl hover:shadow-black/40 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-accent/10 flex items-center justify-center border border-accent/20">
                    <MalLogo size={18} className="text-[#2E51A2]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-ink">MyAnimeList</h3>
                    <p className="text-xs text-ink-muted">Anime Sync</p>
                  </div>
                </div>
                {status?.connected?.mal ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-success/10 text-success border border-success/30">
                    <CheckCircle2 className="h-3 w-3" /> Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-elevated text-ink-muted">
                    Disconnected
                  </span>
                )}
              </div>

              {status?.connected?.mal && status.profiles.mal ? (
                <div className="p-3.5 rounded-xl bg-surface/60 border border-edge flex items-center gap-3.5">
                  <div className="relative shrink-0">
                    {status.profiles.mal.picture ? (
                      <img
                        src={`/api/proxy/image?url=${encodeURIComponent(status.profiles.mal.picture)}`}
                        alt={status.profiles.mal.name}
                        referrerPolicy="no-referrer"
                        className="h-12 w-12 rounded-full border-2 border-accent/60 object-cover shadow-md"
                        onError={(e) => {
                          const target = e.currentTarget;
                          if (!target.dataset.fallback) {
                            target.dataset.fallback = "true";
                            target.src = status.profiles.mal!.picture!;
                          } else {
                            target.style.display = "none";
                          }
                        }}
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-full bg-accent/15 text-ink font-bold flex items-center justify-center border-2 border-accent/50 shadow-md">
                        {status.profiles.mal.name[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-[#2E51A2] p-0.5 border-2 border-canvas flex items-center justify-center shadow">
                      <MalLogo size={10} className="text-ink" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">
                      {status.profiles.mal.name}
                    </p>
                    <p className="text-xs text-ink-muted truncate">
                      MAL ID: #{status.profiles.mal.id}
                    </p>
                    <a
                      href={`https://myanimelist.net/profile/${status.profiles.mal.name}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-accent hover:text-accent font-medium mt-0.5 transition-colors"
                    >
                      View Profile
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-ink-muted leading-relaxed">
                  Connect your MAL profile via PKCE OAuth. Trakt watched anime progress will automatically update your MAL list.
                </p>
              )}
            </div>

            <div className="pt-6">
              {!status?.connected?.mal ? (
                <a
                  href="/api/auth/mal/authorize"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-accent hover:bg-accent/85 text-canvas transition-colors"
                >
                  Connect MAL
                  <ArrowRight className="h-4 w-4" />
                </a>
              ) : (
                <a
                  href="/api/auth/mal/authorize"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-elevated hover:bg-raised text-ink-muted transition-colors"
                >
                  Reconnect MAL
                </a>
              )}
            </div>
          </div>

          {/* 3. Letterboxd Card */}
          <div className="md:col-span-2 lg:col-span-1 p-5 sm:p-6 rounded-2xl bg-surface/90 border border-edge border-t-2 border-t-[#00E054] hover:border-ink-subtle/40 transition-all shadow-sm hover:shadow-xl hover:shadow-black/40 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-success/10 flex items-center justify-center border border-success/20">
                    <LetterboxdLogo size={20} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-ink">Letterboxd</h3>
                    <p className="text-xs text-ink-muted">CSV & RSS Sync</p>
                  </div>
                </div>
                {status?.connected?.letterboxd ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-success/10 text-success border border-success/30">
                    <CheckCircle2 className="h-3 w-3" /> Linked
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-elevated text-ink-muted">
                    Unlinked
                  </span>
                )}
              </div>

              {status?.connected?.letterboxd && status.profiles.letterboxd && !showLbInput ? (
                <div className="p-3.5 rounded-xl bg-surface/60 border border-edge flex items-center gap-3.5">
                  <div className="relative shrink-0">
                    {status.profiles.letterboxd.avatar ? (
                      <img
                        src={`/api/proxy/image?url=${encodeURIComponent(status.profiles.letterboxd.avatar)}`}
                        alt={status.profiles.letterboxd.username}
                        referrerPolicy="no-referrer"
                        className="h-12 w-12 rounded-full border-2 border-success/60 object-cover shadow-md"
                        onError={(e) => {
                          const target = e.currentTarget;
                          if (!target.dataset.fallback) {
                            target.dataset.fallback = "true";
                            target.src = status.profiles.letterboxd!.avatar!;
                          } else {
                            target.style.display = "none";
                          }
                        }}
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-full p-[2px] bg-gradient-to-tr from-[#FF8000] via-[#00E054] to-[#40BCF4] shadow-md flex items-center justify-center">
                        <div className="h-full w-full rounded-full bg-[#14181C] flex flex-col items-center justify-center">
                          <span className="text-ink font-bold text-xs leading-none">
                            {status.profiles.letterboxd.username[0]?.toUpperCase()}
                          </span>
                          <div className="flex gap-0.5 mt-0.5">
                            <span className="h-1 w-1 rounded-full bg-[#FF8000]" />
                            <span className="h-1 w-1 rounded-full bg-[#00E054]" />
                            <span className="h-1 w-1 rounded-full bg-[#40BCF4]" />
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-[#14181C] p-0.5 border-2 border-canvas flex items-center justify-center shadow">
                      <LetterboxdLogo size={10} />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">
                      {status.profiles.letterboxd.displayName || status.profiles.letterboxd.username}
                    </p>
                    <p className="text-xs text-ink-muted truncate">
                      @{status.profiles.letterboxd.username}
                    </p>
                    <a
                      href={`https://letterboxd.com/${status.profiles.letterboxd.username}/`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-success hover:text-success font-medium mt-0.5 transition-colors"
                    >
                      View Profile
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSaveLetterboxd} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-ink-muted mb-1">
                      Letterboxd Username
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. christopher_nolan"
                      value={lbUsername}
                      onChange={(e) => setLbUsername(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-surface border border-edge text-sm text-ink placeholder-ink-subtle focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-ink-muted">
                        Profile Photo URL (optional)
                      </label>
                      <div className="flex items-center gap-2 text-[10px]">
                        {status?.profiles?.trakt?.avatar && (
                          <button
                            type="button"
                            onClick={() => setLbAvatarUrl(status.profiles.trakt!.avatar!)}
                            className="text-danger hover:text-danger underline"
                          >
                            Use Trakt Photo
                          </button>
                        )}
                        {status?.profiles?.mal?.picture && (
                          <button
                            type="button"
                            onClick={() => setLbAvatarUrl(status.profiles.mal!.picture!)}
                            className="text-accent hover:text-accent underline"
                          >
                            Use MAL Photo
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="url"
                      placeholder="https://... (or right click avatar -> Copy Image Link)"
                      value={lbAvatarUrl}
                      onChange={(e) => setLbAvatarUrl(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-xl bg-surface border border-edge text-xs text-ink placeholder-ink-subtle focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={lbSaving || !lbUsername.trim()}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-success hover:bg-success/85 text-canvas transition-colors disabled:opacity-50"
                    >
                      {lbSaving ? "Saving..." : status?.connected?.letterboxd ? "Save Changes" : "Save Username"}
                    </button>
                    {showLbInput && (
                      <button
                        type="button"
                        onClick={() => setShowLbInput(false)}
                        className="px-3 py-2 rounded-xl text-xs font-medium bg-elevated hover:bg-raised text-ink-muted transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>

            <div className="pt-4 border-t border-edge">
              <div className="flex items-center justify-between text-xs">
                {status?.connected?.letterboxd ? (
                  <button
                    type="button"
                    onClick={() => {
                      setLbUsername(status.profiles.letterboxd?.username || "");
                      setLbAvatarUrl(status.profiles.letterboxd?.avatar || "");
                      setShowLbInput(!showLbInput);
                    }}
                    className="text-ink-muted hover:text-ink transition-colors"
                  >
                    {showLbInput ? "Close Edit" : "Edit Profile"}
                  </button>
                ) : (
                  <span className="text-[11px] text-ink-subtle">Unlinked Profile</span>
                )}

                <button
                  type="button"
                  onClick={() => setShowSessionModal(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-success/10 hover:bg-success/10 border border-success/30 text-[11px] font-medium text-success hover:text-ink transition-colors"
                  title="Update Letterboxd session via browser cookie extension"
                >
                  <Key className="h-3 w-3 text-success" />
                  <span>Session Cookies</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Letterboxd 1-Click CSV Export & Playwright Automation Deck */}
        <div className="p-4 sm:p-6 rounded-2xl bg-surface/95 border border-edge space-y-4 sm:space-y-5 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <LetterboxdLogo size={22} />
                <h2 className="text-base sm:text-lg font-semibold text-ink">
                  Letterboxd 1-Click Import Tool
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-success/10 text-success border border-success/30">
                  <Bot className="h-3 w-3" />
                  Playwright Enabled
                </span>
              </div>
              <p className="text-xs sm:text-sm text-ink-muted mt-1 max-w-2xl leading-relaxed">
                Because Letterboxd lacks a public open-write API, this engine formats your entire Trakt movie history into standard Letterboxd import CSV files (with verified TMDB & IMDb IDs) and can automate the browser upload via Playwright.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5 sm:gap-3 w-full lg:w-auto">
              <button
                type="button"
                onClick={() => {
                  setShowAutoImportModal(!showAutoImportModal);
                  setAutoImportError(null);
                  setAutoImportMessage(null);
                }}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium bg-success hover:bg-success/85 text-canvas transition-all shadow-lg shadow-success/10"
              >
                <Bot className="h-4 w-4" />
                {showAutoImportModal ? "Close Automation" : "Auto-Upload (Playwright)"}
              </button>
              <button
                type="button"
                onClick={() => setShowSessionModal(true)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium bg-elevated hover:bg-raised text-ink border border-edge transition-colors"
                title="Update Letterboxd session via browser cookie extension"
              >
                <Key className="h-4 w-4 text-success" />
                <span>Update Session</span>
              </button>
              <div className="grid grid-cols-2 sm:flex items-center gap-2.5 sm:gap-3 w-full sm:w-auto">
                <a
                  href="/api/export/letterboxd?type=watched"
                  download
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium bg-elevated hover:bg-raised text-ink border border-edge transition-colors text-center"
                >
                  <Download className="h-4 w-4 shrink-0" />
                  <span>Watched CSV</span>
                </a>
                <a
                  href="/api/export/letterboxd?type=ratings"
                  download
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium bg-elevated hover:bg-raised text-ink border border-edge transition-colors text-center"
                >
                  <Download className="h-4 w-4 shrink-0" />
                  <span>Ratings CSV</span>
                </a>
              </div>
              <a
                href="https://letterboxd.com/import/"
                target="_blank"
                rel="noreferrer"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-ink-muted hover:text-ink transition-colors"
              >
                <span>Open Importer</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          {/* Playwright Automation Interactive Drawer */}
          {showAutoImportModal && (
            <div className="p-4 sm:p-5 rounded-xl bg-surface/90 border border-success/20 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-edge">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-success/10 text-success border border-success/30">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-ink">
                      {isCloudHost
                        ? "15-Minute Background Automation Daemon"
                        : "Automated Browser Import (Playwright)"}
                    </h3>
                    <p className="text-xs text-ink-muted">
                      {isCloudHost
                        ? "Letterboxd automation runs locally on your computer via headless Playwright."
                        : "Launches a visible Chromium browser to log in, transfer the CSV, and resolve matching titles."}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAutoImportModal(false)}
                  className="text-ink-muted hover:text-ink p-1"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {autoImportMessage && (
                <div className="p-3 rounded-lg bg-success/10 border border-success/30 text-ink text-xs flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Automation Initiated</p>
                    <p className="text-success/90 mt-0.5">{autoImportMessage}</p>
                  </div>
                </div>
              )}

              {autoImportError && (
                <div className="p-3 rounded-lg bg-danger/10 border border-danger/30 text-ink text-xs flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Automation Error</p>
                    <p className="text-danger/90 mt-0.5">{autoImportError}</p>
                  </div>
                </div>
              )}

              {isCloudHost ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-canvas/80 border border-success/20 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-success/10 border border-success/20 text-success shrink-0">
                        <Terminal className="h-5 w-5" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-sm font-semibold text-ink">
                          Run Hands-Free Background Daemon
                        </h4>
                        <p className="text-xs text-ink-muted leading-relaxed">
                          Because Letterboxd does not provide an official API, syncing movies into your account requires browser automation (Playwright). Cloud serverless platforms (like Vercel) run in isolated containers without a display and cannot control your local desktop browser.
                        </p>
                        <p className="text-xs text-ink-muted leading-relaxed">
                          To have your movies and anime sync completely automatically every 15 minutes, run this command once on your computer:
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                      <div className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-surface border border-edge font-mono text-xs text-success">
                        <code>npm run schedule:letterboxd -- --headless</code>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyDaemon}
                        className="w-full sm:w-auto shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-success hover:bg-success/85 text-canvas transition-colors shadow-md shadow-success/10"
                      >
                        {copiedDaemon ? (
                          <>
                            <Check className="h-4 w-4 text-ink" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4" />
                            Copy Command
                          </>
                        )}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 text-[11px] text-ink-muted">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                        <span>Checks Trakt every 15 minutes</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                        <span>0% CPU quiet sleep when nothing watched</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                        <span>Updates MAL anime episodes & completed status</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                        <span>Auto-imports & confirms movies into Letterboxd</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-canvas/50 border border-edge space-y-3">
                    <h4 className="text-xs font-semibold text-ink-muted flex items-center gap-1.5">
                      <Download className="h-3.5 w-3.5 text-accent" />
                      Alternative: 1-Click Manual Import from Browser
                    </h4>
                    <p className="text-xs text-ink-muted">
                      You can also download your real-time verified CSV right now and drop it into Letterboxd:
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href="/api/export/letterboxd?type=watched"
                        download
                        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium bg-elevated hover:bg-raised text-ink border border-edge transition-colors"
                      >
                        <Download className="h-3.5 w-3.5 text-success" />
                        Download Watched CSV
                      </a>
                      <a
                        href="https://letterboxd.com/import/"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-accent/10 hover:bg-accent/10 text-accent border border-accent/30 transition-colors"
                      >
                        Open Letterboxd Importer
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleTriggerAutoImport} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* CSV Export Type */}
                    <div>
                      <label className="block text-xs font-medium text-ink-muted mb-1">
                        Data to Import
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setAutoImportType("watched")}
                          className={`px-3 py-2 rounded-xl text-xs font-medium text-left border transition-all ${
                            autoImportType === "watched"
                              ? "bg-success/10 border-success text-ink shadow-sm shadow-success/10"
                              : "bg-surface border-edge text-ink-muted hover:border-ink-subtle/40"
                          }`}
                        >
                          <p className="font-semibold">Watched Movies</p>
                          <p className="text-[10px] text-ink-subtle mt-0.5">Watch dates + IDs</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setAutoImportType("ratings")}
                          className={`px-3 py-2 rounded-xl text-xs font-medium text-left border transition-all ${
                            autoImportType === "ratings"
                              ? "bg-success/10 border-success text-ink shadow-sm shadow-success/10"
                              : "bg-surface border-edge text-ink-muted hover:border-ink-subtle/40"
                          }`}
                        >
                          <p className="font-semibold">Movie Ratings</p>
                          <p className="text-[10px] text-ink-subtle mt-0.5">0.5 to 5.0 stars</p>
                        </button>
                      </div>
                    </div>

                    {/* Letterboxd Password */}
                    <div>
                      <label className="block text-xs font-medium text-ink-muted mb-1 flex items-center justify-between">
                        <span>Letterboxd Password</span>
                        <span className="text-[10px] text-ink-subtle">
                          (or set LETTERBOXD_PASSWORD in .env)
                        </span>
                      </label>
                      <div className="relative">
                        <input
                          type="password"
                          placeholder="••••••••••••"
                          value={autoImportPassword}
                          onChange={(e) => setAutoImportPassword(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl bg-surface border border-edge text-xs text-ink placeholder-ink-subtle focus:outline-none focus:ring-1 focus:ring-accent pr-8"
                        />
                        <Lock className="h-3.5 w-3.5 text-ink-subtle absolute right-3 top-2.5" />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Auto Confirm Checkbox */}
                    <div className="flex items-start gap-2.5 p-3 rounded-xl bg-canvas/60 border border-edge">
                      <input
                        type="checkbox"
                        id="autoConfirm"
                        checked={autoImportAutoConfirm || autoImportRecurring}
                        disabled={autoImportRecurring}
                        onChange={(e) => setAutoImportAutoConfirm(e.target.checked)}
                        className="mt-0.5 rounded border-edge bg-surface text-success focus:ring-accent"
                      />
                      <label htmlFor="autoConfirm" className="text-xs text-ink-muted cursor-pointer">
                        <span className="font-medium text-ink">Auto-click "Import" button</span>
                        <p className="text-[11px] text-ink-muted mt-0.5">
                          Automatically confirms Letterboxd title matching without manual intervention.
                        </p>
                      </label>
                    </div>

                    {/* Recurring 15-Minute Sync Checkbox */}
                    <div className="flex items-start gap-2.5 p-3 rounded-xl bg-success/10 border border-success/30">
                      <input
                        type="checkbox"
                        id="recurringSync"
                        checked={autoImportRecurring}
                        onChange={(e) => setAutoImportRecurring(e.target.checked)}
                        className="mt-0.5 rounded border-success bg-surface text-success focus:ring-accent"
                      />
                      <label htmlFor="recurringSync" className="text-xs text-success cursor-pointer">
                        <span className="font-medium text-ink">Auto-sync every 15 minutes</span>
                        <p className="text-[11px] text-ink-muted mt-0.5">
                          Monitors Trakt every 15 mins. Remains quiet unless you watch a new movie.
                        </p>
                      </label>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                    <div className="text-[11px] text-ink-muted flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <Terminal className="h-3.5 w-3.5 text-ink-subtle" />
                        <span>Daemon: </span>
                        <code className="text-success bg-canvas px-2 py-0.5 rounded border border-edge">
                          npm run schedule:letterboxd
                        </code>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={autoImportLoading || !status?.connected?.trakt}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-success hover:bg-success/85 text-canvas transition-colors disabled:opacity-50 shadow-md shadow-success/10"
                    >
                      <Play className={`h-3.5 w-3.5 ${autoImportLoading ? "animate-spin" : ""}`} />
                      {autoImportLoading
                        ? "Initiating Engine..."
                        : autoImportRecurring
                        ? "Start 15-Min Auto-Sync"
                        : "Launch Browser & Auto-Import"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Live Sync Result Panel */}
        {syncResult && (
          <div className={`p-4 sm:p-6 rounded-2xl bg-surface border space-y-4 ${
            (syncResult.anime?.errors.length ?? 0) > 0 ||
            (syncResult.traktToLetterboxd?.errors?.length ?? 0) > 0 ||
            syncResult.traktToLetterboxd?.configured === false
              ? "border-danger/40"
              : "border-accent/20"
          }`}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-ink flex items-center gap-2">
                {(syncResult.anime?.errors.length ?? 0) > 0 ||
                (syncResult.traktToLetterboxd?.errors?.length ?? 0) > 0 ||
                syncResult.traktToLetterboxd?.configured === false ? (
                  <AlertCircle className="h-5 w-5 text-danger" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                )}
                Sync Execution Report
              </h3>
              <span className="text-xs text-ink-muted">
                {new Date(syncResult.timestamp).toLocaleTimeString()}
              </span>
            </div>

            {syncResult.anime && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                  <div className="p-3 rounded-xl bg-surface border border-edge">
                    <p className="text-xs text-ink-muted">Trakt Shows Scanned</p>
                    <p className="text-lg font-bold text-ink mt-1">
                      {syncResult.anime.totalTraktShows}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-surface border border-edge">
                    <p className="text-xs text-ink-muted">Anime Identified</p>
                    <p className="text-lg font-bold text-accent mt-1">
                      {syncResult.anime.animeIdentified}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-surface border border-edge">
                    <p className="text-xs text-ink-muted">MAL ID Matches</p>
                    <p className="text-lg font-bold text-success mt-1">
                      {syncResult.anime.malMatchesFound}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-surface border border-edge">
                    <p className="text-xs text-ink-muted">MAL Lists Updated</p>
                    <p className="text-lg font-bold text-ink mt-1">
                      {syncResult.anime.malUpdatedCount}
                    </p>
                  </div>
                </div>

                {syncResult.anime.updatedTitles.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                      Updated Titles on MyAnimeList:
                    </p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {syncResult.anime.updatedTitles.map((t, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between text-xs p-2 rounded-lg bg-surface/60 border border-edge"
                        >
                          <span className="font-medium text-ink">{t.title}</span>
                          <span className="text-accent">
                            Ep. {t.episodes} ({t.status})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {syncResult.anime.errors.length > 0 && (
                  <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 space-y-2">
                    <p className="text-xs font-semibold text-danger">
                      {syncResult.anime.errors.length} MAL update error(s)
                    </p>
                    <ul className="space-y-1 text-xs text-ink-muted">
                      {syncResult.anime.errors.map((error, idx) => (
                        <li key={idx} className="break-words">{error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {syncResult?.traktToLetterboxd && (
          <div className="p-4 sm:p-6 rounded-2xl bg-surface border border-edge space-y-3">
            <h3 className="font-semibold text-ink">Trakt to Letterboxd</h3>
            {syncResult.traktToLetterboxd.configured === false ? (
              <p className="text-sm text-ink-muted">
                {syncResult.traktToLetterboxd.message}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                  <div className="p-3 rounded-xl bg-surface border border-edge">
                    <p className="text-xs text-ink-muted">New Trakt Movies</p>
                    <p className="text-lg font-bold text-ink mt-1">
                      {syncResult.traktToLetterboxd.newMoviesFound ?? 0}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-surface border border-edge">
                    <p className="text-xs text-ink-muted">Marked Watched</p>
                    <p className="text-lg font-bold text-success mt-1">
                      {syncResult.traktToLetterboxd.markedWatched ?? 0}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-surface border border-edge">
                    <p className="text-xs text-ink-muted">Removed from Watchlist</p>
                    <p className="text-lg font-bold text-ink mt-1">
                      {syncResult.traktToLetterboxd.removedFromWatchlist ?? 0}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-surface border border-edge">
                    <p className="text-xs text-ink-muted">Already Synced</p>
                    <p className="text-lg font-bold text-ink mt-1">
                      {syncResult.traktToLetterboxd.alreadySynced ?? 0}
                    </p>
                  </div>
                </div>
                {syncResult.traktToLetterboxd.syncedTitles &&
                  syncResult.traktToLetterboxd.syncedTitles.length > 0 && (
                    <p className="text-xs text-ink-muted">
                      Synced: {syncResult.traktToLetterboxd.syncedTitles.join(", ")}
                    </p>
                  )}
                {syncResult.traktToLetterboxd.errors &&
                  syncResult.traktToLetterboxd.errors.length > 0 && (
                    <ul className="rounded-xl border border-danger/30 bg-danger/10 p-3 space-y-1 text-xs text-danger">
                      {syncResult.traktToLetterboxd.errors.map((error, idx) => (
                        <li key={idx} className="break-words">{error}</li>
                      ))}
                    </ul>
                  )}
              </>
            )}
          </div>
        )}

        {/* Vercel Deployment Checklist */}
        <div className="p-4 sm:p-6 rounded-2xl bg-surface/90 border border-edge space-y-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-accent" />
            <h3 className="font-semibold text-ink">Vercel Deployment Architecture</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 text-xs text-ink-muted">
            <div className="p-4 rounded-xl bg-surface/60 border border-edge space-y-2">
              <p className="font-medium text-ink flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-success" /> 1. Vercel Cron
              </p>
              <p>
                Automated daily sync triggered at 04:00 UTC via <code className="text-accent">vercel.json</code>.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-surface/60 border border-edge space-y-2">
              <p className="font-medium text-ink flex items-center gap-1.5">
                <Database className="h-4 w-4 text-accent" /> 2. Serverless Database
              </p>
              <p>
                Powered by Neon Serverless Postgres and Drizzle ORM for zero-cold-start performance.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-surface/60 border border-edge space-y-2">
              <p className="font-medium text-ink flex items-center gap-1.5">
                <RefreshCw className="h-4 w-4 text-danger" /> 3. ID Cross-Mapping
              </p>
              <p>
                Resolves TMDB/TVDB ↔ MAL IDs dynamically using community anime databases and fallback search.
              </p>
            </div>
          </div>
        </div>
          </>
        )}

        {/* Letterboxd Cookie Session Modal */}
        <LetterboxdSessionModal
          isOpen={showSessionModal}
          onClose={() => setShowSessionModal(false)}
          onSessionUpdated={fetchStatus}
        />
      </div>
    </div>
  );
}
