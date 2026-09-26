#!/usr/bin/env python3
"""
Automated Letterboxd CSV Importer via Playwright
------------------------------------------------
Fetches watched movies or ratings CSV directly from Trakt Sync Engine,
logs into Letterboxd, and uploads the CSV for title matching and import.

Usage:
  python scripts/automate_letterboxd_upload.py --type watched
  python scripts/automate_letterboxd_upload.py --type ratings
  python scripts/automate_letterboxd_upload.py --file path/to/custom.csv
  python scripts/automate_letterboxd_upload.py --auto-confirm
"""

import os
import sys
import time
import argparse
from pathlib import Path
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


def download_csv(url: str, target_path: Path) -> Path:
    """Fetches the latest CSV data from the Trakt Sync Engine URL."""
    print(f"📥 Fetching latest CSV data from: {url}")
    target_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        response = requests.get(url, timeout=30)
    except requests.exceptions.RequestException as e:
        print(f"❌ Connection error while contacting server: {e}")
        print("💡 Make sure Trakt Sync Engine web server is running (http://localhost:3000) or specify a local CSV with --file")
        sys.exit(1)

    if response.status_code == 200:
        # Check if response returned JSON error instead of CSV
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            try:
                err_data = response.json()
                print(f"❌ Export server returned error: {err_data.get('error', 'Unknown error')}")
                sys.exit(1)
            except Exception:
                pass

        target_path.write_bytes(response.content)
        file_size = len(response.content)
        print(f"✅ Data saved locally to: {target_path} ({file_size:,} bytes)")
        return target_path
    elif response.status_code == 401:
        print("❌ 401 Unauthorized: Trakt account is not connected.")
        print("💡 Please connect your Trakt account on the web dashboard (http://localhost:3000) first.")
        sys.exit(1)
    else:
        raise Exception(f"Failed to fetch CSV. HTTP Status: {response.status_code}\n{response.text[:200]}")


def automate_letterboxd_upload(
    csv_path: Path,
    username: str,
    password: str,
    headless: bool = False,
    auto_confirm: bool = False,
    inspection_seconds: int = 25,
):
    """Launches Playwright to log in to Letterboxd and upload the CSV file."""
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV file not found at: {csv_path}")

    # Validate file is not empty
    if csv_path.stat().st_size == 0:
        raise ValueError(f"CSV file at {csv_path} is empty. Ensure watch history exists.")

    print(f"📄 Preparing to upload: {csv_path.name} ({csv_path.stat().st_size:,} bytes)")

    with sync_playwright() as p:
        print(f"🚀 Launching browser (headless={headless})...")
        browser = p.chromium.launch(
            headless=headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
            ],
        )

        context = browser.new_context(
            viewport={"width": 1280, "height": 850},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        )
        page = context.new_page()

        # Step 1. Log in to Letterboxd
        print("🔐 Navigating to Letterboxd sign-in...")
        page.goto("https://letterboxd.com/sign-in/", wait_until="domcontentloaded")
        time.sleep(1.5)

        # Check for Cloudflare / Turnstile barrier
        content = page.content()
        if "challenges.cloudflare.com" in content or "Just a moment..." in page.title():
            print("⚠️ Cloudflare challenge detected! Please solve the captcha in the open browser window...")
            page.wait_for_selector("input#field-username, input[name='username']", timeout=90000)

        # Check if already logged in (e.g. from session)
        if page.locator(".nav-account, .profile-avatar, a.avatar").count() == 0:
            print(f"🔑 Entering credentials for account: {username}...")
            # Dismiss cookie consent if visible
            try:
                cookie_accept = page.locator("#onetrust-accept-btn-handler, button:has-text('Accept All'), button:has-text('Agree')")
                if cookie_accept.count() > 0 and cookie_accept.first.is_visible():
                    cookie_accept.first.click()
                    time.sleep(0.5)
            except Exception:
                pass

            # Fill username
            user_input = page.locator("input#field-username, input[name='username']").first
            user_input.fill(username)

            # Fill password
            pass_input = page.locator("input#field-password, input[name='password']").first
            pass_input.fill(password)

            # Submit
            print("🚀 Submitting login form...")
            submit_btn = page.locator("input[type='submit'], button[type='submit'], .button.-action").first
            submit_btn.click()

            # Wait for login navigation or detect inline errors immediately
            print("⏳ Awaiting login authentication...")
            login_success = False
            start_time = time.time()
            while time.time() - start_time < 30:
                if "sign-in" not in page.url.lower():
                    login_success = True
                    break

                # Check for immediate inline error message
                error_el = page.locator(".message.-error, .form-row.-error, .message.error, .field-error")
                if error_el.count() > 0 and error_el.first.is_visible():
                    err_text = error_el.first.inner_text().strip()
                    browser.close()
                    raise Exception(f"Letterboxd login failed: {err_text}")

                time.sleep(0.8)

            if not login_success:
                browser.close()
                raise Exception("Letterboxd login timed out or was blocked by a challenge. Please run with visible browser (headless=False) to inspect.")

            print("🎉 Successfully logged into Letterboxd!")
        else:
            print("🎉 Already authenticated into Letterboxd!")

        # Step 2. Navigate to Importer Page
        print("📂 Navigating to the Import interface (https://letterboxd.com/import/)...")
        page.goto("https://letterboxd.com/import/", wait_until="domcontentloaded")
        time.sleep(2)

        # Verify page is importer
        if "import" not in page.url.lower():
            page.goto("https://letterboxd.com/about/importing-data/", wait_until="domcontentloaded")
            time.sleep(1.5)

        # Step 3. Handle File Upload
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
            # Fallback direct upload attempt
            print(f"⚠️ Standard file chooser fallback triggered: {e}")
            page.wait_for_selector("input[type='file']", state="attached", timeout=15000)
            page.set_input_files("input[type='file']", str(csv_path.resolve()))
            print("⚡ File transferred via direct file input!")

        # Step 4. Wait for Letterboxd to parse and display matches
        print("⏳ Waiting for Letterboxd processing engine to match movie titles...")
        try:
            page.wait_for_selector(
                ".import-matches-container, .button.-green, .table-container, form.import-step-2, .not-matched",
                timeout=60000,
            )
            print("✨ Match processing complete! Matching preview is now visible.")
        except PlaywrightTimeoutError:
            print("⚠️ Matched entries selector wait timed out (parsing might be taking longer for large catalogs).")

        # Step 5. Final Confirmation
        if auto_confirm:
            print("⚡ --auto-confirm flag detected. Automatically submitting import...")
            try:
                import_btn = page.locator(".button.-green, input[value='Import'], button:has-text('Import')").first
                if import_btn.is_visible():
                    import_btn.click()
                    print("✅ Clicked final green 'Import' button!")
                    time.sleep(5)
            except Exception as e:
                print(f"⚠️ Could not auto-click import button: {e}")
        else:
            print("\n🏁 Automation complete! The data has been uploaded and parsed.")
            print("👉 Please review the browser window to resolve any mismatched movie titles, then click 'Import' manually.")

        print(f"👀 Keeping browser open for {inspection_seconds} seconds for inspection...")
        try:
            time.sleep(inspection_seconds)
        except KeyboardInterrupt:
            print("\n👋 Closing browser...")

        browser.close()
        print("🎉 All operations completed.")


def main():
    parser = argparse.ArgumentParser(description="Automate Letterboxd CSV Import via Playwright")
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
        help="Path to an existing CSV file on disk (skips downloading from server)",
    )
    parser.add_argument(
        "--url",
        type=str,
        default=None,
        help="Custom URL to fetch the export CSV from (defaults to local server route)",
    )
    parser.add_argument(
        "--app-url",
        type=str,
        default=None,
        help="Base URL of Trakt Sync Engine (defaults to NEXT_PUBLIC_APP_URL or http://localhost:3000)",
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
        help="Run browser in headless mode (default: False for visual inspection & captcha support)",
    )
    parser.add_argument(
        "--auto-confirm",
        action="store_true",
        default=False,
        help="Automatically click the final green 'Import' button instead of waiting for manual review",
    )
    parser.add_argument(
        "--keep-open",
        type=int,
        default=25,
        help="Seconds to keep browser open after upload for manual inspection (default: 25s)",
    )

    args = parser.parse_args()

    # Determine credentials
    username = args.username or os.getenv("LETTERBOXD_USERNAME")
    password = args.password or os.getenv("LETTERBOXD_PASSWORD")

    if not username:
        print("❌ Missing Letterboxd Username.")
        print("Please configure LETTERBOXD_USERNAME in your .env or pass --username <user>")
        sys.exit(1)

    if not password:
        print("❌ Missing Letterboxd Password.")
        print("Please configure LETTERBOXD_PASSWORD in your .env or pass --password <pass>")
        sys.exit(1)

    # Determine CSV file path
    if args.file:
        csv_path = Path(args.file).resolve()
        if not csv_path.exists():
            print(f"❌ Specified file not found: {csv_path}")
            sys.exit(1)
    else:
        base_app_url = args.app_url or os.getenv("NEXT_PUBLIC_APP_URL", "http://localhost:3000").rstrip("/")
        download_url = args.url or f"{base_app_url}/api/export/letterboxd?type={args.type}"
        csv_path = Path(__file__).resolve().parent.parent / f"letterboxd_{args.type}_import.csv"
        csv_path = download_csv(download_url, csv_path)

    # Execute automation
    automate_letterboxd_upload(
        csv_path=csv_path,
        username=username,
        password=password,
        headless=args.headless,
        auto_confirm=args.auto_confirm,
        inspection_seconds=args.keep_open,
    )


if __name__ == "__main__":
    main()
