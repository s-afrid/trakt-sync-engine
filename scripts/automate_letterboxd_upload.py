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

    # Fallback to local server route
    url = f"{app_url}/api/export/letterboxd?type={export_type}"
    try:
        csv_path = download_csv_from_server(url, target_csv)
        return csv_path, []
    except Exception as e:
        print(f"❌ Failed to fetch CSV from local server ({e}).")
        if trakt_client_id and trakt_username:
            print("🔄 Retrying direct Trakt API fetch...")
            movies = fetch_from_trakt_direct(trakt_client_id, trakt_username)
            if movies:
                generate_watched_csv(movies, target_csv)
                return target_csv, movies
        raise


def automate_letterboxd_upload(
    csv_path: Path,
    username: str,
    password: str,
    headless: bool = False,
    auto_confirm: bool = False,
    inspection_seconds: int = 15,
) -> bool:
    """Launches Playwright to log in to Letterboxd and upload the CSV file."""
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV file not found at: {csv_path}")

    if csv_path.stat().st_size == 0:
        raise ValueError(f"CSV file at {csv_path} is empty.")

    print(f"📄 Preparing upload: {csv_path.name} ({csv_path.stat().st_size:,} bytes)")

    with sync_playwright() as p:
        print(f"🚀 Launching browser (headless={headless})...")
        browser = p.chromium.launch(
            headless=headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
            ],
        )

        context_kwargs = {
            "viewport": {"width": 1280, "height": 850},
            "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        }

        # Restore saved browser session if available
        if SESSION_FILE.exists():
            try:
                context_kwargs["storage_state"] = str(SESSION_FILE)
                print("💾 Restoring saved Letterboxd session...")
            except Exception:
                pass

        context = browser.new_context(**context_kwargs)
        page = context.new_page()

        # Step 1. Check Authentication
        print("🔐 Checking Letterboxd authentication state...")
        page.goto("https://letterboxd.com/import/", wait_until="domcontentloaded")
        time.sleep(2)

        # Check for Cloudflare / Turnstile barrier
        content = page.content()
        if "challenges.cloudflare.com" in content or "Just a moment..." in page.title():
            print("⚠️ Cloudflare challenge detected! Please solve the captcha in the open browser window...")
            page.wait_for_selector("input#field-username, input[name='username'], input[type='file']", timeout=90000)

        # If redirected to sign-in page, perform login
        if "sign-in" in page.url.lower() or page.locator(".nav-account, .profile-avatar, a.avatar").count() == 0:
            print(f"🔑 Logging into Letterboxd account: {username}...")
            if "sign-in" not in page.url.lower():
                page.goto("https://letterboxd.com/sign-in/", wait_until="domcontentloaded")
                time.sleep(1.5)

            # Dismiss cookie consent if visible
            try:
                cookie_accept = page.locator("#onetrust-accept-btn-handler, button:has-text('Accept All'), button:has-text('Agree')")
                if cookie_accept.count() > 0 and cookie_accept.first.is_visible():
                    cookie_accept.first.click()
                    time.sleep(0.5)
            except Exception:
                pass

            user_input = page.locator("input#field-username, input[name='username']").first
            user_input.fill(username)

            pass_input = page.locator("input#field-password, input[name='password']").first
            pass_input.fill(password)

            print("🚀 Submitting login form...")
            submit_btn = page.locator("input[type='submit'], button[type='submit'], .button.-action").first
            submit_btn.click()

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

            page.goto("https://letterboxd.com/import/", wait_until="domcontentloaded")
            time.sleep(2)
        else:
            print("🎉 Already authenticated via saved session!")

        # Step 2. Handle File Upload
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
            page.wait_for_selector(
                ".import-matches-container, .button.-green, .table-container, form.import-step-2, .not-matched",
                timeout=60000,
            )
            print("✨ Match processing complete! Matching preview is visible.")
        except PlaywrightTimeoutError:
            print("⚠️ Matched entries selector wait timed out (large catalog parsing).")

        # Step 4. Final Confirmation
        success = False
        if auto_confirm:
            print("⚡ Auto-submitting import confirmation...")
            try:
                import_btn = page.locator(".button.-green, input[value='Import'], button:has-text('Import')").first
                if import_btn.is_visible():
                    import_btn.click()
                    print("✅ Clicked final green 'Import' button!")
                    time.sleep(4)
                    success = True
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

    # Fetch latest movies data
    print(f"\n[{now_str}] 🔍 Checking Trakt watch history...")
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

    # Perform upload
    success = automate_letterboxd_upload(
        csv_path=csv_path,
        username=username,
        password=password,
        headless=args.headless,
        auto_confirm=args.auto_confirm,
        inspection_seconds=3 if (args.auto_confirm and args.interval) else args.keep_open,
    )

    if success:
        # Update sync state
        state["synced_movie_ids"] = list(current_ids)
        state["latest_watched_at"] = max_watched_at
        state["last_sync_time"] = datetime.now().isoformat()
        state["total_synced"] = len(current_ids)
        save_sync_state(state)
        print(f"[{now_str}] ✅ State saved: {len(current_ids)} movies tracked.")

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
