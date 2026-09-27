"use client";

import React, { useState, useEffect } from "react";
import {
  Key,
  X,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Clock,
  Sparkles,
  Info,
} from "lucide-react";
import { LetterboxdLogo } from "@/components/icons";

interface SessionInfo {
  hasSession: boolean;
  cookieCount: number;
  hasUserCookie: boolean;
  isExpired?: boolean;
  expiresAt: string | null;
  updatedAt: string | null;
  sessionJson?: string;
}

interface LetterboxdSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionUpdated?: () => void;
}

export default function LetterboxdSessionModal({
  isOpen,
  onClose,
  onSessionUpdated,
}: LetterboxdSessionModalProps) {
  const [cookieInput, setCookieInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [fetchingStatus, setFetchingStatus] = useState<boolean>(false);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState<boolean>(false);
  const [secretPayload, setSecretPayload] = useState<string | null>(null);

  const fetchStatus = async () => {
    setFetchingStatus(true);
    try {
      const res = await fetch("/api/auth/letterboxd/session?includePayload=true");
      if (res.ok) {
        const data = await res.json();
        setSessionInfo(data);
        if (data.sessionJson) {
          setSecretPayload(data.sessionJson);
        }
      }
    } catch (e) {
      console.warn("Failed to load session status:", e);
    } finally {
      setFetchingStatus(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
      setErrorMsg(null);
      setSuccessMsg(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cookieInput.trim()) return;

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch("/api/auth/letterboxd/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: cookieInput }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Failed to process cookies");
      } else {
        const expStr = data.expiresAt
          ? `valid until ${new Date(data.expiresAt).toLocaleDateString()}`
          : "ready for sync";
        setSuccessMsg(
          `Successfully saved ${data.cookieCount} cookies (${expStr})!`
        );
        setSecretPayload(data.gitHubSecretPayload);
        setCookieInput("");
        await fetchStatus();
        if (onSessionUpdated) onSessionUpdated();
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCopySecret = () => {
    if (secretPayload && typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(secretPayload);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-2xl rounded-2xl bg-[#0B0F19] border border-slate-800 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <Key className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white">
                  Letterboxd Cookie Session Manager
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                  Cookie-Editor / Extension
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Import exported cookies to keep cloud & local background sync authenticated.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Status Banner */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className={`h-3 w-3 rounded-full ${
                  sessionInfo?.hasSession && !sessionInfo.isExpired
                    ? "bg-emerald-400 animate-pulse"
                    : "bg-amber-400"
                }`}
              />
              <div>
                <p className="text-xs font-semibold text-white">
                  {sessionInfo?.hasSession && !sessionInfo.isExpired
                    ? `Active Session (${sessionInfo.cookieCount} Cookies)`
                    : sessionInfo?.isExpired
                    ? "Session Expired"
                    : "No Session Configured"}
                </p>
                <p className="text-[11px] text-slate-400">
                  {sessionInfo?.expiresAt
                    ? `Expires: ${new Date(sessionInfo.expiresAt).toLocaleDateString()} (${new Date(sessionInfo.expiresAt).toLocaleTimeString()})`
                    : "Paste extension cookies below to authenticate."}
                </p>
              </div>
            </div>

            <button
              onClick={fetchStatus}
              disabled={fetchingStatus}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors text-xs flex items-center gap-1.5"
              title="Refresh status"
            >
              <RefreshCw className={`h-3 w-3 ${fetchingStatus ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Feedback Banners */}
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-red-950/60 border border-red-800/80 text-red-200 text-xs flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Import Error</p>
                <p className="text-red-300/90 mt-0.5">{errorMsg}</p>
              </div>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-800/80 text-emerald-200 text-xs flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Session Synchronized</p>
                <p className="text-emerald-300/90 mt-0.5">{successMsg}</p>
              </div>
            </div>
          )}

          {/* Instructions Box */}
          <div className="p-4 rounded-xl bg-indigo-950/20 border border-indigo-800/30 text-xs text-slate-300 space-y-2">
            <p className="font-semibold text-indigo-300 flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" />
              How to export cookies in 30 seconds:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-slate-400 pl-1 leading-relaxed">
              <li>
                Open{" "}
                <a
                  href="https://letterboxd.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-400 hover:underline inline-flex items-center gap-0.5"
                >
                  letterboxd.com <ExternalLink className="h-2.5 w-2.5" />
                </a>{" "}
                in your browser (where you are logged in).
              </li>
              <li>
                Click your cookie extension (e.g.{" "}
                <span className="text-white font-medium">Cookie-Editor</span> or{" "}
                <span className="text-white font-medium">EditThisCookie</span>).
              </li>
              <li>
                Click <span className="text-emerald-300 font-semibold">Export</span> ➔{" "}
                <span className="text-emerald-300 font-semibold">Export as JSON</span>.
              </li>
              <li>Paste the copied text in the box below and click Save.</li>
            </ol>
          </div>

          {/* Form */}
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Paste Cookie JSON / Export Text:
              </label>
              <textarea
                rows={6}
                value={cookieInput}
                onChange={(e) => setCookieInput(e.target.value)}
                placeholder='[&#10;  {&#10;    "domain": ".letterboxd.com",&#10;    "name": "letterboxd.user",&#10;    "value": "...",&#10;    "expirationDate": 1822055627&#10;  }&#10;]'
                className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                type="submit"
                disabled={loading || !cookieInput.trim()}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50 shadow-md shadow-emerald-950/40"
              >
                <CheckCircle2 className="h-4 w-4" />
                {loading ? "Processing & Saving..." : "Import & Apply Session"}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              >
                Close
              </button>
            </div>
          </form>

          {/* 1-Click Copy for GitHub Secret */}
          {secretPayload && (
            <div className="p-4 rounded-xl bg-slate-900/90 border border-emerald-900/50 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    Cloud Sync Secret (GitHub Actions)
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Use this string for <code className="text-emerald-300">LETTERBOXD_SESSION_JSON</code> in your repo secrets.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleCopySecret}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    copiedSecret
                      ? "bg-emerald-500 text-white shadow-sm"
                      : "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                  }`}
                >
                  {copiedSecret ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy for GitHub</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
