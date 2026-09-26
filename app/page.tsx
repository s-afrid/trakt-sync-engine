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
} from "lucide-react";
import { TraktLogo, MalLogo, LetterboxdLogo } from "@/components/icons";

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
  timestamp: string;
}

export default function Dashboard() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncResult, setSyncResult] = useState<SyncRunResult | null>(null);
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
    }
  }, []);

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
        setErrorMsg(data.error || "Sync failed");
      } else {
        setSyncResult(data.results);
        await fetchStatus();
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-slate-800/80 gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-red-600 via-indigo-600 to-emerald-500 p-0.5">
                <div className="h-full w-full bg-[#0B0F19] rounded-[10px] flex items-center justify-center">
                  <RefreshCw className="h-5 w-5 text-indigo-400" />
                </div>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                Trakt Sync Engine
              </h1>
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Synchronize your watch history across Trakt.tv, MyAnimeList, and Letterboxd.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleTriggerSync}
              disabled={syncing || !status?.connected?.trakt}
              className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all shadow-lg ${
                syncing
                  ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                  : !status?.connected?.trakt
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                  : "bg-gradient-to-r from-red-600 to-indigo-600 hover:from-red-500 hover:to-indigo-500 text-white shadow-indigo-950/50"
              }`}
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Running Sync..." : "Run Sync Engine"}
            </button>
          </div>
        </div>

        {/* Global Error Banner */}
        {errorMsg && (
          <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-200 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
            <div className="text-sm flex-1">
              <p className="font-semibold">Notice</p>
              <p className="text-red-300/90 mt-0.5">{errorMsg}</p>
            </div>
            <button
              onClick={() => setErrorMsg(null)}
              className="text-xs text-red-400 hover:text-red-200"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Environment / Credentials Check Alert */}
        {status && (!status.envConfigured.trakt || !status.envConfigured.mal) && (
          <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-800/50 text-amber-200 flex items-start gap-3">
            <Settings className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold">Setup Credentials in .env</p>
              <p className="text-amber-300/80 mt-0.5">
                Missing API keys:{" "}
                {[
                  !status.envConfigured.trakt && "TRAKT_CLIENT_ID / SECRET",
                  !status.envConfigured.mal && "MAL_CLIENT_ID / SECRET",
                ]
                  .filter(Boolean)
                  .join(", ")}
                . Copy <code className="bg-amber-950/80 px-1 py-0.5 rounded text-amber-300">.env.example</code> to <code className="bg-amber-950/80 px-1 py-0.5 rounded text-amber-300">.env</code> and fill in your developer keys.
              </p>
            </div>
          </div>
        )}

        {/* 3 Main Connection Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* 1. Trakt Card */}
          <div className="p-6 rounded-2xl bg-[#0B0F19] border border-slate-800/80 hover:border-slate-700/80 transition-all flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-red-600/10 flex items-center justify-center border border-red-500/20">
                    <TraktLogo size={18} className="text-[#ED1C24]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Trakt.tv</h3>
                    <p className="text-xs text-slate-400">Primary Source</p>
                  </div>
                </div>
                {status?.connected?.trakt ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
                    <CheckCircle2 className="h-3 w-3" /> Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-400">
                    Disconnected
                  </span>
                )}
              </div>

              {status?.connected?.trakt && status.profiles.trakt && !showTraktInput ? (
                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/60 flex items-center gap-3.5">
                  <div className="relative shrink-0">
                    {status.profiles.trakt.avatar ? (
                      <img
                        src={`/api/proxy/image?url=${encodeURIComponent(status.profiles.trakt.avatar)}`}
                        alt={status.profiles.trakt.username}
                        referrerPolicy="no-referrer"
                        className="h-12 w-12 rounded-full border-2 border-red-500/60 object-cover shadow-md"
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
                      <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-red-600 to-red-800 text-white font-bold flex items-center justify-center border-2 border-red-500/50 shadow-md">
                        {status.profiles.trakt.username[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-[#ED1C24] p-0.5 border-2 border-[#0B0F19] flex items-center justify-center shadow">
                      <TraktLogo size={10} className="text-white" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {status.profiles.trakt.name || status.profiles.trakt.username}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      @{status.profiles.trakt.username}
                    </p>
                    <a
                      href={`https://trakt.tv/users/${status.profiles.trakt.username}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 font-medium mt-0.5 transition-colors"
                    >
                      View Profile
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSaveTraktUsername} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Trakt Username
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. your_username"
                      value={traktUsernameInput}
                      onChange={(e) => setTraktUsernameInput(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={traktSaving || !traktUsernameInput.trim()}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
                    >
                      {traktSaving ? "Connecting..." : status?.connected?.trakt ? "Save Changes" : "Connect Trakt"}
                    </button>
                    {showTraktInput && (
                      <button
                        type="button"
                        onClick={() => setShowTraktInput(false)}
                        className="px-3 py-2.5 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>

            <div className="pt-4 border-t border-slate-800/60">
              {status?.connected?.trakt ? (
                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setTraktUsernameInput(status.profiles.trakt?.username || "");
                      setShowTraktInput(!showTraktInput);
                    }}
                    className="text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {showTraktInput ? "Close Edit" : "Change Username"}
                  </button>
                  <a
                    href="/api/auth/trakt/authorize"
                    className="text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    Use OAuth
                  </a>
                </div>
              ) : (
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Keeps cinejoy connected</span>
                  <a
                    href="/api/auth/trakt/authorize"
                    className="text-red-400 hover:text-red-300 transition-colors"
                  >
                    Use OAuth
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* 2. MyAnimeList Card */}
          <div className="p-6 rounded-2xl bg-[#0B0F19] border border-slate-800/80 hover:border-slate-700/80 transition-all flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-blue-600/10 flex items-center justify-center border border-blue-500/20">
                    <MalLogo size={18} className="text-[#2E51A2]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">MyAnimeList</h3>
                    <p className="text-xs text-slate-400">Anime Sync</p>
                  </div>
                </div>
                {status?.connected?.mal ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
                    <CheckCircle2 className="h-3 w-3" /> Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-400">
                    Disconnected
                  </span>
                )}
              </div>

              {status?.connected?.mal && status.profiles.mal ? (
                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/60 flex items-center gap-3.5">
                  <div className="relative shrink-0">
                    {status.profiles.mal.picture ? (
                      <img
                        src={`/api/proxy/image?url=${encodeURIComponent(status.profiles.mal.picture)}`}
                        alt={status.profiles.mal.name}
                        referrerPolicy="no-referrer"
                        className="h-12 w-12 rounded-full border-2 border-blue-500/60 object-cover shadow-md"
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
                      <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-blue-700 to-indigo-800 text-white font-bold flex items-center justify-center border-2 border-blue-500/50 shadow-md">
                        {status.profiles.mal.name[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-[#2E51A2] p-0.5 border-2 border-[#0B0F19] flex items-center justify-center shadow">
                      <MalLogo size={10} className="text-white" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {status.profiles.mal.name}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      MAL ID: #{status.profiles.mal.id}
                    </p>
                    <a
                      href={`https://myanimelist.net/profile/${status.profiles.mal.name}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 font-medium mt-0.5 transition-colors"
                    >
                      View Profile
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400 leading-relaxed">
                  Connect your MAL profile via PKCE OAuth. Trakt watched anime progress will automatically update your MAL list.
                </p>
              )}
            </div>

            <div className="pt-6">
              {!status?.connected?.mal ? (
                <a
                  href="/api/auth/mal/authorize"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                >
                  Connect MAL
                  <ArrowRight className="h-4 w-4" />
                </a>
              ) : (
                <a
                  href="/api/auth/mal/authorize"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                >
                  Reconnect MAL
                </a>
              )}
            </div>
          </div>

          {/* 3. Letterboxd Card */}
          <div className="p-6 rounded-2xl bg-[#0B0F19] border border-slate-800/80 hover:border-slate-700/80 transition-all flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-emerald-600/10 flex items-center justify-center border border-emerald-500/20">
                    <LetterboxdLogo size={20} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Letterboxd</h3>
                    <p className="text-xs text-slate-400">CSV & RSS Sync</p>
                  </div>
                </div>
                {status?.connected?.letterboxd ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
                    <CheckCircle2 className="h-3 w-3" /> Linked
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-400">
                    Unlinked
                  </span>
                )}
              </div>

              {status?.connected?.letterboxd && status.profiles.letterboxd && !showLbInput ? (
                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/60 flex items-center gap-3.5">
                  <div className="relative shrink-0">
                    {status.profiles.letterboxd.avatar ? (
                      <img
                        src={`/api/proxy/image?url=${encodeURIComponent(status.profiles.letterboxd.avatar)}`}
                        alt={status.profiles.letterboxd.username}
                        referrerPolicy="no-referrer"
                        className="h-12 w-12 rounded-full border-2 border-emerald-500/60 object-cover shadow-md"
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
                          <span className="text-white font-bold text-xs leading-none">
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
                    <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-[#14181C] p-0.5 border-2 border-[#0B0F19] flex items-center justify-center shadow">
                      <LetterboxdLogo size={10} />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {status.profiles.letterboxd.displayName || status.profiles.letterboxd.username}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      @{status.profiles.letterboxd.username}
                    </p>
                    <a
                      href={`https://letterboxd.com/${status.profiles.letterboxd.username}/`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-medium mt-0.5 transition-colors"
                    >
                      View Profile
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSaveLetterboxd} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Letterboxd Username
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. christopher_nolan"
                      value={lbUsername}
                      onChange={(e) => setLbUsername(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-slate-400">
                        Profile Photo URL (optional)
                      </label>
                      <div className="flex items-center gap-2 text-[10px]">
                        {status?.profiles?.trakt?.avatar && (
                          <button
                            type="button"
                            onClick={() => setLbAvatarUrl(status.profiles.trakt!.avatar!)}
                            className="text-red-400 hover:text-red-300 underline"
                          >
                            Use Trakt Photo
                          </button>
                        )}
                        {status?.profiles?.mal?.picture && (
                          <button
                            type="button"
                            onClick={() => setLbAvatarUrl(status.profiles.mal!.picture!)}
                            className="text-blue-400 hover:text-blue-300 underline"
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
                      className="w-full px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={lbSaving || !lbUsername.trim()}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
                    >
                      {lbSaving ? "Saving..." : status?.connected?.letterboxd ? "Save Changes" : "Save Username"}
                    </button>
                    {showLbInput && (
                      <button
                        type="button"
                        onClick={() => setShowLbInput(false)}
                        className="px-3 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>

            <div className="pt-4 border-t border-slate-800/60">
              {status?.connected?.letterboxd ? (
                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setLbUsername(status.profiles.letterboxd?.username || "");
                      setLbAvatarUrl(status.profiles.letterboxd?.avatar || "");
                      setShowLbInput(!showLbInput);
                    }}
                    className="text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {showLbInput ? "Close Edit" : "Change Username / Photo"}
                  </button>
                  <span className="text-[11px] text-slate-500">1-Click CSV Ready</span>
                </div>
              ) : (
                <p className="text-[11px] text-slate-400">
                  Allows reading your Letterboxd RSS diary entries into Trakt.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Letterboxd 1-Click CSV Export Deck */}
        <div className="p-6 rounded-2xl bg-gradient-to-br from-[#0B0F19] to-[#0d1424] border border-slate-800/80">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <LetterboxdLogo size={22} />
                <h2 className="text-lg font-semibold text-white">
                  Letterboxd 1-Click Import Tool
                </h2>
              </div>
              <p className="text-sm text-slate-400 mt-1 max-w-2xl">
                Because Letterboxd lacks a public open-write API, this engine formats your entire Trakt movie history into standard Letterboxd import CSV files (with verified TMDB & IMDb IDs).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href="/api/export/letterboxd?type=watched"
                download
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow-lg shadow-emerald-950/50"
              >
                <Download className="h-4 w-4" />
                Download Watched CSV
              </a>
              <a
                href="/api/export/letterboxd?type=ratings"
                download
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              >
                <Download className="h-4 w-4" />
                Download Ratings CSV
              </a>
              <a
                href="https://letterboxd.com/import/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                Open Letterboxd Importer
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>

        {/* Live Sync Result Panel */}
        {syncResult && (
          <div className="p-6 rounded-2xl bg-[#0B0F19] border border-indigo-900/40 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                Sync Execution Report
              </h3>
              <span className="text-xs text-slate-400">
                {new Date(syncResult.timestamp).toLocaleTimeString()}
              </span>
            </div>

            {syncResult.anime && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <p className="text-xs text-slate-400">Trakt Shows Scanned</p>
                    <p className="text-lg font-bold text-white mt-1">
                      {syncResult.anime.totalTraktShows}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <p className="text-xs text-slate-400">Anime Identified</p>
                    <p className="text-lg font-bold text-indigo-400 mt-1">
                      {syncResult.anime.animeIdentified}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <p className="text-xs text-slate-400">MAL ID Matches</p>
                    <p className="text-lg font-bold text-emerald-400 mt-1">
                      {syncResult.anime.malMatchesFound}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <p className="text-xs text-slate-400">MAL Lists Updated</p>
                    <p className="text-lg font-bold text-white mt-1">
                      {syncResult.anime.malUpdatedCount}
                    </p>
                  </div>
                </div>

                {syncResult.anime.updatedTitles.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Updated Titles on MyAnimeList:
                    </p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {syncResult.anime.updatedTitles.map((t, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-900/60 border border-slate-800/60"
                        >
                          <span className="font-medium text-slate-200">{t.title}</span>
                          <span className="text-indigo-400">
                            Ep. {t.episodes} ({t.status})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Vercel Deployment Checklist */}
        <div className="p-6 rounded-2xl bg-[#0B0F19] border border-slate-800/80 space-y-4">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-indigo-400" />
            <h3 className="font-semibold text-white">Vercel Deployment Architecture</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-400">
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/60 space-y-2">
              <p className="font-medium text-slate-200 flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-emerald-400" /> 1. Vercel Cron
              </p>
              <p>
                Automated daily sync triggered at 04:00 UTC via <code className="text-indigo-300">vercel.json</code>.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/60 space-y-2">
              <p className="font-medium text-slate-200 flex items-center gap-1.5">
                <Database className="h-4 w-4 text-indigo-400" /> 2. Serverless Database
              </p>
              <p>
                Powered by Neon Serverless Postgres and Drizzle ORM for zero-cold-start performance.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/60 space-y-2">
              <p className="font-medium text-slate-200 flex items-center gap-1.5">
                <RefreshCw className="h-4 w-4 text-red-400" /> 3. ID Cross-Mapping
              </p>
              <p>
                Resolves TMDB/TVDB ↔ MAL IDs dynamically using community anime databases and fallback search.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
