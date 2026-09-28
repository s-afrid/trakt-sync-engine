"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Bookmark,
  Film,
  Tv,
  RefreshCw,
  Search,
  Filter,
  ExternalLink,
  Sparkles,
  AlertCircle,
  Star,
  Layers,
  ArrowUpRight,
  X,
} from "lucide-react";
import { TraktLogo, MalLogo, LetterboxdLogo } from "@/components/icons";
import MoviePoster from "@/components/MoviePoster";

export interface WatchlistItem {
  id: string;
  platform: "trakt" | "letterboxd" | "myanimelist";
  type: "movie" | "show" | "anime";
  title: string;
  year?: number;
  overview?: string;
  rating?: number;
  posterUrl?: string;
  genres?: string[];
  totalEpisodes?: number;
  url?: string;
  listedAt?: string;
  metadata?: {
    traktId?: number;
    tmdbId?: number;
    imdbId?: string;
    tvdbId?: number;
    malId?: number;
  };
}

export interface WatchlistSummary {
  total: number;
  traktCount: number;
  letterboxdCount: number;
  malCount: number;
  moviesCount: number;
  showsCount: number;
  animeCount: number;
}

export interface WatchlistResponse {
  success: boolean;
  summary: WatchlistSummary;
  items: WatchlistItem[];
  error?: string;
}

export default function WatchlistTab() {
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<WatchlistResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<"all" | "trakt" | "letterboxd" | "myanimelist">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "movie" | "show" | "anime">("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const fetchWatchlist = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/watchlist");
      const json: WatchlistResponse = await res.json();
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
    fetchWatchlist();
  }, []);

  const filteredItems = useMemo(() => {
    if (!data?.items) return [];

    return data.items.filter((item) => {
      if (platformFilter !== "all" && item.platform !== platformFilter) {
        return false;
      }
      if (typeFilter !== "all" && item.type !== typeFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesOverview = item.overview?.toLowerCase().includes(q);
        const matchesYear = item.year?.toString().includes(q);
        if (!matchesTitle && !matchesOverview && !matchesYear) {
          return false;
        }
      }
      return true;
    });
  }, [data, platformFilter, typeFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Top Notice Bar */}
      <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-amber-950/30 via-slate-900/60 to-[#0D111A] border border-amber-800/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 shadow-xl">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0 mt-0.5">
            <Bookmark className="h-5 w-5 text-amber-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <h2 className="text-sm sm:text-base font-semibold text-white">Unified Watchlist</h2>
              <span className="px-2 py-0.5 text-[10px] sm:text-[11px] font-medium rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                Auto-Clearing
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
              Consolidated titles across Trakt, Letterboxd, and MyAnimeList. Items are automatically removed upon completion.
            </p>
          </div>
        </div>

        <button
          onClick={fetchWatchlist}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs font-medium text-slate-300 transition-colors shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-amber-400" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-200 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div className="text-sm flex-1">
            <p className="font-semibold">Unable to load unified watchlist</p>
            <p className="text-red-300/90 mt-0.5">{error}</p>
          </div>
          <button onClick={fetchWatchlist} className="text-xs text-red-400 hover:text-red-200 underline">
            Retry
          </button>
        </div>
      )}

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Watchlist */}
        <div className="p-3.5 sm:p-4 md:p-5 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] border-t-2 border-t-amber-500 shadow-sm flex items-center justify-between transition-all hover:bg-[#111726]/90">
          <div className="space-y-1">
            <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total In Watchlist</p>
            <p className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              {data ? data.summary.total : "--"}
            </p>
            <p className="text-[10px] sm:text-[11px] text-amber-400 flex items-center gap-1 font-medium">
              <Sparkles className="h-3 w-3" /> All connected platforms
            </p>
          </div>
          <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center shrink-0">
            <Layers className="h-5 w-5 text-amber-400" />
          </div>
        </div>

        {/* Trakt Watchlist */}
        <div className="p-3.5 sm:p-4 md:p-5 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] border-t-2 border-t-[#ED1C24] shadow-sm flex items-center justify-between transition-all hover:bg-[#111726]/90">
          <div className="space-y-1">
            <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-400">Trakt Queue</p>
            <p className="text-2xl sm:text-3xl font-black text-red-400 tracking-tight">
              {data ? data.summary.traktCount : "--"}
            </p>
            <p className="text-[10px] sm:text-[11px] text-slate-400 flex items-center gap-1 font-medium">
              <Tv className="h-3 w-3 text-red-400" /> Movies & TV Shows
            </p>
          </div>
          <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-red-500/10 border border-red-500/25 flex items-center justify-center shrink-0">
            <TraktLogo size={20} className="text-[#ED1C24]" />
          </div>
        </div>

        {/* Letterboxd Watchlist */}
        <div className="p-3.5 sm:p-4 md:p-5 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] border-t-2 border-t-[#00E054] shadow-sm flex items-center justify-between transition-all hover:bg-[#111726]/90">
          <div className="space-y-1">
            <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-400">Letterboxd Cinema</p>
            <p className="text-2xl sm:text-3xl font-black text-[#00E054] tracking-tight">
              {data ? data.summary.letterboxdCount : "--"}
            </p>
            <p className="text-[10px] sm:text-[11px] text-slate-400 flex items-center gap-1 font-medium">
              <Film className="h-3 w-3 text-emerald-400" /> Unwatched Movies
            </p>
          </div>
          <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-[#00E054]/10 border border-[#00E054]/25 flex items-center justify-center shrink-0">
            <LetterboxdLogo size={22} />
          </div>
        </div>

        {/* MyAnimeList Watchlist */}
        <div className="p-3.5 sm:p-4 md:p-5 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] border-t-2 border-t-[#3B82F6] shadow-sm flex items-center justify-between transition-all hover:bg-[#111726]/90">
          <div className="space-y-1">
            <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-400">MyAnimeList Plan</p>
            <p className="text-2xl sm:text-3xl font-black text-sky-400 tracking-tight">
              {data ? data.summary.malCount : "--"}
            </p>
            <p className="text-[10px] sm:text-[11px] text-slate-400 flex items-center gap-1 font-medium">
              <Tv className="h-3 w-3 text-sky-400" /> Plan to Watch
            </p>
          </div>
          <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-center shrink-0">
            <MalLogo size={22} className="text-sky-400" />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-3.5 sm:p-4 md:p-5 rounded-2xl bg-[#0D111A]/90 border border-white/[0.08] space-y-3 sm:space-y-4 shadow-sm">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 sm:gap-3">
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
              All Platforms ({data?.summary.total || 0})
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
              <span>Trakt ({data?.summary.traktCount || 0})</span>
            </button>
            <button
              onClick={() => setPlatformFilter("letterboxd")}
              className={`shrink-0 flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                platformFilter === "letterboxd"
                  ? "bg-[#00E054]/20 text-[#00E054] border border-[#00E054]/40"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <LetterboxdLogo size={14} />
              <span>Letterboxd ({data?.summary.letterboxdCount || 0})</span>
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
              <span>MyAnimeList ({data?.summary.malCount || 0})</span>
            </button>
          </div>

          {/* Type Filter */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none self-start md:self-auto shrink-0">
            <span className="text-xs text-slate-400 font-semibold flex items-center gap-1 shrink-0">
              <Filter className="h-3.5 w-3.5" /> Type:
            </span>
            {[
              { id: "all", label: "All" },
              { id: "movie", label: "Movies" },
              { id: "show", label: "TV Shows" },
              { id: "anime", label: "Anime" },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setTypeFilter(opt.id as any)}
                className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
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

        {/* Live Search */}
        <div className="pt-2 border-t border-white/[0.06]">
          <div className="relative w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search watchlist by title, overview, or year..."
              className="w-full pl-10 pr-9 py-2 rounded-xl bg-black/40 border border-white/[0.08] text-xs sm:text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Watchlist Items Grid */}
      <div>
        <div className="flex items-center justify-between text-xs text-slate-400 px-1 mb-3">
          <span>Showing {filteredItems.length} queued title(s)</span>
          <span className="text-[11px] text-emerald-400/90 font-medium">Completed items automatically cleared</span>
        </div>

        {loading ? (
          <div className="p-12 rounded-2xl bg-[#0B0F19] border border-slate-800/80 text-center space-y-3">
            <RefreshCw className="h-6 w-6 text-amber-400 animate-spin mx-auto" />
            <p className="text-sm text-slate-300 font-medium">
              Aggregating watchlists from Trakt, Letterboxd & MyAnimeList...
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 rounded-2xl bg-[#0B0F19] border border-slate-800/80 text-center space-y-3">
            <div className="h-12 w-12 rounded-full bg-slate-800/60 border border-slate-700/60 flex items-center justify-center mx-auto text-slate-400">
              <Bookmark className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-semibold text-white">No titles in this watchlist filter</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              All titles may have been watched or completed, or there are no items matching your filter criteria.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
            {filteredItems.map((item) => {
              const isTrakt = item.platform === "trakt";
              const isLB = item.platform === "letterboxd";
              const isMAL = item.platform === "myanimelist";

              return (
                <div
                  key={item.id}
                  className="group p-3.5 sm:p-4 rounded-2xl bg-[#0D111A]/90 hover:bg-[#111726]/95 border border-white/[0.08] hover:border-slate-600/80 transition-all duration-200 flex gap-3.5 shadow-sm hover:shadow-xl hover:shadow-black/30"
                >
                  {/* Poster Thumbnail */}
                  <MoviePoster
                    src={item.posterUrl}
                    title={item.title}
                    year={item.year}
                    platform={item.platform}
                    type={item.type === "movie" ? "movie" : "episode"}
                    className="w-16 sm:w-20 rounded-xl shadow-md border border-white/[0.08] shrink-0"
                  />

                  {/* Details */}
                  <div className="min-w-0 flex-1 flex flex-col justify-between space-y-2">
                    <div>
                      {/* Top Chips Row */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                            isLB
                              ? "bg-[#00E054]/10 border-[#00E054]/30 text-[#00E054]"
                              : isMAL
                              ? "bg-[#2E51A2]/20 border-[#2E51A2]/35 text-sky-300"
                              : "bg-red-500/10 border-red-500/30 text-red-300"
                          }`}
                        >
                          {isLB ? "Letterboxd" : isMAL ? "MyAnimeList" : "Trakt"}
                        </span>

                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50 uppercase tracking-wider">
                          {item.type}
                        </span>

                        {item.year && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] text-slate-300">
                            {item.year}
                          </span>
                        )}
                      </div>

                      {/* Title */}
                      <h4 className="text-sm font-bold text-white tracking-tight group-hover:text-amber-200 transition-colors line-clamp-1 mt-1.5">
                        {item.title}
                      </h4>

                      {/* Overview snippet or episode count */}
                      {item.overview ? (
                        <p className="text-[11px] text-slate-400 line-clamp-2 mt-1 leading-relaxed">
                          {item.overview}
                        </p>
                      ) : item.totalEpisodes ? (
                        <p className="text-[11px] text-slate-400 mt-1">
                          {item.totalEpisodes} episodes planned
                        </p>
                      ) : null}
                    </div>

                    {/* Bottom Metadata & Link */}
                    <div className="flex items-center justify-between pt-1 border-t border-white/[0.06] text-[11px]">
                      <div className="flex items-center gap-2">
                        {item.rating && (
                          <span className="inline-flex items-center gap-1 text-amber-300 font-semibold text-[11px]">
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                            {item.rating}
                          </span>
                        )}
                        {item.metadata?.imdbId && (
                          <span className="text-[10px] font-mono text-slate-500">
                            {item.metadata.imdbId}
                          </span>
                        )}
                      </div>

                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition-colors"
                        >
                          <span>Open</span>
                          <ArrowUpRight className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
