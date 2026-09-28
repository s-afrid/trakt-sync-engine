"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  PlayCircle,
  Tv,
  RefreshCw,
  Search,
  ExternalLink,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Clock,
  Layers,
  ArrowUpRight,
  X,
  ChevronDown,
} from "lucide-react";
import { TraktLogo, MalLogo } from "@/components/icons";
import MoviePoster from "@/components/MoviePoster";

export interface ContinueWatchingItem {
  id: string;
  platform: "myanimelist" | "trakt";
  type: "anime" | "show";
  title: string;
  year?: number;
  posterUrl?: string;
  completedEpisodes: number;
  totalEpisodes?: number;
  progressPercent?: number;
  lastWatchedEpisode?: string;
  nextEpisode?: string;
  completedEpisodesList?: number[];
  lastWatchedAt?: string;
  url?: string;
  genres?: string[];
  rating?: number;
  metadata?: {
    traktId?: number;
    tmdbId?: number;
    tvdbId?: number;
    malId?: number;
  };
}

export interface ContinueWatchingSummary {
  total: number;
  animeCount: number;
  showCount: number;
  totalEpisodesWatched: number;
}

export interface ContinueWatchingResponse {
  success: boolean;
  summary: ContinueWatchingSummary;
  items: ContinueWatchingItem[];
  error?: string;
}

function formatRelativeTime(dateString?: string): string {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return "just now";
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return "just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return "";
  }
}

export default function ContinueWatchingTab() {
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<ContinueWatchingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<"all" | "myanimelist" | "trakt">("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [expandedPills, setExpandedPills] = useState<Record<string, boolean>>({});

  const togglePills = (id: string) => {
    setExpandedPills((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const fetchContinueWatching = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/continue-watching");
      const json: ContinueWatchingResponse = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP error ${res.status}`);
      }
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContinueWatching();
  }, []);

  const filteredItems = useMemo(() => {
    if (!data?.items) return [];

    return data.items.filter((item) => {
      if (platformFilter !== "all" && item.platform !== platformFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesNext = item.nextEpisode?.toLowerCase().includes(q);
        const matchesLast = item.lastWatchedEpisode?.toLowerCase().includes(q);
        if (!matchesTitle && !matchesNext && !matchesLast) {
          return false;
        }
      }
      return true;
    });
  }, [data, platformFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Top Notice Bar */}
      <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-blue-950/40 via-indigo-950/30 to-[#0D111A] border border-blue-800/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 shadow-xl">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center shrink-0 mt-0.5">
            <PlayCircle className="h-5 w-5 text-blue-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <h2 className="text-sm sm:text-base font-semibold text-white">Continue Watching</h2>
              <span className="px-2 py-0.5 text-[10px] sm:text-[11px] font-medium rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                In Progress
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
              Active series you have started. Tracks completed episodes and calculates your next up episode. Moves out automatically upon series completion.
            </p>
          </div>
        </div>

        <button
          onClick={fetchContinueWatching}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs font-medium text-slate-300 transition-colors shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-blue-400" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-200 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div className="text-sm flex-1">
            <p className="font-semibold">Unable to load continue watching list</p>
            <p className="text-red-300/90 mt-0.5">{error}</p>
          </div>
          <button onClick={fetchContinueWatching} className="text-xs text-red-400 hover:text-red-200 underline">
            Retry
          </button>
        </div>
      )}

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total In Progress */}
        <div className="p-3.5 sm:p-4 md:p-5 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] border-t-2 border-t-blue-500 shadow-sm flex items-center justify-between transition-all hover:bg-[#111726]/90">
          <div className="space-y-1">
            <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-400">Shows In Progress</p>
            <p className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              {data ? data.summary.total : "--"}
            </p>
            <p className="text-[10px] sm:text-[11px] text-blue-400 flex items-center gap-1 font-medium">
              <Sparkles className="h-3 w-3" /> Started & uncompleted
            </p>
          </div>
          <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-center shrink-0">
            <PlayCircle className="h-5 w-5 text-blue-400" />
          </div>
        </div>

        {/* Anime In Progress */}
        <div className="p-3.5 sm:p-4 md:p-5 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] border-t-2 border-t-[#3B82F6] shadow-sm flex items-center justify-between transition-all hover:bg-[#111726]/90">
          <div className="space-y-1">
            <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-400">MyAnimeList Anime</p>
            <p className="text-2xl sm:text-3xl font-black text-sky-400 tracking-tight">
              {data ? data.summary.animeCount : "--"}
            </p>
            <p className="text-[10px] sm:text-[11px] text-slate-400 flex items-center gap-1 font-medium">
              <Tv className="h-3 w-3 text-sky-400" /> Currently Watching
            </p>
          </div>
          <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-center shrink-0">
            <MalLogo size={22} className="text-sky-400" />
          </div>
        </div>

        {/* Trakt Shows In Progress */}
        <div className="p-3.5 sm:p-4 md:p-5 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] border-t-2 border-t-[#ED1C24] shadow-sm flex items-center justify-between transition-all hover:bg-[#111726]/90">
          <div className="space-y-1">
            <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-400">Trakt TV Shows</p>
            <p className="text-2xl sm:text-3xl font-black text-red-400 tracking-tight">
              {data ? data.summary.showCount : "--"}
            </p>
            <p className="text-[10px] sm:text-[11px] text-slate-400 flex items-center gap-1 font-medium">
              <Tv className="h-3 w-3 text-red-400" /> In-Progress Seasons
            </p>
          </div>
          <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-red-500/10 border border-red-500/25 flex items-center justify-center shrink-0">
            <TraktLogo size={20} className="text-[#ED1C24]" />
          </div>
        </div>

        {/* Total Episodes Watched */}
        <div className="p-3.5 sm:p-4 md:p-5 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] border-t-2 border-t-emerald-400 shadow-sm flex items-center justify-between transition-all hover:bg-[#111726]/90">
          <div className="space-y-1">
            <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-400">Episodes Logged</p>
            <p className="text-2xl sm:text-3xl font-black text-emerald-400 tracking-tight">
              {data ? data.summary.totalEpisodesWatched : "--"}
            </p>
            <p className="text-[10px] sm:text-[11px] text-slate-400 flex items-center gap-1 font-medium">
              <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Completed Across Series
            </p>
          </div>
          <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center shrink-0">
            <Layers className="h-5 w-5 text-emerald-400" />
          </div>
        </div>
      </div>

      {/* Control & Filter Bar */}
      <div className="p-3.5 sm:p-4 md:p-5 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] space-y-3 sm:space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Platform Pills */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-black/40 border border-white/[0.06] overflow-x-auto scrollbar-none">
            <button
              onClick={() => setPlatformFilter("all")}
              className={`shrink-0 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                platformFilter === "all"
                  ? "bg-slate-800 text-white shadow-sm border border-slate-700"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              All Series ({data?.summary.total || 0})
            </button>
            <button
              onClick={() => setPlatformFilter("myanimelist")}
              className={`shrink-0 flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                platformFilter === "myanimelist"
                  ? "bg-[#2E51A2]/25 text-sky-300 border border-[#2E51A2]/40"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <MalLogo size={14} className="text-sky-400" />
              <span>Anime ({data?.summary.animeCount || 0})</span>
            </button>
            <button
              onClick={() => setPlatformFilter("trakt")}
              className={`shrink-0 flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                platformFilter === "trakt"
                  ? "bg-red-500/20 text-red-300 border border-red-500/40"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <TraktLogo size={14} className="text-[#ED1C24]" />
              <span>TV Shows ({data?.summary.showCount || 0})</span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-64 md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search series or next episode..."
              className="w-full pl-9 pr-8 py-1.5 rounded-xl bg-black/40 border border-white/[0.08] text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
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

      {/* Series Cards List */}
      <div>
        <div className="flex items-center justify-between text-xs text-slate-400 px-1 mb-3">
          <span>{filteredItems.length} active in-progress series</span>
          <span className="text-[11px] text-slate-500">Automatically tracks episode scrobbles</span>
        </div>

        {loading ? (
          <div className="p-12 rounded-2xl bg-[#0B0F19] border border-slate-800/80 text-center space-y-3">
            <RefreshCw className="h-6 w-6 text-blue-400 animate-spin mx-auto" />
            <p className="text-sm text-slate-300 font-medium">Loading continue watching progress...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 rounded-2xl bg-[#0B0F19] border border-slate-800/80 text-center space-y-3">
            <div className="h-12 w-12 rounded-full bg-slate-800/60 border border-slate-700/60 flex items-center justify-center mx-auto text-slate-400">
              <PlayCircle className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-semibold text-white">No active in-progress series</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              You don&apos;t have any shows or anime currently in progress. Start watching an episode on Trakt or MyAnimeList to track your progress here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredItems.map((item) => {
              const isMAL = item.platform === "myanimelist";
              const isExpanded = !!expandedPills[item.id];
              const pct = item.progressPercent ?? 0;

              return (
                <div
                  key={item.id}
                  className="p-4 sm:p-5 rounded-2xl bg-[#0D111A]/90 hover:bg-[#111726]/95 border border-white/[0.08] hover:border-slate-600/80 transition-all duration-200 shadow-sm space-y-4"
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    {/* Visual Poster & Title Info */}
                    <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
                      <MoviePoster
                        src={item.posterUrl}
                        title={item.title}
                        year={item.year}
                        platform={item.platform}
                        type="episode"
                        className="w-14 sm:w-16 md:w-20 rounded-xl shadow-md border border-white/[0.08] shrink-0"
                      />

                      <div className="min-w-0 space-y-1 flex-1">
                        {/* Platform & Episode Counts */}
                        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] font-bold border ${
                              isMAL
                                ? "bg-[#2E51A2]/20 border-[#2E51A2]/35 text-sky-300"
                                : "bg-red-500/10 border-red-500/30 text-red-300"
                            }`}
                          >
                            {isMAL ? "MyAnimeList" : "Trakt TV"}
                          </span>

                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-slate-300">
                            {item.completedEpisodes} {item.totalEpisodes ? `/ ${item.totalEpisodes}` : ""} Episodes Watched
                          </span>

                          {item.lastWatchedAt && (
                            <span className="text-[10px] text-slate-500 flex items-center gap-1">
                              <Clock className="h-2.5 w-2.5" />
                              {formatRelativeTime(item.lastWatchedAt)}
                            </span>
                          )}
                        </div>

                        {/* Title */}
                        <h4 className="text-sm sm:text-base font-bold text-white tracking-tight line-clamp-1">
                          {item.title}
                        </h4>

                        {/* Last Watched & Next Up row */}
                        <div className="flex items-center gap-2 text-xs pt-0.5 flex-wrap">
                          {item.lastWatchedEpisode && (
                            <span className="text-slate-400">
                              Last completed: <strong className="text-slate-200">{item.lastWatchedEpisode}</strong>
                            </span>
                          )}
                          {item.nextEpisode && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/30 text-blue-300 font-semibold text-[11px]">
                              <span>Next:</span>
                              <span>{item.nextEpisode}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar & Actions */}
                    <div className="w-full sm:w-60 md:w-72 shrink-0 space-y-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-white/[0.06]">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-300">Progress</span>
                        <span className="font-mono text-emerald-400 font-bold">
                          {item.totalEpisodes ? `${pct}%` : `${item.completedEpisodes} eps`}
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full h-2 rounded-full bg-slate-800/80 overflow-hidden border border-white/[0.06]">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 transition-all duration-500 rounded-full"
                          style={{ width: `${pct || Math.min(item.completedEpisodes * 5, 100)}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                        <span>{item.completedEpisodes} completed</span>
                        {item.totalEpisodes && (
                          <span>{item.totalEpisodes - item.completedEpisodes} remaining</span>
                        )}
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-blue-400 hover:text-blue-300 font-medium"
                          >
                            <span>Open</span>
                            <ArrowUpRight className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Completed Episodes Pills Strip (Optional toggle for deep inspection) */}
                  {item.completedEpisodes > 0 && (
                    <div className="pt-2 border-t border-white/[0.04]">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-400 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                          Completed episodes tracker:
                        </span>
                        <button
                          type="button"
                          onClick={() => togglePills(item.id)}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium"
                        >
                          <span>{isExpanded ? "Hide" : "Show"} breakdown ({item.completedEpisodes})</span>
                          <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="mt-2 p-2.5 rounded-xl bg-black/40 border border-white/[0.06] flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                          {Array.from({ length: item.completedEpisodes }).map((_, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-950/50 border border-emerald-800/40 text-[10px] font-mono text-emerald-300"
                            >
                              <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" />
                              <span>Ep {i + 1}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
