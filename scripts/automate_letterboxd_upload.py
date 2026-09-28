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
            if "Just a moment..." not in title and (
                "Letterboxd" in title
                or p_page.locator("input[type='file'], .nav-account, a.avatar, form#imdb-form, a.save-users-imported-imdb-history").count() > 0
            ):
                return True

            turnstile_detected = (
                "challenges.cloudflare.com" in p_page.content()
                or "Just a moment..." in title
                or p_page.locator("iframe[src*='challenges.cloudflare.com'], div#cf-turnstile, dialog.turnstile-dialog").count() > 0
            )
            if not turnstile_detected:
                return True

            print("⏳ Cloudflare Turnstile detected. Engaging automated stealth solver...")
            start_w = time.time()
            while time.time() - start_w < timeout_sec:
                # Check if challenge cleared
                cur_title = p_page.title()
                if "Just a moment..." not in cur_title and (
                    "Letterboxd" in cur_title
                    or p_page.locator("input[type='file'], .nav-account, a.avatar, form#imdb-form, a.save-users-imported-imdb-history").count() > 0
                ):
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
            if "Just a moment..." not in cur_title:
                print("✨ Cloudflare verification cleared!")
                return True

            print("⚠️ Cloudflare verification pending. Attempting to proceed...")
            return False

        handle_turnstile_if_present(page, timeout_sec=45)

        # Automated Watchlist Cleanup for newly watched movies
        def cleanup_letterboxd_watchlist(p_page, movies):
            """Navigates to the Letterboxd page for newly watched movies (via TMDb redirect),
            checks if the movie is currently active in the user's Watchlist, and untoggles it."""
            if not movies:
                return

            print(f"\n🧹 Checking Letterboxd Watchlist cleanup for {len(movies)} movie(s)...")
            for m in movies:
                movie_obj = m.get("movie", {}) if isinstance(m, dict) else {}
                title = movie_obj.get("title", "Unknown")
                tmdb_id = movie_obj.get("ids", {}).get("tmdb")
                slug = movie_obj.get("ids", {}).get("slug")

                if not tmdb_id and not slug:
                    print(f"⚠️ Skipping Watchlist check for '{title}' (no TMDb ID or slug available).")
                    continue

                target_url = f"https://letterboxd.com/tmdb/{tmdb_id}/" if tmdb_id else f"https://letterboxd.com/film/{slug}/"
                print(f"🔍 Navigating to Letterboxd page for '{title}': {target_url}...")

                try:
                    p_page.goto(target_url, wait_until="domcontentloaded", timeout=25000)
                    time.sleep(2)

                    # Handle Cloudflare challenge if presented
                    handle_turnstile_if_present(p_page, timeout_sec=15)

                    # Wait for sidebar action panel to appear
                    try:
                        p_page.wait_for_selector(
                            ".watch-panel, .actions-panel, .add-to-watchlist, [data-action*='watchlist'], .sidebar",
                            timeout=10000
                        )
                    except Exception:
                        pass

                    # Inspect and click the watchlist button if currently active
                    eval_res = p_page.evaluate("""() => {
                        const candidates = [
                            ".add-to-watchlist",
                            "a[data-action*='watchlist']",
                            "button[data-action*='watchlist']",
                            "a.watchlist-action",
                            "a.has-icon.icon-watchlist",
                            ".action-watchlist",
                            "[data-track-action='Watchlist']",
                            "[data-action='watchlist']"
                        ];

                        let btn = null;
                        for (const sel of candidates) {
                            const el = document.querySelector(sel);
                            if (el) {
                                btn = el;
                                break;
                            }
                        }

                        if (!btn) {
                            const all = Array.from(document.querySelectorAll("a, button, span, div.action"));
                            for (const el of all) {
                                const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                                const title = (el.getAttribute('title') || el.getAttribute('aria-label') || '').toLowerCase();
                                if (t === 'watchlist' || t === 'in watchlist' || title.includes('watchlist')) {
                                    btn = el;
                                    break;
                                }
                            }
                        }

                        if (!btn) {
                            return { found: false, inWatchlist: false };
                        }

                        const classStr = (btn.className || '') + ' ' + (btn.parentElement ? btn.parentElement.className || '' : '');
                        const titleStr = (btn.getAttribute('title') || btn.getAttribute('data-original-title') || btn.getAttribute('aria-label') || '').toLowerCase();
                        const textStr = (btn.innerText || btn.textContent || '').trim().toLowerCase();

                        // On Letterboxd, an active watchlist button has class '-active', 'active', 'in-watchlist', or title 'Remove from your watchlist'
                        const isActive = classStr.includes('-active') ||
                                         classStr.includes(' active') ||
                                         classStr.includes('in-watchlist') ||
                                         titleStr.includes('remove') ||
                                         titleStr.includes('in your watchlist') ||
                                         textStr === 'in watchlist';

                        if (isActive) {
                            try { btn.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (e) {}
                            btn.click();
                            return { found: true, inWatchlist: true, clicked: true, title: titleStr, classStr: classStr };
                        }

                        return { found: true, inWatchlist: false, title: titleStr, classStr: classStr };
                    }""")

                    if eval_res.get("clicked"):
                        print(f"🗑️ Untoggled Watchlist: '{title}' successfully removed from your Letterboxd Watchlist!")
                        time.sleep(2)
                    elif eval_res.get("inWatchlist"):
                        fallback_btn = p_page.locator(".add-to-watchlist.-active, a[data-action*='watchlist'].-active, [title*='Remove from your watchlist'], a.has-icon.icon-watchlist.-active").first
                        if fallback_btn.count() > 0:
                            fallback_btn.click(force=True, timeout=5000)
                            print(f"🗑️ Untoggled Watchlist (via locator fallback): '{title}' successfully removed from your Letterboxd Watchlist!")
                            time.sleep(2)
                    elif eval_res.get("found"):
                        print(f"ℹ️ '{title}' is not currently in your Watchlist (already clear).")
                    else:
                        print(f"⚠️ Could not locate Watchlist toggle on '{title}' film page.")

                except Exception as e:
                    print(f"⚠️ Watchlist cleanup skipped for '{title}': {e}")


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
            except Exception:
                pass

            page.goto("https://letterboxd.com/import/", wait_until="commit", timeout=60000)
            try:
                page.wait_for_load_state("domcontentloaded", timeout=45000)
            except Exception:
                pass
            time.sleep(2)
        else:
            print("🎉 Already authenticated via saved session!")

        # Step 2. Handle File Upload
        # Check for intermittent "Continue" prompt from any previously abandoned import
        try:
            continue_btn = page.locator("button:has-text('Continue'), a:has-text('Continue')").first
            if continue_btn.is_visible():
                print("🔄 Found previous unfinished import prompt, clicking 'Continue'...")
                continue_btn.click()
                time.sleep(1.5)
        except Exception:
            pass

        print(f"📤 Uploading CSV file: {csv_path.name}...")
        file_input = page.locator("input[type='file']")

        try:
            if file_input.count() > 0:
                file_input.set_input_files(str(csv_path.resolve()))
            else:
                with page.expect_file_chooser(timeout=15000) as fc_info:
                    page.click(".file-button-container, .dropzone, a.button:has-text('Select File'), input[type='file']")
                fc_info.value.set_files(str(csv_path.resolve()))
            print("⚡ File transferred successfully!")
        except Exception as e:
            print(f"⚠️ Standard file chooser fallback: {e}")
            page.wait_for_selector("input[type='file']", state="attached", timeout=15000)
            page.set_input_files("input[type='file']", str(csv_path.resolve()))
            print("⚡ File transferred via direct file input!")

        # Step 3. Wait for Letterboxd to match titles
        print("⏳ Waiting for Letterboxd matching engine to resolve titles...")
        try:
            page.wait_for_url("**/import/csv/**", timeout=20000)
        except Exception:
            pass
        time.sleep(3)

        # Run automated Turnstile solver on the import/csv endpoint
        handle_turnstile_if_present(page, timeout_sec=30)

        match_ready_selectors = (
            "a.save-users-imported-imdb-history, a.submit-matched-films, "
            "form.import-step-2, .import-matches-container, .table-container, "
            "strong:has-text('Matching complete'), span:has-text('Matching complete'), "
            "a:has-text('Import Titles'), a:has-text('Import Films')"
        )

        try:
            page.wait_for_selector(
                match_ready_selectors,
                timeout=60000,
            )
            print("✨ Match processing complete! Matching preview is visible.")
        except PlaywrightTimeoutError:
            print("⚠️ Matched entries selector wait timed out (large catalog parsing).")

        # Step 4. Final Confirmation
        success = False
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
                        primary.click();
                        return { clicked: true, text: (primary.innerText || primary.value || '').trim(), method: "primary_class" };
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

                # Wait for save/success confirmation
                try:
                    saved_indicator = page.locator("strong:has-text('Saved'), h1:has-text('Saved'), text='Saved', text='saved', .message.-success, strong:has-text('Import complete')").first
                    saved_indicator.wait_for(state="visible", timeout=20000)
                    print("🎉 Import verified: Letterboxd saved the films!")
                except Exception:
                    pass

                time.sleep(4)
                success = True

                # Step 5: Automated Watchlist Cleanup for newly watched movies
                if cleanup_movies:
                    cleanup_letterboxd_watchlist(page, cleanup_movies)
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
    cleanup_candidates = new_movies if new_movies else (movies[:1] if movies else [])

    # Perform upload
    success = automate_letterboxd_upload(
        csv_path=csv_path,
        username=username,
        password=password,
        headless=args.headless,
        auto_confirm=args.auto_confirm,
        inspection_seconds=3 if (args.auto_confirm and args.interval) else args.keep_open,
        cleanup_movies=cleanup_candidates if (args.auto_confirm and getattr(args, "cleanup_watchlist", True)) else None,
    )

    if success:
        # Update sync state
        state["synced_movie_ids"] = list(current_ids)
        state["latest_watched_at"] = max_watched_at
        state["last_sync_time"] = datetime.now().isoformat()
        state["total_synced"] = len(current_ids)
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
