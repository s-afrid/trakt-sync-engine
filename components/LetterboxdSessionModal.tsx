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
    <div className="fixed inset-0 z-50 bg-canvas/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="relative w-full max-w-2xl rounded-2xl bg-surface border border-edge shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-edge flex items-start sm:items-center justify-between bg-elevated/60 gap-3">
          <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-success/10 border border-success/30 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
              <Key className="h-4 w-4 sm:h-5 sm:w-5 text-success" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h3 className="text-sm sm:text-base font-semibold text-ink">
                  Letterboxd Cookie Session
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-success/15 text-success border border-success/25 shrink-0">
                  Cookie-Editor / Extension
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-ink-muted mt-0.5 leading-relaxed">
                Import exported cookies to keep cloud & local background sync authenticated.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-elevated transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto">
          {/* Status Banner */}
          <div className="p-4 rounded-xl bg-surface/60 border border-edge flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className={`h-3 w-3 rounded-full ${
                  sessionInfo?.hasSession && !sessionInfo.isExpired
                    ? "bg-success animate-pulse"
                    : "bg-accent"
                }`}
              />
              <div>
                <p className="text-xs font-semibold text-ink">
                  {sessionInfo?.hasSession && !sessionInfo.isExpired
                    ? `Active Session (${sessionInfo.cookieCount} Cookies)`
                    : sessionInfo?.isExpired
                    ? "Session Expired"
                    : "No Session Configured"}
                </p>
                <p className="text-[11px] text-ink-muted">
                  {sessionInfo?.expiresAt
                    ? `Expires: ${new Date(sessionInfo.expiresAt).toLocaleDateString()} (${new Date(sessionInfo.expiresAt).toLocaleTimeString()})`
                    : "Paste extension cookies below to authenticate."}
                </p>
              </div>
            </div>

            <button
              onClick={fetchStatus}
              disabled={fetchingStatus}
              className="p-2 rounded-lg bg-elevated hover:bg-raised text-ink-muted transition-colors text-xs flex items-center gap-1.5"
              title="Refresh status"
            >
              <RefreshCw className={`h-3 w-3 ${fetchingStatus ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Feedback Banners */}
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-danger/10 border border-danger/30 text-ink text-xs flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Import Error</p>
                <p className="text-danger/90 mt-0.5">{errorMsg}</p>
              </div>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 rounded-xl bg-success/10 border border-success/30 text-ink text-xs flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Session Synchronized</p>
                <p className="text-success/90 mt-0.5">{successMsg}</p>
              </div>
            </div>
          )}

          {/* Instructions Box */}
          <div className="p-4 rounded-xl bg-accent/10 border border-accent/30 text-xs text-ink-muted space-y-2">
            <p className="font-semibold text-accent flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" />
              How to export cookies in 30 seconds:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-ink-muted pl-1 leading-relaxed">
              <li>
                Open{" "}
                <a
                  href="https://letterboxd.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-success hover:underline inline-flex items-center gap-0.5"
                >
                  letterboxd.com <ExternalLink className="h-2.5 w-2.5" />
                </a>{" "}
                in your browser (where you are logged in).
              </li>
              <li>
                Click your cookie extension (e.g.{" "}
                <span className="text-ink font-medium">Cookie-Editor</span> or{" "}
                <span className="text-ink font-medium">EditThisCookie</span>).
              </li>
              <li>
                Click <span className="text-success font-semibold">Export</span> ➔{" "}
                <span className="text-success font-semibold">Export as JSON</span>.
              </li>
              <li>Paste the copied text in the box below and click Save.</li>
            </ol>
          </div>

          {/* Form */}
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1.5">
                Paste Cookie JSON / Export Text:
              </label>
              <textarea
                rows={6}
                value={cookieInput}
                onChange={(e) => setCookieInput(e.target.value)}
                placeholder='[&#10;  {&#10;    "domain": ".letterboxd.com",&#10;    "name": "letterboxd.user",&#10;    "value": "...",&#10;    "expirationDate": 1822055627&#10;  }&#10;]'
                className="w-full p-3 rounded-xl bg-canvas border border-edge font-mono text-xs text-ink placeholder-ink-subtle focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                type="submit"
                disabled={loading || !cookieInput.trim()}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-success hover:bg-success/85 text-canvas transition-colors disabled:opacity-50 shadow-md shadow-success/10"
              >
                <CheckCircle2 className="h-4 w-4" />
                {loading ? "Processing & Saving..." : "Import & Apply Session"}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-xs font-medium bg-elevated hover:bg-raised text-ink-muted transition-colors"
              >
                Close
              </button>
            </div>
          </form>

          {/* 1-Click Copy for GitHub Secret */}
          {secretPayload && (
            <div className="p-4 rounded-xl bg-elevated/60 border border-success/20 space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-ink flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-success" />
                    Cloud Sync Secret (GitHub Actions)
                  </p>
                  <p className="text-[11px] text-ink-muted">
                    Use this string for <code className="text-success">LETTERBOXD_SESSION_JSON</code> in your repo secrets.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleCopySecret}
                  className={`w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition-all ${
                    copiedSecret
                      ? "bg-success text-canvas shadow-sm"
                      : "bg-elevated hover:bg-raised text-ink border border-edge"
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
