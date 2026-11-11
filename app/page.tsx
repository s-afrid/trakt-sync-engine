"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUpRight, Check, CircleAlert, Clock3, Film, LoaderCircle, RefreshCw } from "lucide-react";

type Log = { id: string; title: string; status: string; itemsCount: number; createdAt: string; details?: string | null };
type DashboardData = {
  connected: { trakt: boolean; letterboxd: boolean };
  traktPublicMode: boolean;
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
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("error");
    if (authError) {
      setError(authError === "invalid_request"
        ? "Trakt rejected the OAuth request. Check the Trakt client ID and that the callback URL matches your Trakt app settings."
        : authError.replaceAll("+", " "));
    } else if (params.get("success") === "trakt_connected") {
      setMessage("Trakt is connected. Manual syncing is ready.");
    }
    if (authError || params.has("success")) window.history.replaceState({}, "", window.location.pathname);
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
  const traktPublicMode = data?.traktPublicMode;
  const lbConnected = data?.connected.letterboxd;
  const ready = Boolean(traktConnected && lbConnected && data?.setup.letterboxdAutomationConfigured && data?.setup.databaseConfigured);
  const scheduledReady = Boolean((traktConnected || traktPublicMode) && lbConnected && data?.setup.letterboxdAutomationConfigured && data?.setup.databaseConfigured && data?.setup.traktClientConfigured);
  const manualSyncHint = !data
    ? "Checking your connections…"
    : !traktConnected
      ? traktPublicMode ? "Connect Trakt with OAuth to run manually. Your public profile remains available to scheduled runs." : "Connect Trakt with OAuth to enable manual syncing."
      : !lbConnected ? "Add your Letterboxd username to choose the destination."
        : !data.setup.letterboxdAutomationConfigured ? "Add the Letterboxd automation credentials in Vercel project settings."
          : !data.setup.databaseConfigured ? "Add DATABASE_URL so sync progress can be saved."
            : "Checks new watches and retries unresolved movies.";

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
            <span className={`harbor-chip ${ready || scheduledReady ? "harbor-chip-success" : "harbor-chip-accent"}`}><span className="mr-2 inline-block h-2 w-2 rounded-full bg-current" />{ready ? "Manual sync ready" : scheduledReady ? "Scheduled sync ready" : "Setup needed"}</span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-edge bg-elevated p-5">
              <div className="mb-4 flex items-center justify-between"><span className="harbor-label">SOURCE</span><span className={`harbor-chip ${traktConnected ? "harbor-chip-success" : traktPublicMode ? "harbor-chip-accent" : ""}`}>{traktConnected ? "OAuth connected" : traktPublicMode ? "Public history" : "Not connected"}</span></div>
              <h2 className="text-xl font-semibold">Trakt</h2><p className="mt-1 min-h-6 text-sm text-ink-muted">{data?.profiles.trakt?.username ? `@${data.profiles.trakt.username}` : "Connect your account or set TRAKT_USERNAME for public history."}</p>
              {traktPublicMode && <p className="mt-2 text-xs leading-relaxed text-ink-muted">Scheduled sync can read this public profile. Connect with OAuth to enable the dashboard’s manual sync button or sync a private profile.</p>}
              <a className="harbor-btn-primary mt-5 inline-flex items-center gap-2" href="/api/auth/trakt/authorize">{traktConnected ? "Reconnect Trakt" : traktPublicMode ? "Connect for manual sync" : "Connect Trakt"}<ArrowUpRight size={15} /></a>
            </div>
            <div className="rounded-2xl border border-edge bg-elevated p-5">
              <div className="mb-4 flex items-center justify-between"><span className="harbor-label">DESTINATION</span><span className={`harbor-chip ${lbConnected ? "harbor-chip-success" : ""}`}>{lbConnected ? "Connected" : "Not connected"}</span></div>
              <h2 className="text-xl font-semibold">Letterboxd</h2><p className="mt-1 text-sm text-ink-muted">Add the username for the account you want to update.</p>
              <div className="mt-4 flex gap-2"><input aria-label="Letterboxd username" className="min-w-0 flex-1 rounded-xl border border-edge bg-surface px-3 py-2 text-sm outline-none focus:border-accent" value={letterboxdUsername} onChange={(e) => setLetterboxdUsername(e.target.value)} placeholder="username" /><button className="harbor-btn-ghost" disabled={saving || !letterboxdUsername.trim()} onClick={connectLetterboxd}>{saving ? <LoaderCircle className="animate-spin" size={16} /> : "Save"}</button></div>
              <p className="mt-3 text-xs text-ink-subtle">The server uses your configured Stremboxd/Letterboxd automation credentials to apply watched status.</p>
            </div>
          </div>

          <div className="relative mt-6 overflow-hidden rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/10 via-surface to-surface p-5 sm:p-6">
            <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-20 h-48 w-48 rounded-full bg-accent/10 blur-3xl" />
            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent"><RefreshCw size={19} /></span>
                <div>
                  <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Run a sync</h2><span className={`harbor-chip ${scheduledReady ? "harbor-chip-success" : ""}`}><span className={`h-1.5 w-1.5 rounded-full ${scheduledReady ? "bg-success" : "bg-ink-subtle"}`} />GitHub · every 15 min</span></div>
                  <p className="mt-1.5 max-w-xl text-sm text-ink-muted">{manualSyncHint}</p>
                  <p className={`mt-2 text-xs ${scheduledReady ? "text-success" : "text-ink-subtle"}`}>{scheduledReady ? "Scheduled sync is active" : "Scheduled sync needs setup"}</p>
                </div>
              </div>
              <button aria-label={busy ? "Syncing Trakt movies to Letterboxd" : "Sync Trakt movies to Letterboxd now"} aria-busy={busy} disabled={!ready || busy} onClick={runSync} className="harbor-btn-primary group min-h-12 w-full min-w-40 px-5 shadow-lg shadow-accent/15 sm:w-auto disabled:translate-y-0 disabled:bg-raised disabled:text-ink-subtle disabled:shadow-none">
                {busy ? <><LoaderCircle className="animate-spin" size={17} />Syncing…</> : <><RefreshCw className="transition-transform duration-500 group-hover:rotate-45" size={17} />Sync now</>}
              </button>
            </div>
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
