"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUpRight, Check, CircleAlert, Clock3, Film, LoaderCircle, RefreshCw } from "lucide-react";

type Log = { id: string; title: string; status: string; itemsCount: number; createdAt: string; details?: string | null };
type DashboardData = {
  connected: { trakt: boolean; letterboxd: boolean };
  profiles: { trakt: { username: string } | null; letterboxd: { username: string } | null };
  setup: { traktClientConfigured: boolean; letterboxdAutomationConfigured: boolean; databaseConfigured: boolean };
  recentRuns: Log[];
};

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [letterboxdUsername, setLetterboxdUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [showRuns, setShowRuns] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/sync/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load sync status.");
    const next = (await response.json()) as DashboardData;
    setData(next);
    setLetterboxdUsername((current) => current || next.profiles.letterboxd?.username || "");
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const timer = window.setInterval(() => refresh().catch((e) => setError(e.message)), 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function connectLetterboxd() {
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/auth/letterboxd/save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: letterboxdUsername }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save Letterboxd username.");
      setMessage("Letterboxd account saved."); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  async function runSync() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/sync/trigger", { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || result.results?.traktToLetterboxd?.errors?.join(" ") || "Sync did not complete.");
      const summary = result.results?.traktToLetterboxd;
      setMessage(summary ? `${summary.markedWatched} movie(s) marked watched${summary.pending ? ` · ${summary.pending} queued for the next run` : ""}${summary.errors?.length ? ` · ${summary.errors.length} issue(s) to retry` : ""}.` : "Sync completed.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }

  const traktConnected = data?.connected.trakt;
  const lbConnected = data?.connected.letterboxd;
  const ready = Boolean(traktConnected && lbConnected && data?.setup.letterboxdAutomationConfigured && data?.setup.databaseConfigured);

  return (
    <main className="min-h-screen bg-canvas px-5 py-10 text-ink sm:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-10 flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-3 no-underline">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-accent text-canvas"><Film size={21} /></span>
            <span><span className="block text-lg font-semibold tracking-tight">Trakt → Letterboxd</span><span className="text-sm text-ink-muted">Your movie watch history, kept in sync</span></span>
          </a>
          <a href="https://letterboxd.com" target="_blank" rel="noreferrer" aria-label="Open Letterboxd" className="harbor-btn-ghost hidden items-center gap-2 sm:inline-flex">Letterboxd <ArrowUpRight size={15} /></a>
        </header>

        <section className="harbor-card overflow-hidden p-6 sm:p-9">
          <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
            <div><p className="harbor-label mb-2">PERSONAL SYNC</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">One direction. Your movies.</h1><p className="mt-3 max-w-xl text-ink-muted">Newly watched movies on Trakt are marked watched on Letterboxd. Existing watchlist entries are removed after a successful sync.</p></div>
            <span className={`harbor-chip ${ready ? "harbor-chip-success" : "harbor-chip-accent"}`}><span className="mr-2 inline-block h-2 w-2 rounded-full bg-current" />{ready ? "Ready to sync" : "Setup needed"}</span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-edge bg-elevated p-5">
              <div className="mb-4 flex items-center justify-between"><span className="harbor-label">SOURCE</span><span className={`harbor-chip ${traktConnected ? "harbor-chip-success" : ""}`}>{traktConnected ? "Connected" : "Not connected"}</span></div>
              <h2 className="text-xl font-semibold">Trakt</h2><p className="mt-1 min-h-6 text-sm text-ink-muted">{data?.profiles.trakt?.username ? `@${data.profiles.trakt.username}` : "Authorize your Trakt account to read movie history."}</p>
              <a className="harbor-btn-primary mt-5 inline-flex items-center gap-2" href="/api/auth/trakt/authorize">{traktConnected ? "Reconnect Trakt" : "Connect Trakt"}<ArrowUpRight size={15} /></a>
            </div>
            <div className="rounded-2xl border border-edge bg-elevated p-5">
              <div className="mb-4 flex items-center justify-between"><span className="harbor-label">DESTINATION</span><span className={`harbor-chip ${lbConnected ? "harbor-chip-success" : ""}`}>{lbConnected ? "Connected" : "Not connected"}</span></div>
              <h2 className="text-xl font-semibold">Letterboxd</h2><p className="mt-1 text-sm text-ink-muted">Add the username for the account you want to update.</p>
              <div className="mt-4 flex gap-2"><input aria-label="Letterboxd username" className="min-w-0 flex-1 rounded-xl border border-edge bg-surface px-3 py-2 text-sm outline-none focus:border-accent" value={letterboxdUsername} onChange={(e) => setLetterboxdUsername(e.target.value)} placeholder="username" /><button className="harbor-btn-ghost" disabled={saving || !letterboxdUsername.trim()} onClick={connectLetterboxd}>{saving ? <LoaderCircle className="animate-spin" size={16} /> : "Save"}</button></div>
              <p className="mt-3 text-xs text-ink-subtle">The server uses your configured Stremboxd/Letterboxd automation credentials to apply watched status.</p>
            </div>
          </div>

          <div className="mt-6 flex flex-col items-start justify-between gap-4 rounded-2xl border border-edge bg-surface p-5 sm:flex-row sm:items-center">
            <div><div className="flex items-center gap-2 font-medium"><RefreshCw size={16} className="text-accent" />Sync Trakt movies now</div><p className="mt-1 text-sm text-ink-muted">Checks your watched history and retries movies that previously failed.</p></div>
            <button disabled={!ready || busy} onClick={runSync} className="harbor-btn-primary inline-flex min-w-36 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-45">{busy ? <><LoaderCircle className="animate-spin" size={16} />Syncing…</> : <><RefreshCw size={16} />Sync now</>}</button>
          </div>

          {(message || error) && <div role="status" className={`mt-4 flex items-start gap-2 rounded-xl p-3 text-sm ${error ? "bg-danger/10 text-red-300" : "bg-success/10 text-green-300"}`}>{error ? <CircleAlert size={17} className="mt-0.5 shrink-0" /> : <Check size={17} className="mt-0.5 shrink-0" />}{error || message}</div>}
          {!ready && <div className="mt-4 text-sm text-ink-muted">{!data?.setup.traktClientConfigured && <p>Set <code>TRAKT_CLIENT_ID</code> and <code>TRAKT_CLIENT_SECRET</code> in the deployment environment.</p>}{traktConnected && !data?.setup.letterboxdAutomationConfigured && <p>Set <code>STREMBOXD_USERNAME</code> and <code>STREMBOXD_PASSWORD</code> (or the corresponding Letterboxd credentials) in the server environment.</p>}</div>}
          {!data?.setup.databaseConfigured && <p className="mt-2 text-sm text-ink-muted">Configure <code>DATABASE_URL</code> so sync progress and run results persist between deployments.</p>}
        </section>

        <section className="mt-6 harbor-card p-5 sm:p-6">
          <button className="flex w-full items-center justify-between text-left" onClick={() => setShowRuns((value) => !value)} aria-expanded={showRuns}><span><span className="block font-semibold">Recent sync runs</span><span className="mt-1 block text-sm text-ink-muted">Successful, partial, and failed attempts for this account.</span></span>{showRuns ? <ArrowUpRight size={18} /> : <ArrowDown size={18} />}</button>
          {showRuns && <div className="mt-5 divide-y divide-edge">{data?.recentRuns.length ? data.recentRuns.map((run) => <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{run.title}</p><p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted"><Clock3 size={13} />{new Date(run.createdAt).toLocaleString()}</p></div><span className={`harbor-chip ${run.status === "success" ? "harbor-chip-success" : "harbor-chip-accent"}`}>{run.status} · {run.itemsCount} marked</span></div>) : <p className="py-4 text-sm text-ink-muted">No sync runs recorded yet.</p>}</div>}
        </section>
        <footer className="px-2 py-6 text-center text-xs text-ink-subtle">Trakt is the source of truth · Sync direction: Trakt → Letterboxd</footer>
      </div>
    </main>
  );
}
