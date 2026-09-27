"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Clock,
  Film,
  Tv,
  RefreshCw,
  Search,
  Filter,
  Trash2,
  ExternalLink,
  CheckCircle2,
  Calendar,
  AlertCircle,
  Sparkles,
  Layers,
  Eye,
  Info,
  ChevronDown,
  X,
  Key,
  ShieldCheck,
  Star,
  Radio,
  ArrowUpRight,
} from "lucide-react";
import { TraktLogo, MalLogo, LetterboxdLogo } from "@/components/icons";
import LetterboxdSessionModal from "@/components/LetterboxdSessionModal";
import MoviePoster from "@/components/MoviePoster";

export interface ActivityItem {
  id: string;
  platform: "myanimelist" | "letterboxd" | "system";
  title: string;
  subtitle: string;
  type: "episode" | "movie" | "completed" | "sync_run";
  status: "synced" | "imported" | "completed" | "info" | "pending";
  timestamp: string;
  metadata?: {
    year?: number;
    season?: number;
    episode?: number;
    imdbId?: string;
    tmdbId?: number;
    malId?: number;
    plays?: number;
    url?: string;
    details?: string;
    syncedTitles?: string[];
    itemsFetched?: number;
    moviesSyncedToTrakt?: number;
    updatedTitles?: { title: string; episodes: number; status: string }[];
    posterUrl?: string;
    fanartUrl?: string;
    screenshotUrl?: string;
    genres?: string[];
    rating?: number;
    overview?: string;
  };
}

export interface ActivitySummary {
  total: number;
  malCount: number;
  letterboxdCount: number;
  systemCount: number;
  traktUsername: string;
  letterboxdUsername: string;
}

export interface Activity24hResponse {
  success: boolean;
  hours: number;
  cutoff: string;
  summary: ActivitySummary;
  items: ActivityItem[];
}

interface Activity24hTabProps {
  onDeleteTab?: () => void;
  defaultHours?: number;
}

function decodeClientEntities(str: string): string {
  if (!str) return "";
  return str
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanSubtitle(rawSubtitle: string): {
  text: string;
  titles?: string[];
} {
  if (!rawSubtitle) return { text: "" };

  const trimmed = rawSubtitle.trim();
  // Defensively parse raw JSON dump if passed from database
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        if ("rssItemsFetched" in parsed || "itemsFetched" in parsed || "syncedTitles" in parsed) {
          const count = parsed.rssItemsFetched ?? parsed.itemsFetched ?? 0;
          const synced = parsed.moviesSyncedToTrakt ?? 0;
          const titles = Array.isArray(parsed.syncedTitles)
            ? parsed.syncedTitles.map((t: string) => decodeClientEntities(String(t)))
            : [];
          if (synced > 0) {
            return {
              text: `Synced ${synced} movie(s) to Trakt • ${count} diary entries scanned`,
              titles,
            };
          }
          return {
            text: `Scanned ${count} Letterboxd diary entries • No new movies (Trakt is already up to date)`,
            titles,
          };
        }
        if ("totalTraktShows" in parsed || "malUpdatedCount" in parsed) {
          const updated = parsed.malUpdatedCount ?? 0;
          const shows = parsed.totalTraktShows ?? 0;
          return {
            text:
              updated > 0
                ? `Updated ${updated} anime on MyAnimeList`
                : `Scanned ${shows} shows • MyAnimeList is already up to date`,
          };
        }
      }
    } catch {}
  }

  return { text: decodeClientEntities(rawSubtitle) };
}

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return "just now";
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return dateString;
  }
}

export default function Activity24hTab({
  onDeleteTab,
  defaultHours = 24,
}: Activity24hTabProps) {
  const [hours, setHours] = useState<number>(defaultHours);
  const [platformFilter, setPlatformFilter] = useState<"all" | "letterboxd" | "myanimelist">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<Activity24hResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [sessionInfo, setSessionInfo] = useState<{
    hasSession: boolean;
    cookieCount: number;
    hasUserCookie: boolean;
    isExpired?: boolean;
    expiresAt: string | null;
  } | null>(null);
  const [ghRun, setGhRun] = useState<{
    status: string;
    conclusion: string | null;
    runNumber: number;
    updatedAt: string;
    htmlUrl: string;
  } | null>(null);
  const [showSessionModal, setShowSessionModal] = useState<boolean>(false);

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const fetchSessionInfo = async () => {
    try {
      const res = await fetch("/api/auth/letterboxd/session");
      if (res.ok) {
        const json = await res.json();
        setSessionInfo(json);
      }
    } catch {}
  };

  const fetchGhRuns = async () => {
    try {
      const res = await fetch("/api/github/actions");
      if (res.ok) {
        const json = await res.json();
        if (json.latestRun) {
          setGhRun(json.latestRun);
        }
      }
    } catch {}
  };

  const fetchActivity = async (selectedHours: number = hours) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/activity/24h?hours=${selectedHours}`);
      if (!res.ok) {
        throw new Error(`Failed to load activity log (HTTP ${res.status})`);
      }
      const json: Activity24hResponse = await res.json();
      setData(json);
      setLastRefreshed(new Date());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      fetchSessionInfo();
      fetchGhRuns();
    }
  };

  useEffect(() => {
    fetchActivity(hours);
    fetchSessionInfo();
    fetchGhRuns();
  }, [hours]);

  // Client-side filtering
  const filteredItems = useMemo(() => {
    if (!data?.items) return [];

    return data.items.filter((item) => {
      // Platform filter
      if (platformFilter !== "all" && item.platform !== platformFilter) {
        return false;
      }

      // Type filter
      if (typeFilter !== "all") {
        if (typeFilter === "movie" && item.type !== "movie") return false;
        if (typeFilter === "episode" && item.type !== "episode") return false;
        if (typeFilter === "completed" && item.type !== "completed") return false;
        if (typeFilter === "sync_run" && item.type !== "sync_run") return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesTitle = item.title.toLowerCase().includes(query);
        const matchesSubtitle = item.subtitle.toLowerCase().includes(query);
        const matchesDetails = item.metadata?.details?.toLowerCase().includes(query);
        const matchesImdb = item.metadata?.imdbId?.toLowerCase().includes(query);
        if (!matchesTitle && !matchesSubtitle && !matchesDetails && !matchesImdb) {
          return false;
        }
      }

      return true;
    });
  }, [data, platformFilter, typeFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Top Notice & Delete Tab Action Bar */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-slate-900/60 border border-indigo-800/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center shrink-0 mt-0.5">
            <Clock className="h-5 w-5 text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white">
                Live Activity Log
              </h2>
              <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Last {hours} Hours
              </span>
              <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                Inspection View
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Live updates synced between Trakt ➔ Letterboxd (Movies) and Trakt ➔ MyAnimeList (Anime).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <button
            onClick={() => fetchActivity(hours)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs font-medium text-slate-300 transition-colors"
            title="Refresh 24h data"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-indigo-400" : ""}`} />
            <span>Refresh</span>
          </button>

          {onDeleteTab && (
            confirmDelete ? (
              <div className="flex items-center gap-1 bg-red-950/80 border border-red-800/80 p-1 rounded-xl">
                <span className="text-[11px] text-red-200 px-2 font-medium">Delete tab?</span>
                <button
                  onClick={onDeleteTab}
                  className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  Yes, Remove
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-950/30 hover:bg-red-950/60 border border-red-800/40 text-xs font-medium text-red-300 hover:text-red-200 transition-colors"
                title="Delete or dismiss this temporary inspection tab"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete Tab</span>
              </button>
            )
          )}
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-200 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div className="text-sm flex-1">
            <p className="font-semibold">Unable to fetch sync activity</p>
            <p className="text-red-300/90 mt-0.5">{error}</p>
          </div>
          <button
            onClick={() => fetchActivity(hours)}
            className="text-xs text-red-400 hover:text-red-200 underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Quick Stats Overview - Haulix Obsidian Telemetry */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Updates */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] border-t-2 border-t-indigo-500 shadow-sm flex items-center justify-between transition-all hover:bg-[#111726]/90">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total Telemetry</p>
            <p className="text-3xl font-black text-white tracking-tight">
              {data ? data.summary.total : "--"}
            </p>
            <p className="text-[11px] text-indigo-400 flex items-center gap-1 font-medium">
              <Sparkles className="h-3 w-3" /> In selected {hours}h window
            </p>
          </div>
          <div className="h-11 w-11 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center shrink-0">
            <Layers className="h-5 w-5 text-indigo-400" />
          </div>
        </div>

        {/* Letterboxd Movies */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] border-t-2 border-t-[#00E054] shadow-sm flex items-center justify-between transition-all hover:bg-[#111726]/90">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Letterboxd Cinema</p>
            <p className="text-3xl font-black text-[#00E054] tracking-tight">
              {data ? data.summary.letterboxdCount : "--"}
            </p>
            <p className="text-[11px] text-slate-400 flex items-center gap-1 font-medium">
              <Film className="h-3 w-3 text-emerald-400" /> Scrobbles & Imports
            </p>
          </div>
          <div className="h-11 w-11 rounded-xl bg-[#00E054]/10 border border-[#00E054]/25 flex items-center justify-center shrink-0">
            <LetterboxdLogo size={22} />
          </div>
        </div>

        {/* MyAnimeList Anime */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] border-t-2 border-t-[#3B82F6] shadow-sm flex items-center justify-between transition-all hover:bg-[#111726]/90">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">MyAnimeList Feed</p>
            <p className="text-3xl font-black text-sky-400 tracking-tight">
              {data ? data.summary.malCount : "--"}
            </p>
            <p className="text-[11px] text-slate-400 flex items-center gap-1 font-medium">
              <Tv className="h-3 w-3 text-sky-400" /> Episodes & Finales
            </p>
          </div>
          <div className="h-11 w-11 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-center shrink-0">
            <MalLogo size={22} className="text-sky-400" />
          </div>
        </div>

        {/* Background Daemon Cycle & Cloud Engine */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] border-t-2 border-t-emerald-400 shadow-sm flex items-center justify-between transition-all hover:bg-[#111726]/90">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">15-Min Daemon</p>
              {ghRun?.htmlUrl && (
                <a
                  href={ghRun.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5 ml-2 font-mono font-medium"
                  title="View GitHub Actions Run Logs"
                >
                  <span>Cloud Run</span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                  ghRun?.conclusion === "success"
                    ? "bg-emerald-400 shadow-sm shadow-emerald-400/80 animate-pulse"
                    : ghRun?.status === "in_progress"
                    ? "bg-amber-400 animate-spin"
                    : ghRun?.conclusion === "failure"
                    ? "bg-red-500"
                    : "bg-emerald-400 shadow-sm shadow-emerald-400/80 animate-pulse"
                }`}
              />
              <p className="text-base font-black text-emerald-400 tracking-tight truncate">
                {ghRun?.conclusion === "success"
                  ? "Cloud 15-Min: OK"
                  : ghRun?.status === "in_progress"
                  ? "Syncing Now..."
                  : "Active Daemon"}
              </p>
            </div>
            <p className="text-[11px] text-slate-400 truncate">
              {ghRun?.updatedAt
                ? `Last run: ${formatRelativeTime(ghRun.updatedAt)} (#${ghRun.runNumber})`
                : `Refreshed ${formatRelativeTime(lastRefreshed.toISOString())}`}
            </p>
          </div>
          <div className="h-11 w-11 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center shrink-0">
            <RefreshCw className="h-5 w-5 text-emerald-400" />
          </div>
        </div>
      </div>

      {/* Letterboxd Session Status Banner - Haulix Obsidian Card */}
      {sessionInfo && (
        <div
          className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-md transition-all ${
            sessionInfo.hasSession && !sessionInfo.isExpired
              ? "bg-[#0D151E]/95 border-emerald-500/30 text-emerald-200"
              : "bg-[#18110D]/95 border-amber-500/40 text-amber-200"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 border ${
                sessionInfo.hasSession && !sessionInfo.isExpired
                  ? "bg-emerald-500/15 border-emerald-500/30"
                  : "bg-amber-500/15 border-amber-500/30"
              }`}
            >
              {sessionInfo.hasSession && !sessionInfo.isExpired ? (
                <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="h-5 w-5 text-amber-400 shrink-0" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-sm">
                  Letterboxd Playwright Session:{" "}
                  {sessionInfo.hasSession && !sessionInfo.isExpired
                    ? "Active & Verified"
                    : sessionInfo.isExpired
                    ? "Expired"
                    : "Not Configured"}
                </span>
                {sessionInfo.hasSession && !sessionInfo.isExpired && (
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </div>
              <p className="text-slate-300 text-xs mt-0.5">
                {sessionInfo.hasSession && !sessionInfo.isExpired
                  ? `${sessionInfo.cookieCount} session cookies stored${
                      sessionInfo.expiresAt
                        ? ` • Valid until ${new Date(sessionInfo.expiresAt).toLocaleDateString()}`
                        : ""
                    }`
                  : "Automated background sync requires an active Letterboxd cookie session. Update your session cookies to maintain 0-friction scrobble imports."}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowSessionModal(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs shrink-0 self-start sm:self-auto transition-all shadow-sm hover:shadow"
          >
            <Key className="h-3.5 w-3.5 text-emerald-400" />
            <span>Update Session</span>
          </button>
        </div>
      )}

      {/* Filter and Control Bar - Haulix Obsidian Layout */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] space-y-4 shadow-sm">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Platform Pills */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-black/40 border border-white/[0.06] overflow-x-auto">
            <button
              onClick={() => setPlatformFilter("all")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                platformFilter === "all"
                  ? "bg-slate-800 text-white shadow-sm border border-slate-700"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              All Platforms ({data?.summary.total || 0})
            </button>
            <button
              onClick={() => setPlatformFilter("letterboxd")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                platformFilter === "letterboxd"
                  ? "bg-[#00E054]/20 text-[#00E054] border border-[#00E054]/40"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#00E054]" />
              <LetterboxdLogo size={14} />
              <span>Letterboxd ({data?.summary.letterboxdCount || 0})</span>
            </button>
            <button
              onClick={() => setPlatformFilter("myanimelist")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                platformFilter === "myanimelist"
                  ? "bg-[#2E51A2]/25 text-sky-300 border border-[#2E51A2]/40"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
              <MalLogo size={14} className="text-sky-400" />
              <span>MyAnimeList ({data?.summary.malCount || 0})</span>
            </button>
          </div>

          {/* Time Horizon Horizon Selector */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-black/40 border border-white/[0.06]">
            <span className="text-[11px] text-slate-400 pl-2 pr-1 font-semibold flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Time:
            </span>
            {[
              { label: "1h", value: 1 },
              { label: "6h", value: 6 },
              { label: "12h", value: 12 },
              { label: "24h", value: 24 },
              { label: "7d", value: 168 },
            ].map((t) => (
              <button
                key={t.value}
                onClick={() => setHours(t.value)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                  hours === t.value
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Second Row: Type Filter & Live Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-white/[0.06]">
          {/* Type Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold flex items-center gap-1">
              <Filter className="h-3.5 w-3.5" /> Type:
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { id: "all", label: "All Types" },
                { id: "movie", label: "Movies" },
                { id: "episode", label: "Episodes" },
                { id: "sync_run", label: "Sync Runs" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setTypeFilter(opt.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    typeFilter === opt.id
                      ? "bg-slate-800 text-white border border-slate-700 shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Search Input */}
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, show, or ID..."
              className="w-full pl-9 pr-8 py-1.5 rounded-xl bg-black/40 border border-white/[0.08] text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Activity Timeline List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-400 px-1">
          <span>Showing {filteredItems.length} synchronization events</span>
          <span>Cutoff: {hours} hours prior to now</span>
        </div>

        {loading ? (
          <div className="p-12 rounded-2xl bg-[#0B0F19] border border-slate-800/80 text-center space-y-3">
            <RefreshCw className="h-6 w-6 text-indigo-400 animate-spin mx-auto" />
            <p className="text-sm text-slate-300 font-medium">
              Fetching updates from Trakt, Letterboxd & MyAnimeList...
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 rounded-2xl bg-[#0B0F19] border border-slate-800/80 text-center space-y-3">
            <div className="h-12 w-12 rounded-full bg-slate-800/60 border border-slate-700/60 flex items-center justify-center mx-auto text-slate-400">
              <Calendar className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                No activity found for this filter
              </h3>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                No new scrobbles or sync records occurred in the selected {hours}-hour timeframe.
                Try broadening the time range to 7 days, or watch a movie/episode on Trakt to trigger updates.
              </p>
            </div>
            <div className="pt-2">
              <button
                onClick={() => setHours(168)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-xs font-medium text-indigo-300 transition-colors"
              >
                <span>Expand to 7 Days</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredItems.map((item) => {
              const isLB = item.platform === "letterboxd";
              const isMAL = item.platform === "myanimelist";
              const isExpanded = !!expandedItems[item.id];

              // Clean subtitle & extract titles defensively if raw JSON
              const cleaned = cleanSubtitle(item.subtitle);
              const displaySubtitle = cleaned.text;
              const diaryTitles =
                item.metadata?.syncedTitles && item.metadata.syncedTitles.length > 0
                  ? item.metadata.syncedTitles
                  : cleaned.titles && cleaned.titles.length > 0
                  ? cleaned.titles
                  : null;

              return (
                <div
                  key={item.id}
                  className="group p-4 sm:p-5 rounded-2xl bg-[#0D111A]/90 hover:bg-[#111726]/95 border border-white/[0.08] hover:border-slate-600/80 transition-all duration-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm hover:shadow-xl hover:shadow-black/30"
                >
                  <div className="flex items-start gap-4 min-w-0 flex-1">
                    {/* Visual Asset Thumbnail: Poster or Telemetry Engine Icon */}
                    {item.type === "movie" || item.type === "episode" || item.type === "completed" ? (
                      <MoviePoster
                        src={item.metadata?.posterUrl || item.metadata?.screenshotUrl}
                        title={item.title}
                        year={item.metadata?.year}
                        platform={item.platform}
                        type={item.type}
                        className="w-14 sm:w-16 md:w-20 rounded-xl shadow-md border border-white/[0.08] shrink-0"
                      />
                    ) : (
                      <div className="w-14 sm:w-16 md:w-20 aspect-[2/3] rounded-xl bg-gradient-to-b from-slate-900 to-black border border-white/[0.08] flex flex-col items-center justify-center gap-1.5 shrink-0 shadow-md">
                        {isLB ? (
                          <LetterboxdLogo size={22} />
                        ) : isMAL ? (
                          <MalLogo size={22} className="text-[#2E51A2]" />
                        ) : (
                          <TraktLogo size={20} className="text-[#ED1C24]" />
                        )}
                        <span className="text-[9px] font-mono tracking-wider uppercase text-slate-500 font-bold">
                          {isLB ? "LB SYNC" : isMAL ? "MAL SYNC" : "ENGINE"}
                        </span>
                      </div>
                    )}

                    {/* Title & Telemetry Metadata */}
                    <div className="min-w-0 space-y-1.5 flex-1">
                      {/* Top Chips Row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Platform Badge */}
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-bold tracking-tight border ${
                            isLB
                              ? "bg-[#00E054]/10 border-[#00E054]/30 text-[#00E054]"
                              : isMAL
                              ? "bg-[#2E51A2]/20 border-[#2E51A2]/35 text-sky-300"
                              : "bg-red-500/10 border-red-500/30 text-red-300"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              isLB
                                ? "bg-[#00E054]"
                                : isMAL
                                ? "bg-sky-400"
                                : "bg-red-400"
                            }`}
                          />
                          {isLB ? "Letterboxd" : isMAL ? "MyAnimeList" : "Trakt Engine"}
                        </span>

                        {/* Year Chip */}
                        {item.metadata?.year && (
                          <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-slate-300">
                            {item.metadata.year}
                          </span>
                        )}

                        {/* Season & Episode Chip */}
                        {item.metadata?.season !== undefined && item.metadata?.episode !== undefined && (
                          <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                            S{String(item.metadata.season).padStart(2, "0")} E{String(item.metadata.episode).padStart(2, "0")}
                          </span>
                        )}

                        {/* Type Chip */}
                        {item.type === "movie" ? (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50">
                            Movie
                          </span>
                        ) : item.type === "completed" ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-purple-950/60 border border-purple-800/50 text-purple-300 flex items-center gap-1">
                            <Sparkles className="h-2.5 w-2.5" /> Series Finale
                          </span>
                        ) : item.type === "episode" ? (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50">
                            Anime
                          </span>
                        ) : null}
                      </div>

                      {/* Title */}
                      <h4 className="text-sm sm:text-base font-bold text-white tracking-tight group-hover:text-indigo-200 transition-colors line-clamp-1">
                        {decodeClientEntities(item.title)}
                      </h4>

                      {/* Subtitle / Telemetry Log */}
                      <p className="text-xs text-slate-300/90 leading-relaxed">
                        {displaySubtitle}
                      </p>

                      {/* Expandable Diary Titles list (for Letterboxd RSS runs) */}
                      {diaryTitles && diaryTitles.length > 0 && (
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => toggleExpand(item.id)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/40 hover:bg-slate-800 border border-white/[0.08] hover:border-slate-700 text-[11px] font-semibold text-slate-300 transition-colors"
                          >
                            <ChevronDown
                              className={`h-3 w-3 text-slate-400 transition-transform duration-200 ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                            />
                            <span>
                              {isExpanded ? "Hide" : "View"} {diaryTitles.length} diary title(s) scanned
                            </span>
                          </button>

                          {isExpanded && (
                            <div className="mt-2 p-2.5 rounded-xl bg-black/60 border border-white/[0.08] max-h-48 overflow-y-auto flex flex-wrap gap-1.5 shadow-inner">
                              {diaryTitles.map((t: string, idx: number) => (
                                <span
                                  key={idx}
                                  className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-[11px] text-slate-300 font-medium"
                                >
                                  {decodeClientEntities(t)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Updated Anime Titles pills (for MAL sync runs) */}
                      {item.metadata?.updatedTitles && item.metadata.updatedTitles.length > 0 && (
                        <div className="pt-1 flex flex-wrap gap-1.5">
                          {item.metadata.updatedTitles.map((u: { title: string; episodes: number; status?: string }, idx: number) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded-md bg-indigo-950/60 border border-indigo-800/60 text-[11px] text-indigo-300 font-semibold"
                            >
                              {decodeClientEntities(u.title)} (Ep. {u.episodes})
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Bottom Telemetry Row: Rating, IMDb, TMDb, MAL, Genres, Plays */}
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 pt-1 flex-wrap">
                        {item.metadata?.rating && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[10px] font-bold">
                            <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                            {item.metadata.rating.toFixed(1)}
                          </span>
                        )}
                        {item.metadata?.imdbId && (
                          <a
                            href={`https://www.imdb.com/title/${item.metadata.imdbId}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded text-[10px] font-mono text-amber-400/90 flex items-center gap-1 transition-colors"
                          >
                            <span>IMDb: {item.metadata.imdbId}</span>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                        {item.metadata?.tmdbId && (
                          <span className="px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 text-sky-400/90 font-mono text-[10px]">
                            TMDb: {item.metadata.tmdbId}
                          </span>
                        )}
                        {item.metadata?.malId && (
                          <a
                            href={`https://myanimelist.net/anime/${item.metadata.malId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-sky-300 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded text-[10px] font-mono text-sky-300 flex items-center gap-1 transition-colors"
                          >
                            <span>MAL #{item.metadata.malId}</span>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                        {item.metadata?.genres && item.metadata.genres.slice(0, 2).map((g, idx) => (
                          <span key={idx} className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-slate-400 text-[10px] font-medium">
                            {g}
                          </span>
                        ))}
                        {item.metadata?.plays && item.metadata.plays > 1 && (
                          <span className="text-indigo-400 text-[10px] font-semibold bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                            {item.metadata.plays} plays logged
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Status Pill, Timestamp, External Action Button */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center w-full sm:w-auto gap-2.5 shrink-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-white/[0.06]">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold tracking-wide uppercase shadow-sm ${
                          item.status === "pending"
                            ? "bg-amber-500/15 text-amber-300 border border-amber-500/35"
                            : isLB
                            ? "bg-[#00E054]/15 text-[#00E054] border border-[#00E054]/35"
                            : isMAL
                            ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/35"
                            : "bg-slate-800 text-slate-300 border border-slate-700"
                        }`}
                      >
                        {item.status === "pending" ? (
                          <Clock className="h-3 w-3 text-amber-400" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3" />
                        )}
                        {item.status === "imported"
                          ? "Auto-Imported"
                          : item.status === "synced"
                          ? "Synced"
                          : item.status === "completed"
                          ? "Completed"
                          : item.status === "pending"
                          ? isLB
                            ? "Pending Import"
                            : "Pending Sync"
                          : item.status}
                      </span>

                      {/* Direct External Action Link */}
                      {item.metadata?.url && (
                        <a
                          href={item.metadata.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-white border border-white/[0.08] transition-colors"
                          title="Open item page"
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>

                    <span
                      className="text-xs text-slate-400 hover:text-slate-200 cursor-default font-mono"
                      title={new Date(item.timestamp).toLocaleString()}
                    >
                      {formatRelativeTime(item.timestamp)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Info & Permanent Deletion Guide */}
      <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/60 text-xs text-slate-400 flex items-start gap-2.5">
        <Info className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-slate-300 font-medium">Temporary Inspection Tab</p>
          <p>
            This 24h updates tab was created for verifying your MyAnimeList & Letterboxd sync flows.
            You can dismiss it at any time using the <span className="text-red-400 font-semibold">Delete Tab</span> button above, or ask me to delete the code after you finish your tests.
          </p>
        </div>
      </div>

      <LetterboxdSessionModal
        isOpen={showSessionModal}
        onClose={() => {
          setShowSessionModal(false);
          fetchSessionInfo();
        }}
        onSessionUpdated={() => {
          fetchSessionInfo();
          fetchActivity(hours);
        }}
      />
    </div>
  );
}
