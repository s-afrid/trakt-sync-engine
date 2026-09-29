#!/usr/bin/env python3
"""
Automated Letterboxd CSV Importer & 15-Minute Background Sync Engine
-------------------------------------------------------------------
Fetches watched movies or ratings from Trakt (merging real-time history scrobbles),
tracks synced state, logs into Letterboxd via Playwright, and imports entries automatically.

Usage:
  # One-time sync (opens browser, imports, auto-confirms)
  python scripts/automate_letterboxd_upload.py --auto-confirm

  # Recurring 15-minute automated sync (sleeps quietly unless a new movie is watched)
  python scripts/automate_letterboxd_upload.py --interval 15 --auto-confirm

  # Recurring headless background sync
  python scripts/automate_letterboxd_upload.py --interval 15 --auto-confirm --headless

  # Force full re-sync of all movies
  python scripts/automate_letterboxd_upload.py --force --auto-confirm
"""

import os
import sys
import time
import json
import argparse
from datetime import datetime
from pathlib import Path
import csv
import requests

# Fix Windows console cp1252 encoding for emojis and enable instant unbuffered flushing
if sys.platform == "win32":
    import io
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True, write_through=True)
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True, write_through=True)
    except Exception:
        pass

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
except ImportError:
    print("❌ Playwright is not installed in the current environment.")
    print("Run: pip install playwright requests && playwright install chromium")
    sys.exit(1)


def load_env_file():
    """Simple parser to load .env variables if not already set."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return

    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val


# Load .env file at startup
load_env_file()

ROOT_DIR = Path(__file__).resolve().parent.parent
STATE_FILE = ROOT_DIR / ".letterboxd_sync_state.json"
SESSION_FILE = ROOT_DIR / ".letterboxd_session.json"


def _push_session_to_github_secret(session_file: Path) -> None:
    """
    After a successful login, push the refreshed Playwright session JSON back
    to the LETTERBOXD_SESSION_JSON GitHub Actions secret so it never expires.

    Requires GH_TOKEN (or GITHUB_TOKEN) env var with repo secrets write scope,
    and GITHUB_REPOSITORY env var (set automatically in Actions as 'owner/repo').
    Silently no-ops if credentials are unavailable (e.g. local dev runs).
    """
    import base64
    token = os.getenv("GH_TOKEN") or os.getenv("GITHUB_TOKEN")
    repo  = os.getenv("GITHUB_REPOSITORY")   # e.g. "s-afrid/trakt-sync-engine"
    if not token or not repo:
        return  # not running in Actions with a token — skip silently

    try:
        session_text = session_file.read_text(encoding="utf-8").strip()
        if not session_text:
            return

        # Step 1: Fetch the repo's public key for secret encryption
        key_resp = requests.get(
            f"https://api.github.com/repos/{repo}/actions/secrets/public-key",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
            timeout=10,
        )
        key_resp.raise_for_status()
        key_data = key_resp.json()
        public_key_b64 = key_data["key"]
        key_id = key_data["key_id"]

        # Step 2: Encrypt the secret using libsodium (PyNaCl)
        try:
            from nacl import encoding, public as nacl_public
            pk = nacl_public.PublicKey(public_key_b64.encode("utf-8"), encoding.Base64Encoder)
            box = nacl_public.SealedBox(pk)
            encrypted = base64.b64encode(box.encrypt(session_text.encode("utf-8"))).decode("utf-8")
        except ImportError:
            # PyNaCl not installed — encode as plain base64 (won't decrypt correctly, skip)
            print("⚠️ PyNaCl not installed — skipping GitHub secret auto-update. Run: pip install PyNaCl")
            return

        # Step 3: PUT the encrypted value to the GitHub Secrets API
        put_resp = requests.put(
            f"https://api.github.com/repos/{repo}/actions/secrets/LETTERBOXD_SESSION_JSON",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
            json={"encrypted_value": encrypted, "key_id": key_id},
            timeout=10,
        )
        if put_resp.status_code in (201, 204):
            print("🔐 Auto-updated LETTERBOXD_SESSION_JSON secret with fresh session!")
        else:
            print(f"⚠️ Could not update GitHub secret: {put_resp.status_code} {put_resp.text[:120]}")
    except Exception as e:
        print(f"⚠️ GitHub secret auto-update skipped: {e}")


def load_sync_state() -> dict:
    """Loads previous sync state to avoid unnecessary duplicate browser runs."""
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_sync_state(state: dict):
    """Saves sync state to disk."""
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        print(f"⚠️ Failed to save sync state: {e}")


def fetch_from_trakt_direct(trakt_client_id: str, trakt_username: str, access_token: str = None) -> list:
    """
    Directly queries Trakt API, merging /watched and /history (captures real-time scrobbles like Mersal).
    """
    headers = {
        "Content-Type": "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": trakt_client_id,
        "User-Agent": "TraktSyncEngine/1.0",
    }
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    watched_url = (
        "https://api.trakt.tv/sync/watched/movies?extended=full"
        if access_token
        else f"https://api.trakt.tv/users/{trakt_username}/watched/movies?extended=full"
    )
    history_url = (
        "https://api.trakt.tv/sync/history/movies?limit=100"
        if access_token
        else f"https://api.trakt.tv/users/{trakt_username}/history/movies?limit=100"
    )

    watched = []
    try:
        w_res = requests.get(watched_url, headers=headers, timeout=25)
        if w_res.status_code == 200:
            watched = w_res.json()
    except Exception as e:
        print(f"⚠️ Error fetching watched movies: {e}")

    history = []
    try:
        h_res = requests.get(history_url, headers=headers, timeout=25)
        if h_res.status_code == 200:
            history = h_res.json()
    except Exception as e:
        print(f"⚠️ Error fetching history movies: {e}")

    movie_map = {}
    for w in watched:
        trakt_id = w.get("movie", {}).get("ids", {}).get("trakt")
        if trakt_id:
            movie_map[trakt_id] = w

    for h in history:
        m = h.get("movie", {})
        trakt_id = m.get("ids", {}).get("trakt")
        if not trakt_id:
            continue
        watched_at = h.get("watched_at")
        if trakt_id not in movie_map:
            movie_map[trakt_id] = {
                "plays": 1,
                "last_watched_at": watched_at,
                "last_updated_at": watched_at,
                "movie": m,
            }
        else:
            existing = movie_map[trakt_id]
            if watched_at and (not existing.get("last_watched_at") or watched_at > existing.get("last_watched_at")):
                existing["last_watched_at"] = watched_at
                existing["last_updated_at"] = watched_at

    return list(movie_map.values())


def generate_watched_csv(movies: list, target_path: Path) -> Path:
    """Generates standard Letterboxd import CSV with exact matching headers."""
    # Sort descending by watched date so the latest watches appear at top
    sorted_movies = sorted(
        movies,
        key=lambda m: m.get("last_watched_at") or "",
        reverse=True
    )

    target_path.parent.mkdir(parents=True, exist_ok=True)
    with open(target_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Title", "Year", "tmdbID", "imdbID", "WatchedDate"])
        for item in sorted_movies:
            m = item.get("movie", {})
            ids = m.get("ids", {})
            raw_date = item.get("last_watched_at")
            watched_date = raw_date[:10] if raw_date and len(raw_date) >= 10 else ""
            writer.writerow([
                m.get("title", ""),
                m.get("year", "") or "",
                ids.get("tmdb", "") or "",
                ids.get("imdb", "") or "",
                watched_date,
            ])
    return target_path


def download_csv_from_server(url: str, target_path: Path) -> Path:
    """Fetches CSV from the Trakt Sync Engine Next.js server."""
    print(f"📥 Contacting local server export route: {url}")
    target_path.parent.mkdir(parents=True, exist_ok=True)
    response = requests.get(url, timeout=25)

    if response.status_code == 200:
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            err_data = response.json()
            raise Exception(f"Export server returned error: {err_data.get('error', 'Unknown error')}")

        target_path.write_bytes(response.content)
        return target_path
    else:
        raise Exception(f"HTTP Status {response.status_code}: {response.text[:200]}")


def get_latest_movies_data(app_url: str, export_type: str, target_csv: Path) -> tuple[Path, list]:
    """
    Attempts to fetch movies via the Next.js server; if offline, seamlessly falls back
    to direct Trakt API calls. Returns (csv_path, movies_list).
    """
    trakt_client_id = os.getenv("TRAKT_CLIENT_ID", "").strip()
    trakt_username = os.getenv("TRAKT_USERNAME", "afsindbad").strip()

    # If watched movies type, direct Trakt API fetch guarantees real-time merging
    if trakt_client_id and trakt_username and export_type == "watched":
        try:
            movies = fetch_from_trakt_direct(trakt_client_id, trakt_username)
            if movies:
                generate_watched_csv(movies, target_csv)
                print(f"✅ Generated Letterboxd CSV directly from Trakt: {len(movies)} movies found.")
                return target_csv, movies
        except Exception as e:
            print(f"⚠️ Direct Trakt fetch error ({e}), attempting local server route...")

    # Fallback to server route (try app_url, then production Vercel app)
    candidate_urls = [f"{app_url}/api/export/letterboxd?type={export_type}"]
    prod_url = f"https://trakt-sync-engine.vercel.app/api/export/letterboxd?type={export_type}"
    if prod_url not in candidate_urls:
        candidate_urls.append(prod_url)

    for url in candidate_urls:
        try:
            csv_path = download_csv_from_server(url, target_csv)
            return csv_path, []
        except Exception:
            pass

    if target_csv.exists() and target_csv.stat().st_size > 0:
        print(f"📁 Using existing verified CSV file on disk: {target_csv.name}")
        return target_csv, []

    raise Exception("Could not fetch movies from Trakt or sync server, and no local CSV exists.")


def get_letterboxd_confirmed_tmdb_ids(lb_username: str) -> set:
    """Fetches Letterboxd's public RSS feed and returns confirmed TMDb IDs in the Diary."""
    if not lb_username:
        return set()
    try:
        import urllib.request
        import xml.etree.ElementTree as ET
        clean_user = lb_username.lower().strip()
        url = f"https://letterboxd.com/{clean_user}/rss/"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TraktSyncEngine/1.0"}
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            xml_data = resp.read()
        root = ET.fromstring(xml_data)
        tmdb_ids = set()
        for item in root.findall(".//item"):
            for child in item:
                if "movieId" in child.tag and child.text:
                    try:
                        tmdb_ids.add(int(child.text.strip()))
                    except ValueError:
                        pass
        return tmdb_ids
    except Exception as e:
        print(f"Notice: Could not query Letterboxd RSS feed ({e}). Falling back to local state diff.")
        return set()


def parse_proxy(raw_proxy: str) -> dict:
    """Parses any proxy format (URL, host:port:user:pass, or simple host:port) for Playwright."""
    raw_proxy = raw_proxy.strip()
    if not raw_proxy:
        return {}

    # Format 1: host:port:username:password (standard Webshare download list)
    parts = raw_proxy.split(":")
    if len(parts) == 4 and not raw_proxy.startswith("http"):
        host, port, user, pwd = parts
        return {
            "server": f"http://{host}:{port}",
            "username": user,
            "password": pwd,
        }

    # Format 2: http://user:pass@host:port or user:pass@host:port
    if "@" in raw_proxy:
        from urllib.parse import urlparse
        norm_url = raw_proxy if "://" in raw_proxy else f"http://{raw_proxy}"
        parsed = urlparse(norm_url)
        scheme = parsed.scheme or "http"
        port_str = f":{parsed.port}" if parsed.port else ""
        res = {"server": f"{scheme}://{parsed.hostname}{port_str}"}
        if parsed.username:
            res["username"] = parsed.username
        if parsed.password:
            res["password"] = parsed.password
        return res

    # Format 3: simple host:port or http://host:port
    if "://" not in raw_proxy:
        raw_proxy = f"http://{raw_proxy}"
    return {"server": raw_proxy}


def automate_letterboxd_upload(
    csv_path: Path,
    username: str,
    password: str,
    headless: bool = False,
    auto_confirm: bool = False,
    inspection_seconds: int = 15,
    cleanup_movies: list = None,
    job: str = "all",
) -> bool:
    """Launches Playwright to log in to Letterboxd and upload the CSV file."""
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV file not found at: {csv_path}")

    if csv_path.stat().st_size == 0:
        raise ValueError(f"CSV file at {csv_path} is empty.")

    print(f"📄 Preparing upload: {csv_path.name} ({csv_path.stat().st_size:,} bytes)")

    with sync_playwright() as p:
        print(f"🚀 Launching browser (headless={headless})...")
        launch_kwargs = {
            "headless": headless,
            "args": [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
            ],
        }
        proxy_raw = os.getenv("LETTERBOXD_PROXY")
        if proxy_raw:
            parsed_proxy = parse_proxy(proxy_raw)
            if parsed_proxy:
                launch_kwargs["proxy"] = parsed_proxy
                print(f"🌐 Routing browser via residential/cloud proxy ({parsed_proxy.get('server', 'configured')})...")

        browser = p.chromium.launch(**launch_kwargs)

        context_kwargs = {
            "viewport": {"width": 1280, "height": 850},
            "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        }

        # Check for session from environment variable (highest priority)
        session_env = os.getenv("LETTERBOXD_SESSION_JSON")
        if session_env and session_env.strip():
            try:
                SESSION_FILE.write_text(session_env.strip(), encoding="utf-8")
                print("💾 Loaded Letterboxd session from LETTERBOXD_SESSION_JSON secret.")
            except Exception:
                pass

        # Check if saved file is valid and contains user cookie
        has_valid_session_file = False
        if SESSION_FILE.exists():
            try:
                s_data = json.loads(SESSION_FILE.read_text(encoding="utf-8"))
                cookies = s_data.get("cookies", [])
                has_user_cookie = any(c.get("name") in ("letterboxd.user", "com.letterboxd.signed") for c in cookies)
                if has_user_cookie:
                    has_valid_session_file = True
            except Exception:
                has_valid_session_file = False

        # Fallback: check if server / Vercel database has a session
        if not has_valid_session_file:
            try:
                import urllib.request
                app_url = os.getenv("NEXT_PUBLIC_APP_URL", "https://trakt-sync-engine.vercel.app")
                req = urllib.request.Request(
                    f"{app_url}/api/auth/letterboxd/session?includePayload=true",
                    headers={"User-Agent": "TraktSyncEngine/1.0"}
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    s_json = json.loads(resp.read().decode("utf-8"))
                    if s_json.get("sessionJson"):
                        SESSION_FILE.write_text(s_json["sessionJson"], encoding="utf-8")
                        has_valid_session_file = True
                        print("💾 Loaded latest Letterboxd session from sync server database.")
            except Exception:
                pass

        # Restore saved browser session if available
        if SESSION_FILE.exists():
            try:
                context_kwargs["storage_state"] = str(SESSION_FILE)
                print("💾 Restoring saved Letterboxd session...")
            except Exception:
                pass

        context = browser.new_context(**context_kwargs)
        # Remove automation flag to bypass Cloudflare bot detection
        context.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
        page = context.new_page()

        # Apply stealth evasion hooks if available
        try:
            from playwright_stealth.stealth import Stealth
            Stealth().apply_stealth_sync(page)
            print("🛡️ Anti-detection stealth shield applied to browser context.")
        except Exception:
            pass

        # Step 1. Check Authentication
        print("🔐 Checking Letterboxd authentication state...")
        page.goto("https://letterboxd.com/import/", wait_until="commit", timeout=60000)
        try:
            page.wait_for_load_state("domcontentloaded", timeout=45000)
        except Exception:
            pass
        time.sleep(1)

        # Automated Cloudflare Turnstile handler
        def handle_turnstile_if_present(p_page, timeout_sec=45):
            """Engages automated Cloudflare Turnstile bypass by locating iframes,
            clicking checkboxes, or simulating mouse events on widget coordinates."""
            time.sleep(1)
            title = p_page.title()

            # Accurate detection: only trigger if an actual challenge indicator or iframe exists
            turnstile_detected = (
                "Just a moment..." in title
                or "Attention Required" in title
                or p_page.locator("iframe[src*='challenges.cloudflare.com'], div#cf-turnstile, dialog.turnstile-dialog, .cf-turnstile").count() > 0
            )
            if not turnstile_detected:
                return True

            print("⏳ Cloudflare Turnstile detected. Engaging automated stealth solver...")
            start_w = time.time()
            while time.time() - start_w < timeout_sec:
                cur_title = p_page.title()
                has_cf_widget = p_page.locator("iframe[src*='challenges.cloudflare.com'], div#cf-turnstile, dialog.turnstile-dialog").count() > 0
                if "Just a moment..." not in cur_title and "Attention Required" not in cur_title and not has_cf_widget:
                    print("✨ Cloudflare verification cleared!")
                    time.sleep(1)
                    return True

                # 1. Attempt frame click
                for f in p_page.frames:
                    if "challenges.cloudflare.com" in f.url:
                        try:
                            chk = f.locator("input[type='checkbox'], #challenge-stage, .ctp-checkbox-label, .mark, label.cb-lb, body")
                            if chk.count() > 0 and chk.first.is_visible():
                                chk.first.click(force=True)
                                time.sleep(2)
                                break
                        except Exception:
                            pass

                # 2. Coordinate click on iframe widget from parent page
                try:
                    iframe_el = p_page.locator("iframe[src*='challenges.cloudflare.com'], div#cf-turnstile iframe, div[id*='cf-'] iframe, dialog.turnstile-dialog iframe")
                    if iframe_el.count() > 0 and iframe_el.first.is_visible():
                        box = iframe_el.first.bounding_box()
                        if box:
                            p_page.mouse.click(box["x"] + 25, box["y"] + (box["height"] / 2))
                            time.sleep(2)
                except Exception:
                    pass

                time.sleep(1.5)

            cur_title = p_page.title()
            if "Just a moment..." not in cur_title and p_page.locator("iframe[src*='challenges.cloudflare.com']").count() == 0:
                print("✨ Cloudflare verification cleared!")
                return True

            print("⚠️ Cloudflare verification pending. Attempting to proceed...")
            return False

        handle_turnstile_if_present(page, timeout_sec=45)

        # Automated Watchlist Cleanup for newly watched movies
        def cleanup_letterboxd_watchlist(movies):
            """Opens a dedicated separate tab to check and untoggle Watchlist for newly watched movies.
            Keeps the import page completely untouched and open to prevent in-flight save aborts."""
            if not movies:
                return

            print(f"\n🧹 Checking Letterboxd Watchlist cleanup for {len(movies)} movie(s)...")
            p_page = None
            try:
                p_page = context.new_page()
                try:
                    from playwright_stealth.stealth import Stealth
                    Stealth().apply_stealth_sync(p_page)
                except Exception:
                    pass

                for m in movies:
                    movie_obj = m.get("movie", {}) if isinstance(m, dict) else {}
                    title = movie_obj.get("title", "Unknown")
                    tmdb_id = movie_obj.get("ids", {}).get("tmdb")
                    slug = movie_obj.get("ids", {}).get("slug")

                    if not tmdb_id and not slug:
                        print(f"⚠️ Skipping Watchlist check for '{title}' (no TMDb ID or slug available).")
                        continue

                    target_url = f"https://letterboxd.com/film/{slug}/" if slug else f"https://letterboxd.com/tmdb/{tmdb_id}/"
                    print(f"🔍 Navigating to Letterboxd page for '{title}': {target_url}...")

                    try:
                        p_page.goto(target_url, wait_until="domcontentloaded", timeout=25000)
                        time.sleep(2)

                        # Handle Cloudflare challenge if presented
                        handle_turnstile_if_present(p_page, timeout_sec=15)

                        # Wait for client-side injected (CSI) user action panel to finish loading
                        # Letterboxd renders user actions asynchronously via /csi/film/.../sidebar-user-actions/
                        try:
                            p_page.wait_for_selector(
                                "#userpanel .add-to-watchlist, #userpanel [data-action*='watchlist'], #userpanel a[href*='watchlist'], #userpanel .has-icon.icon-watchlist, #userpanel .action-watchlist, #userpanel button, #userpanel li.panel-sharing",
                                timeout=12000
                            )
                        except Exception:
                            try:
                                p_page.wait_for_load_state("networkidle", timeout=6000)
                            except Exception:
                                pass
                        time.sleep(1)

                        # Inspect and click the watchlist button if currently active
                        # IMPORTANT: Scope ONLY within #userpanel / .actions-panel to avoid navbar false-positives!
                        eval_res = p_page.evaluate("""async () => {
                            const panel = document.querySelector("#userpanel, .actions-panel, .js-actions-panel, aside.sidebar");
                            if (!panel) {
                                return { found: false, inWatchlist: false, reason: "no_panel" };
                            }

                            // Look exclusively inside the user actions panel
                            const candidates = [
                                panel.querySelector(".add-to-watchlist"),
                                panel.querySelector("a[data-action*='watchlist']"),
                                panel.querySelector("button[data-action*='watchlist']"),
                                panel.querySelector(".action-watchlist"),
                                panel.querySelector("a.has-icon.icon-watchlist"),
                                panel.querySelector("[data-track-action='Watchlist']"),
                                panel.querySelector("[data-action='watchlist']"),
                                panel.querySelector("a.watchlist-action")
                            ].filter(Boolean);

                            let btn = candidates[0] || null;

                            if (!btn) {
                                const allInPanel = Array.from(panel.querySelectorAll("a, button, span, li, div.action"));
                                for (const el of allInPanel) {
                                    const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                                    const title = (el.getAttribute('title') || el.getAttribute('aria-label') || '').toLowerCase();
                                    const cls = (el.className || '').toLowerCase();
                                    if (cls.includes('watchlist') || t === 'watchlist' || t === 'in watchlist' || title.includes('watchlist')) {
                                        btn = el;
                                        break;
                                    }
                                }
                            }

                            if (!btn) {
                                return { found: false, inWatchlist: false, reason: "button_not_in_panel" };
                            }

                            const classStr = ((btn.className || '') + ' ' + (btn.parentElement ? btn.parentElement.className || '' : '')).toLowerCase();
                            const titleStr = (btn.getAttribute('title') || btn.getAttribute('data-original-title') || btn.getAttribute('aria-label') || '').toLowerCase();
                            const textStr = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                            const stateAttr = (btn.getAttribute('data-action-state') || btn.getAttribute('data-state') || '').toLowerCase();
                            const ariaChecked = btn.getAttribute('aria-checked');

                            const isActive = classStr.includes('-active') ||
                                             classStr.includes(' active') ||
                                             classStr.includes('-watchlisted') ||
                                             classStr.includes('in-watchlist') ||
                                             titleStr.includes('remove') ||
                                             titleStr.includes('in your watchlist') ||
                                             textStr === 'in watchlist' ||
                                             ariaChecked === 'true' ||
                                             stateAttr === 'active';

                            if (isActive) {
                                // Instead of brittle DOM clicking, use internal AJAX endpoint via fetch
                                const poster = document.querySelector('.film-poster, [data-film-id]');
                                const filmId = poster ? poster.getAttribute('data-film-id') : null;
                                
                                const csrfInput = document.querySelector('input[name="__csrf"]');
                                const csrfToken = csrfInput ? csrfInput.value : (window.letterboxd_csrf || window.__letterboxd_csrf || '');

                                if (filmId) {
                                    try {
                                        const bodyData = 'action=remove-watchlist' + (csrfToken ? '&__csrf=' + encodeURIComponent(csrfToken) : '');
                                        // Some endpoints use /s/film/{id}/watchlist, others /csi/film/{id}/sidebar-actions/
                                        // The user requested /csi/film/id/sidebar-actions/ but Letterboxd's canonical action is often /s/film/...
                                        // We will try both to guarantee it is removed!
                                        
                                        const res = await fetch('/csi/film/' + filmId + '/sidebar-actions/', {
                                            method: 'POST',
                                            headers: {
                                                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                                                'X-Requested-With': 'XMLHttpRequest'
                                            },
                                            body: bodyData
                                        });
                                        
                                        await fetch('/s/film/' + filmId + '/watchlist', {
                                            method: 'POST',
                                            headers: {
                                                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                                                'X-Requested-With': 'XMLHttpRequest'
                                            },
                                            body: '__csrf=' + encodeURIComponent(csrfToken) + '&action=remove-watchlist'
                                        }).catch(e => {});

                                        return { found: true, inWatchlist: true, clicked: true, success: res.ok, method: "fetch", filmId: filmId };
                                    } catch (err) {
                                        // Fallback to click if fetch fails
                                        btn.click();
                                        return { found: true, inWatchlist: true, clicked: true, success: true, method: "click_fallback" };
                                    }
                                } else {
                                    // Fallback to click if no film ID is found
                                    btn.click();
                                    return { found: true, inWatchlist: true, clicked: true, success: true, method: "click_fallback_nofilm" };
                                }
                            }

                            return { found: true, inWatchlist: false };
                        }""")

                        if eval_res.get("clicked"):
                            print(f"🗑️ Untoggled Watchlist: '{title}' successfully removed from your Letterboxd Watchlist!")
                            time.sleep(2.5)
                        elif eval_res.get("inWatchlist"):
                            fallback_btn = p_page.locator("#userpanel .add-to-watchlist.-active, #userpanel a[data-action*='watchlist'].-active, #userpanel [title*='Remove from your watchlist'], #userpanel a.has-icon.icon-watchlist.-active").first
                            if fallback_btn.count() > 0:
                                fallback_btn.click(force=True, timeout=5000)
                                print(f"🗑️ Untoggled Watchlist (via locator fallback): '{title}' successfully removed from your Letterboxd Watchlist!")
                                time.sleep(2.5)
                        elif eval_res.get("found"):
                            print(f"ℹ️ '{title}' is not currently in your Watchlist (already clear).")
                        else:
                            print(f"⚠️ Could not locate Watchlist toggle in user action panel for '{title}' (reason: {eval_res.get('reason')}).")

                    except Exception as e:
                        print(f"⚠️ Watchlist cleanup skipped for '{title}': {e}")

            finally:
                if p_page:
                    try:
                        p_page.close()
                    except Exception:
                        pass


        # Wait up to 15 seconds for page elements to settle
        try:
            page.wait_for_selector(
                "input[type='file'], input[name='file'], .nav-account, a[href*='/Af_Sindbad/'], input#username, a.nav-link:has-text('Sign In')",
                timeout=15000
            )
        except Exception:
            pass

        # Check if already authenticated on import page
        is_authenticated = False
        try:
            is_signed_in = page.locator(".nav-account, .profile-avatar, a.avatar, a[href*='/Af_Sindbad/'], a[href*='/afsindbad/']").count() > 0
            has_file_input = page.locator("input[type='file'], input[name='file'], #upload-imdb-import").count() > 0

            if is_signed_in or (has_file_input and has_valid_session_file):
                is_authenticated = True
                print("🎉 Already authenticated via saved session!")
        except Exception:
            pass

        # If not authenticated, perform login
        if not is_authenticated:
            # If we had a valid session file, reload /import/ once after Turnstile before giving up to sign-in
            if has_valid_session_file:
                print("🔄 Session file present: refreshing /import/ to apply session cookies...")
                page.goto("https://letterboxd.com/import/", wait_until="commit", timeout=60000)
                time.sleep(2)
                handle_turnstile_if_present(page, timeout_sec=20)
                if page.locator("input[type='file'], .nav-account").count() > 0:
                    is_authenticated = True
                    print("🎉 Successfully authenticated after session refresh!")

        if not is_authenticated:
            print(f"🔑 Logging into Letterboxd account: {username}...")
            if "sign-in" not in page.url.lower():
                page.goto("https://letterboxd.com/sign-in/", wait_until="commit", timeout=60000)
                try:
                    page.wait_for_load_state("domcontentloaded", timeout=45000)
                except Exception:
                    pass
                time.sleep(2)

            handle_turnstile_if_present(page, timeout_sec=30)

            # Dismiss cookie consent if visible
            try:
                cookie_accept = page.locator("#onetrust-accept-btn-handler, button:has-text('Accept All'), button:has-text('Agree')")
                if cookie_accept.count() > 0 and cookie_accept.first.is_visible():
                    cookie_accept.first.click()
                    time.sleep(0.5)
            except Exception:
                pass

            # If sign-in toggle or dropdown exists, click it to reveal form
            try:
                sign_in_toggle = page.locator("a.nav-link:has-text('Sign In'), a[href*='sign-in'], a:has-text('Sign in')")
                if sign_in_toggle.count() > 0 and sign_in_toggle.first.is_visible():
                    sign_in_toggle.first.click()
                    time.sleep(1)
            except Exception:
                pass

            user_input = page.locator("input[name='username']:visible, input#field-username:visible, input#username:visible")
            if user_input.count() > 0 and user_input.first.is_visible():
                user_input.first.fill(username)
                pass_input = page.locator("input[name='password']:visible, input#field-password:visible, input#password:visible").first
                pass_input.fill(password)
                print("🚀 Submitting login form...")
                submit_btn = page.locator("input[type='submit']:visible, button[type='submit']:visible, .button.-action:visible").first
                submit_btn.click()
            else:
                # If element is in DOM but hidden inside header dropdown/modal, force fill via evaluate
                print("⚡ Filling login form via direct DOM dispatch...")
                page.evaluate(
                    """([u, p]) => {
                        const uInput = document.querySelector("input#username, input[name='username'], input#field-username");
                        const pInput = document.querySelector("input#password, input[name='password'], input#field-password");
                        if (uInput) {
                            uInput.value = u;
                            uInput.dispatchEvent(new Event('input', { bubbles: true }));
                            uInput.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                        if (pInput) {
                            pInput.value = p;
                            pInput.dispatchEvent(new Event('input', { bubbles: true }));
                            pInput.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                        const btn = document.querySelector("input[type='submit'], button[type='submit'], .button.-action, form.form-signin button");
                        if (btn) btn.click();
                        else {
                            const form = document.querySelector("form#signin, form.form-signin, form[action*='login']");
                            if (form) form.submit();
                        }
                    }""",
                    [username, password],
                )

            print("⏳ Awaiting login authentication...")
            login_success = False
            start_time = time.time()
            while time.time() - start_time < 30:
                if "sign-in" not in page.url.lower():
                    login_success = True
                    break

                error_el = page.locator(".message.-error, .form-row.-error, .message.error, .field-error")
                if error_el.count() > 0 and error_el.first.is_visible():
                    err_text = error_el.first.inner_text().strip()
                    browser.close()
                    raise Exception(f"Letterboxd login failed: {err_text}")

                time.sleep(0.8)

            if not login_success:
                browser.close()
                raise Exception("Letterboxd login timed out or challenge encountered. Run headed to resolve.")

            print("🎉 Successfully logged in!")
            # Save session for future runs
            try:
                context.storage_state(path=str(SESSION_FILE))
                print("💾 Saved session to .letterboxd_session.json for recurring headless sync.")

                # Auto-push fresh session back to GitHub Actions secret so it never expires
                _push_session_to_github_secret(SESSION_FILE)
            except Exception:
                pass

            page.goto("https://letterboxd.com/import/", wait_until="commit", timeout=60000)
            try:
                page.wait_for_load_state("domcontentloaded", timeout=45000)
            except Exception:
                pass
            time.sleep(2)
            # Clear Turnstile that may appear after post-login redirect to /import/
            handle_turnstile_if_present(page, timeout_sec=30)
            time.sleep(1)
        else:
            print("🎉 Already authenticated via saved session!")
            # Ensure we're on /import/ and Turnstile is cleared for authenticated sessions too
            if "/import" not in page.url:
                page.goto("https://letterboxd.com/import/", wait_until="commit", timeout=60000)
                try:
                    page.wait_for_load_state("domcontentloaded", timeout=45000)
                except Exception:
                    pass
                time.sleep(2)
            handle_turnstile_if_present(page, timeout_sec=30)
            time.sleep(1)

        # Job Check: If only doing login, exit now
        if job == "login":
            print("🏁 Login job completed successfully.")
            browser.close()
            return True

        # Job Check: If only doing cleanup, skip upload and confirmation
        if job == "cleanup":
            print("⏩ Job is 'cleanup'. Skipping file upload and proceeding directly to Watchlist Cleanup...")
            if cleanup_movies:
                cleanup_letterboxd_watchlist(cleanup_movies)
            else:
                print("ℹ️ No movies provided for watchlist cleanup.")
            browser.close()
            return True

        # Step 2. Handle File Upload
        print(f"🌐 Current page: {page.url} | Title: {page.title()}")

        # Fast-path: already on a /import/csv/ matching screen from a prior run — skip upload entirely
        if "/import/csv/" in page.url or page.locator("a.save-users-imported-imdb-history, a.submit-matched-films").count() > 0:
            print("✨ Already on matching screen — skipping file upload, proceeding directly to confirmation.")
        else:
            # Check for intermittent "Continue" prompt from any previously abandoned import
            try:
                continue_btn = page.locator("button:has-text('Continue'), a:has-text('Continue')").first
                if continue_btn.is_visible(timeout=2000):
                    print("🔄 Found previous unfinished import prompt, clicking 'Continue'...")
                    continue_btn.click()
                    time.sleep(1.5)
                    # After continuing, we may already be on the matching screen
                    if "/import/csv/" in page.url or page.locator("a.save-users-imported-imdb-history").count() > 0:
                        print("✨ Resumed previous import session — skipping file upload.")
                        # Jump to Step 3
                        pass
            except Exception:
                pass

            if "/import/csv/" not in page.url and page.locator("a.save-users-imported-imdb-history").count() == 0:
                print(f"📤 Uploading CSV file: {csv_path.name}...")

                # Strategy 1 (primary): Use Playwright's expect_file_chooser.
                # This is the correct native approach for AJAX-driven file inputs.
                # Letterboxd auto-uploads and redirects when a file is chosen — no form submit needed.
                upload_success = False
                try:
                    # Find the visible upload trigger (label, button, or dropzone)
                    trigger = page.locator(
                        "label[for='upload-imdb-import'], "
                        "label[for='csv-file'], "
                        "label[for='import-file'], "
                        "label.file-button, "
                        ".file-button-container label, "
                        ".file-button-container a, "
                        ".dropzone, "
                        "a.button:has-text('Choose'), "
                        "a.button:has-text('Select'), "
                        "a.button:has-text('Upload'), "
                        "input[type='file']"
                    ).first

                    with page.expect_file_chooser(timeout=10000) as fc_info:
                        trigger.click(force=True, timeout=8000)
                    fc_info.value.set_files(str(csv_path.resolve()))
                    print("⚡ File chosen via native file chooser!")
                    upload_success = True
                except Exception as e:
                    print(f"⚠️ File chooser strategy failed ({e}), trying direct input...")

                # Strategy 2 (fallback): set_input_files directly on attached input.
                # Letterboxd listens to 'change' and 'input' events on the file input.
                if not upload_success:
                    file_input_attached = False
                    try:
                        page.wait_for_selector("input[type='file']", state="attached", timeout=15000)
                        file_input_attached = True
                    except Exception:
                        pass

                    if file_input_attached:
                        try:
                            page.locator("input[type='file']").set_input_files(str(csv_path.resolve()))
                            # Dispatch both 'input' and 'change' events — Letterboxd may listen to either
                            page.evaluate("""() => {
                                const inp = document.querySelector("input[type='file']");
                                if (inp) {
                                    inp.dispatchEvent(new Event('input',  { bubbles: true }));
                                    inp.dispatchEvent(new Event('change', { bubbles: true }));
                                }
                            }""")
                            print("⚡ File set via direct input + events dispatched!")
                            upload_success = True
                        except Exception as e2:
                            print(f"❌ Direct set_input_files also failed: {e2}")
                            try:
                                page.screenshot(path=str(ROOT_DIR / "debug_upload_missing.png"))
                                print("📸 Debug screenshot saved: debug_upload_missing.png")
                            except Exception:
                                pass
                            raise
                    else:
                        print(f"❌ input[type='file'] not found after 15s. URL: {page.url} | Title: {page.title()}")
                        try:
                            page.screenshot(path=str(ROOT_DIR / "debug_upload_missing.png"))
                            print("📸 Debug screenshot saved: debug_upload_missing.png")
                        except Exception:
                            pass
                        raise TimeoutError("File input not found — Cloudflare or auth issue. Check debug_upload_missing.png")

        # Step 3. Wait for Letterboxd matching screen to render in-page
        # NOTE: Letterboxd does NOT redirect to /import/csv/<hash>/ — it renders the
        # matching summary on the SAME /import/ page via AJAX after file upload.
        print("⏳ Waiting for Letterboxd to process the upload and show the matching screen...")

        MATCH_SCREEN_SELECTOR = (
            "a.save-users-imported-imdb-history, "
            "a.submit-matched-films, "
            "strong:has-text('Matching complete'), "
            "h2:has-text('Import summary'), "
            ".import-summary, "
            "a:has-text('Import Titles'), "
            "a:has-text('Import Films')"
        )

        matching_screen_visible = False
        try:
            page.wait_for_selector(MATCH_SCREEN_SELECTOR, timeout=120000)
            matching_screen_visible = True
            print(f"✅ Matching screen ready! (URL: {page.url})")
        except PlaywrightTimeoutError:
            print(f"⚠️ Matching screen did not appear after 120s. URL: {page.url}")
            try:
                page.screenshot(path=str(ROOT_DIR / "debug_upload_stuck.png"))
                print("📸 Debug screenshot saved: debug_upload_stuck.png")
            except Exception:
                pass

        time.sleep(1)

        # Print new titles queued for import (import-specific selectors only)
        try:
            new_titles_info = page.evaluate("""() => {
                // Use import-specific containers to avoid picking up calendar/nav elements
                const rows = document.querySelectorAll(
                    ".import-summary li, .import-item, [class*='import'] .film-title, " +
                    "h3.title-1, .film-detail h2, td.title"
                );
                const titles = [];
                rows.forEach(row => {
                    const text = (row.innerText || '').trim();
                    if (text && text.length < 100) titles.push(text.split('\\n')[0]);
                });
                return titles.slice(0, 10);
            }""")
            if new_titles_info:
                print(f"🎬 Titles queued for Letterboxd import ({len(new_titles_info)}):")
                for t in new_titles_info:
                    print(f"   • {t}")
        except Exception:
            pass

        # Run automated Turnstile solver on the matching screen if it appeared
        handle_turnstile_if_present(page, timeout_sec=30)

        # Step 4. Final Confirmation
        success = False

        # Guard: only confirm when the matching screen DOM elements are visible
        confirm_btn_present = page.locator(
            "a.save-users-imported-imdb-history, a.submit-matched-films, "
            "a:has-text('Import Titles'), a:has-text('Import Films')"
        ).count() > 0

        if not matching_screen_visible and not confirm_btn_present:
            print(f"⛔ Matching screen not detected — skipping auto-confirm. Check debug_upload_stuck.png.")
            return False

        if auto_confirm:
            print(f"⚡ Auto-submitting import confirmation... (URL: {page.url} | Title: {page.title()})")
            try:
                # Solve turnstile once more if matching dialog presented a challenge
                handle_turnstile_if_present(page, timeout_sec=20)
                time.sleep(2)

                try:
                    page.screenshot(path=str(ROOT_DIR / "debug_matching.png"))
                except Exception:
                    pass

                # Strategy 1: Direct DOM dispatch via JavaScript (most reliable, bypasses hidden header overlays)
                click_result = page.evaluate("""() => {
                    // Close any modal dialogs/overlays that might block clicks
                    try {
                        const dialogs = document.querySelectorAll("dialog.turnstile-dialog, .dialog-modal, .backdrop");
                        for (const d of dialogs) {
                            if (typeof d.close === 'function') d.close();
                            d.style.display = 'none';
                        }
                    } catch (e) {}

                    // Priority 1: Letterboxd official import confirmation button classes
                    const primary = document.querySelector("a.save-users-imported-imdb-history, a.submit-matched-films, input.save-users-imported-imdb-history");
                    if (primary) {
                        try { primary.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (e) {}
                        // CLOUDFLARE FIX: Do NOT click the button directly if we can avoid it. 
                        // A button click triggers Letterboxd's jQuery AJAX submission which fails silently behind Cloudflare.
                        // Instead, try to submit the parent form natively. This forces a full-page POST navigation 
                        // that can render the Cloudflare challenge widget correctly!
                        const parentForm = primary.closest('form') || document.querySelector('form.import-step-2, form#imdb-form');
                        if (parentForm && typeof parentForm.submit === 'function') {
                            parentForm.submit();
                        } else if (parentForm) {
                            // If form.submit is shadowed by an input named 'submit'
                            HTMLFormElement.prototype.submit.call(parentForm);
                        } else {
                            primary.click();
                        }
                        return { clicked: true, text: (primary.innerText || primary.value || '').trim(), method: "primary_class_native_submit" };
                    }

                    // Priority 2: Check all visible clickable elements for matching keywords
                    const candidates = Array.from(document.querySelectorAll("a, button, input[type='submit'], input[type='button']"));
                    for (const el of candidates) {
                        const style = window.getComputedStyle(el);
                        const isVisible = el.offsetParent !== null && style.display !== 'none' && style.visibility !== 'hidden';
                        if (!isVisible) continue;

                        const text = (el.innerText || el.value || el.textContent || "").trim();
                        const lower = text.toLowerCase();
                        if (
                            lower === "import titles" ||
                            lower === "import films" ||
                            lower === "start import" ||
                            lower === "save to account" ||
                            lower.startsWith("import ") ||
                            el.classList.contains("save-users-imported-imdb-history") ||
                            el.classList.contains("submit-matched-films")
                        ) {
                            try { el.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (e) {}
                            el.click();
                            return { clicked: true, text: text, method: "keyword_match" };
                        }
                    }

                    // Priority 3: Form submit inside import-step-2
                    const formSubmit = document.querySelector("form.import-step-2 input[type='submit'], form.import-step-2 button, form#imdb-form input[type='submit']");
                    if (formSubmit) {
                        formSubmit.click();
                        return { clicked: true, text: (formSubmit.innerText || formSubmit.value || '').trim(), method: "form_submit" };
                    }

                    return { clicked: false };
                }""")

                if click_result and click_result.get("clicked"):
                    print(f"✅ Clicked final import button via direct DOM dispatch ({click_result.get('method')}: '{click_result.get('text')}')!")
                else:
                    # Strategy 2: Playwright locator fallback (only targeting visible elements)
                    visible_btn = page.locator(
                        "a.save-users-imported-imdb-history:visible, "
                        "a.submit-matched-films:visible, "
                        "a:visible:has-text('Import Titles'), "
                        "a:visible:has-text('Import Films'), "
                        "input[value*='Import']:visible, "
                        "a.save-users-imported-imdb-history, "
                        "a.submit-matched-films"
                    ).first

                    if visible_btn.count() > 0:
                        try:
                            visible_btn.scroll_into_view_if_needed(timeout=3000)
                        except Exception:
                            pass
                        visible_btn.click(force=True, timeout=8000)
                        print("✅ Clicked final import button via Playwright force click!")
                    else:
                        print("⚠️ Import button not found on matching screen.")

                # Wait for save/success confirmation on the main import page
                print("⏳ Waiting for Letterboxd to finish processing and saving import...")
                save_confirmed = False
                wait_start = time.time()
                while time.time() - wait_start < 40:
                    # Solve any Turnstile challenges that pop up mid-submission!
                    try:
                        handle_turnstile_if_present(page, timeout_sec=5)
                    except Exception:
                        pass

                    cur_url = page.url
                    # Check if Letterboxd navigated to import summary, diary, or user page
                    if "/import/csv/" not in cur_url and ("letterboxd.com/import" in cur_url or "diary" in cur_url or "films" in cur_url):
                        print(f"🎉 Import verified: Letterboxd successfully saved the films! (Destination: {cur_url})")
                        save_confirmed = True
                        break

                    # Check DOM for success banners or completion indicators
                    status_info = page.evaluate("""() => {
                        const txt = (document.body.innerText || '').toLowerCase();
                        const primaryBtn = document.querySelector("a.save-users-imported-imdb-history, a.submit-matched-films, input.save-users-imported-imdb-history");
                        const btnText = primaryBtn ? (primaryBtn.innerText || primaryBtn.value || '').trim() : '';
                        const isSuccessBanner = document.querySelector(".message.-success, .alert-success, .import-report") !== null;
                        
                        if (isSuccessBanner || txt.includes("import complete") || txt.includes("films imported") || txt.includes("successfully imported")) {
                            return { done: true, reason: "success_element" };
                        }
                        if (primaryBtn && !btnText.includes("Saving") && !btnText.includes("saving") && (btnText.includes("Saved") || btnText.includes("Complete"))) {
                            return { done: true, reason: "button_saved" };
                        }
                        return { done: false, btnText: btnText };
                    }""")

                    if status_info.get("done"):
                        print(f"🎉 Import verified: Letterboxd finished saving! ({status_info.get('reason')})")
                        save_confirmed = True
                        break

                    time.sleep(2)

                if not save_confirmed:
                    print("⚠️ Save request timed out! Letterboxd got stuck on 'Saving...' due to a silent Cloudflare block or server error.")
                    print("❌ Import failed.")
                    success = False
                else:
                    success = True

                # Step 5: Automated Watchlist Cleanup for newly watched movies (runs in dedicated separate tab)
                if cleanup_movies and job == "all":
                    cleanup_letterboxd_watchlist(cleanup_movies)
            except Exception as e:
                print(f"⚠️ Could not auto-click import button: {e}")
        else:
            print("\n🏁 Automation reached the confirmation screen.")
            print("👉 Please review the browser window, then click 'Import' manually.")
            success = True

        if inspection_seconds > 0:
            print(f"👀 Waiting {inspection_seconds}s for operations to settle...")
            try:
                time.sleep(inspection_seconds)
            except KeyboardInterrupt:
                pass

        browser.close()
        print("🎉 Browser session closed.")
        return success


def run_sync_cycle(args, username: str, password: str, csv_path: Path) -> bool:
    """Executes a single check and import cycle."""
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    base_app_url = (args.app_url or os.getenv("NEXT_PUBLIC_APP_URL", "http://localhost:3000")).rstrip("/")
    state = load_sync_state()
    synced_ids = set(state.get("synced_movie_ids", []))
    latest_watched_timestamp = state.get("latest_watched_at")

    # 1. Trigger MAL Anime Sync automatically via sync engine
    sync_endpoints = []
    if base_app_url:
        sync_endpoints.append(f"{base_app_url}/api/sync/trigger")
    prod_endpoint = "https://trakt-sync-engine.vercel.app/api/sync/trigger"
    if prod_endpoint not in sync_endpoints:
        sync_endpoints.append(prod_endpoint)

    for endpoint in sync_endpoints:
        try:
            sync_res = requests.post(endpoint, timeout=30)
            if sync_res.status_code == 200:
                data = sync_res.json()
                anime_res = data.get("results", {}).get("anime", {})
                updated = anime_res.get("malUpdatedCount", 0)
                if updated > 0:
                    titles = [t["title"] for t in anime_res.get("updatedTitles", [])]
                    print(f"[{now_str}] 🌸 Anime Sync: Updated {updated} title(s) on MAL: {', '.join(titles)}")
                else:
                    print(f"[{now_str}] 🌸 Anime Sync: MAL is already up to date.")
                break
        except Exception:
            continue

    # 2. Check Trakt movie history for Letterboxd
    print(f"[{now_str}] 🔍 Checking Trakt movie watch history...")
    _, movies = get_latest_movies_data(base_app_url, args.type, csv_path)

    if not movies:
        print(f"[{now_str}] ⚠️ Could not fetch movie objects list. Proceeding with CSV file upload...")
        uploaded = automate_letterboxd_upload(
            csv_path=csv_path,
            username=username,
            password=password,
            headless=args.headless,
            auto_confirm=args.auto_confirm,
            inspection_seconds=3 if (args.auto_confirm and args.interval) else args.keep_open,
        )
        return uploaded

    # Check for new movies
    current_movie_map = {m["movie"]["ids"]["trakt"]: m for m in movies if m.get("movie", {}).get("ids", {}).get("trakt")}
    current_ids = set(current_movie_map.keys())

    # Find movies not yet recorded in state
    new_ids = current_ids - synced_ids
    new_movies = [current_movie_map[mid] for mid in new_ids]

    # Cross-reference with live Letterboxd Diary RSS feed
    # If any movie in Trakt watch history is not yet confirmed in the Letterboxd Diary,
    # it must be treated as pending and included in the sync queue!
    lb_confirmed_tmdb_ids = get_letterboxd_confirmed_tmdb_ids(username)
    unconfirmed_movies = []
    if lb_confirmed_tmdb_ids:
        for m in movies:
            tmdb_id = m.get("movie", {}).get("ids", {}).get("tmdb")
            if tmdb_id and int(tmdb_id) not in lb_confirmed_tmdb_ids:
                unconfirmed_movies.append(m)

    if unconfirmed_movies:
        unconfirmed_titles = [m.get("movie", {}).get("title") for m in unconfirmed_movies]
        print(f"[{now_str}] 🔄 Unconfirmed Movie(s) in Letterboxd Diary: {', '.join(unconfirmed_titles)}. Adding to sync queue.")
        for um in unconfirmed_movies:
            if um not in new_movies:
                new_movies.append(um)

    # Find latest watched timestamp from current movies
    max_watched_at = max(
        (m.get("last_watched_at") or "" for m in movies),
        default=""
    )

    is_first_run = len(synced_ids) == 0
    has_new_watches = len(new_movies) > 0 or (max_watched_at and max_watched_at > (latest_watched_timestamp or ""))

    if not has_new_watches and not args.force:
        latest_title = movies[0]["movie"]["title"] if movies else "None"
        print(f"[{now_str}] ⏱️ Trakt is up to date (Latest: '{latest_title}'). No new watches since last sync.")

        # Notify app database of the verified quiet sleep check
        report_urls = []
        if base_app_url:
            report_urls.append(f"{base_app_url}/api/sync/report")
        if "https://trakt-sync-engine.vercel.app/api/sync/report" not in report_urls:
            report_urls.append("https://trakt-sync-engine.vercel.app/api/sync/report")

        quiet_payload = {
            "status": "success",
            "type": "quiet_check",
            "title": f"Quiet Check: Trakt up to date (Latest: '{latest_title}')",
            "itemsCount": 0,
            "details": {
                "latestMovie": latest_title,
                "latestWatchedAt": max_watched_at,
                "runtime": "github_actions" if os.getenv("GITHUB_ACTIONS") else "local_daemon",
                "runId": os.getenv("GITHUB_RUN_ID", "local"),
                "timestamp": now_str,
                "syncedTitles": [m.get("movie", {}).get("title") for m in movies[:2]],
            },
        }
        for r_url in report_urls:
            try:
                requests.post(r_url, json=quiet_payload, timeout=8)
                break
            except Exception:
                pass

        return False

    if args.force:
        print(f"[{now_str}] ⚡ Force flag active: Uploading full movie catalog ({len(movies)} movies)...")
        upload_movies = movies
    elif is_first_run:
        print(f"[{now_str}] 🌟 Initial sync: Uploading complete watch history ({len(movies)} movies)...")
        upload_movies = movies
    else:
        titles_preview = ", ".join(f"'{m['movie']['title']}'" for m in new_movies[:3])
        print(f"[{now_str}] 🎬 Detected {len(new_movies)} new watched movie(s): {titles_preview}")
        # When incremental, upload all movies to ensure Diary consistency, or the new subset
        upload_movies = movies

    # Generate fresh CSV
    generate_watched_csv(upload_movies, csv_path)

    # Determine newly watched movies to clean up from Letterboxd Watchlist
    cleanup_candidates = new_movies
    if not cleanup_candidates:
        # If running as an isolated --job cleanup after state was already saved, retrieve the targeted batch
        last_synced = state.get("last_synced_movies", [])
        if last_synced:
            cleanup_candidates = [m for m in movies if m.get("movie", {}).get("ids", {}).get("tmdb") in last_synced]
        if not cleanup_candidates:
            cleanup_candidates = movies[:1] if movies else []

    # Perform upload
    success = automate_letterboxd_upload(
        csv_path=csv_path,
        username=username,
        password=password,
        headless=args.headless,
        auto_confirm=args.auto_confirm,
        inspection_seconds=3 if (args.auto_confirm and args.interval) else args.keep_open,
        cleanup_movies=cleanup_candidates if ((args.auto_confirm or getattr(args, "job", "all") == "cleanup") and getattr(args, "cleanup_watchlist", True)) else None,
        job=getattr(args, "job", "all")
    )

    if success:
        # Update sync state
        state["synced_movie_ids"] = list(current_ids)
        state["latest_watched_at"] = max_watched_at
        state["last_sync_time"] = datetime.now().isoformat()
        state["total_synced"] = len(current_ids)
        if cleanup_candidates:
            state["last_synced_movies"] = [m.get("movie", {}).get("ids", {}).get("tmdb") for m in cleanup_candidates]
        save_sync_state(state)
        print(f"[{now_str}] ✅ State saved: {len(current_ids)} movies tracked.")

        # Notify Vercel app database of the successful cloud execution
        report_urls = []
        if base_app_url:
            report_urls.append(f"{base_app_url}/api/sync/report")
        if "https://trakt-sync-engine.vercel.app/api/sync/report" not in report_urls:
            report_urls.append("https://trakt-sync-engine.vercel.app/api/sync/report")

        report_payload = {
            "status": "success",
            "type": "letterboxd_import",
            "title": f"Auto-imported {len(upload_movies)} movies to Letterboxd",
            "itemsCount": len(upload_movies),
            "details": {
                "uploadedMovies": len(upload_movies),
                "syncedTitles": [m.get("movie", {}).get("title") for m in upload_movies[:10]],
                "runtime": "github_actions" if os.getenv("GITHUB_ACTIONS") else "local_daemon",
                "runId": os.getenv("GITHUB_RUN_ID", "local"),
                "timestamp": now_str,
            },
        }
        for r_url in report_urls:
            try:
                requests.post(r_url, json=report_payload, timeout=10)
                break
            except Exception:
                pass

    return success


def main():
    parser = argparse.ArgumentParser(description="Automate Letterboxd CSV Import & 15-Minute Sync Engine")
    parser.add_argument(
        "--type",
        choices=["watched", "ratings"],
        default="watched",
        help="Export type: 'watched' (default) or 'ratings'",
    )
    parser.add_argument(
        "--file",
        type=str,
        default=None,
        help="Path to an existing CSV file on disk",
    )
    parser.add_argument(
        "--url",
        type=str,
        default=None,
        help="Custom URL to fetch export CSV from",
    )
    parser.add_argument(
        "--app-url",
        type=str,
        default=None,
        help="Base URL of Trakt Sync Engine (defaults to http://localhost:3000)",
    )
    parser.add_argument(
        "--username",
        type=str,
        default=None,
        help="Letterboxd username (defaults to LETTERBOXD_USERNAME in .env)",
    )
    parser.add_argument(
        "--password",
        type=str,
        default=None,
        help="Letterboxd password (defaults to LETTERBOXD_PASSWORD in .env)",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        default=False,
        help="Run browser in headless mode",
    )
    parser.add_argument(
        "--auto-confirm",
        action="store_true",
        default=False,
        help="Automatically click the final green 'Import' button",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=None,
        help="Run recurring automated sync every N minutes (e.g. --interval 15)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        default=False,
        help="Force upload even if no new movies detected since last sync",
    )
    parser.add_argument(
        "--keep-open",
        type=int,
        default=15,
        help="Seconds to keep browser open after upload for inspection (default: 15s)",
    )
    parser.add_argument(
        "--cleanup-watchlist",
        action="store_true",
        default=True,
        help="Automatically remove newly watched movies from Letterboxd Watchlist (default: True)",
    )
    parser.add_argument(
        "--no-cleanup-watchlist",
        dest="cleanup_watchlist",
        action="store_false",
        help="Disable automatic Watchlist cleanup",
    )
    parser.add_argument(
        "--job",
        choices=["all", "login", "upload", "cleanup"],
        default="all",
        help="Run specific stages: 'login' (auth only), 'upload' (import only), 'cleanup' (watchlist only), or 'all' (default).",
    )

    args = parser.parse_args()

    # Determine credentials
    username = args.username or os.getenv("LETTERBOXD_USERNAME")
    password = args.password or os.getenv("LETTERBOXD_PASSWORD")

    if not username:
        print("❌ Missing Letterboxd Username. Configure LETTERBOXD_USERNAME in .env or pass --username <user>")
        sys.exit(1)

    if not password:
        print("❌ Missing Letterboxd Password. Configure LETTERBOXD_PASSWORD in .env or pass --password <pass>")
        sys.exit(1)

    # When running on interval, auto-confirm is enabled by default
    if args.interval and not args.auto_confirm:
        args.auto_confirm = True

    csv_path = Path(args.file).resolve() if args.file else ROOT_DIR / f"letterboxd_{args.type}_import.csv"

    # Single Execution Mode
    if not args.interval:
        run_sync_cycle(args, username, password, csv_path)
        return

    # Recurring Interval Mode (e.g. 15 minutes)
    interval_seconds = max(args.interval * 60, 60)
    print(f"⏰ Starting Letterboxd Background Sync Engine (interval: {args.interval} minutes)")
    print("Press Ctrl+C to terminate the sync scheduler at any time.\n")

    cycle_count = 0
    try:
        while True:
            cycle_count += 1
            print(f"--- [Cycle #{cycle_count}] ---")
            try:
                run_sync_cycle(args, username, password, csv_path)
            except Exception as e:
                print(f"⚠️ Error during sync cycle #{cycle_count}: {e}")

            next_run = datetime.fromtimestamp(time.time() + interval_seconds).strftime("%H:%M:%S")
            print(f"💤 Sleeping for {args.interval} minutes... Next check at {next_run}.\n")
            time.sleep(interval_seconds)
    except KeyboardInterrupt:
        print("\n👋 Letterboxd Background Sync stopped by user.")
        sys.exit(0)


if __name__ == "__main__":
    main()
