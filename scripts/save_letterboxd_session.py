#!/usr/bin/env python3
"""
One-Time Letterboxd Session Generator
------------------------------------
Opens a visible browser on your computer, signs into Letterboxd,
and saves the authenticated session to .letterboxd_session.json.

This session can be copied into GitHub Secrets (as LETTERBOXD_SESSION_JSON)
so GitHub Actions can sync your movies 100% in the cloud without captchas!
"""

import os
import sys
import json
import time
from pathlib import Path

# Fix Windows console cp1252 encoding
if sys.platform == "win32":
    import io
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True, write_through=True)
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True, write_through=True)
    except Exception:
        pass

from playwright.sync_api import sync_playwright

ROOT_DIR = Path(__file__).resolve().parent.parent
SESSION_FILE = ROOT_DIR / ".letterboxd_session.json"
ENV_FILE = ROOT_DIR / ".env"

def load_env():
    if not ENV_FILE.exists():
        return
    with open(ENV_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v

load_env()

username = os.getenv("LETTERBOXD_USERNAME", "Af_Sindbad")
password = os.getenv("LETTERBOXD_PASSWORD", "Af02052002")

print("=" * 65)
print("🔑 Letterboxd One-Time Cloud Session Generator")
print("=" * 65)
print(f"Account: {username}")
print("Opening visible browser to generate authenticated cloud session...")

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=False,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
        ],
    )
    context = browser.new_context(
        viewport={"width": 1280, "height": 850},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    )
    context.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

    page = context.new_page()
    page.goto("https://letterboxd.com/sign-in/", wait_until="commit", timeout=60000)
    time.sleep(2)

    # Dismiss cookies if shown
    try:
        cookie_btn = page.locator("#onetrust-accept-btn-handler, button:has-text('Accept All'), button:has-text('Agree')")
        if cookie_btn.count() > 0 and cookie_btn.first.is_visible():
            cookie_btn.first.click()
            time.sleep(0.5)
    except Exception:
        pass

    # Wait for either login form or already authenticated account
    try:
        page.wait_for_selector("input#field-username, input[name='username'], .nav-account, .profile-avatar", timeout=45000)
    except Exception:
        pass

    # Fill username and password if inputs visible
    try:
        user_input = page.locator("input#field-username, input[name='username']").first
        if user_input.is_visible():
            user_input.fill(username)
        pass_input = page.locator("input#field-password, input[name='password']").first
        if pass_input.is_visible():
            pass_input.fill(password)
        print("✅ Pre-filled username and password in the browser window.")
    except Exception as e:
        print(f"Notice: Form auto-fill skipped: {e}")

    print("\n👉 Please click the green 'Sign In' button (or solve any captcha) in the open browser window...")
    print("⏳ Waiting for login confirmation (up to 5 minutes)...")

    start_wait = time.time()
    logged_in = False
    while time.time() - start_wait < 300:
        if "sign-in" not in page.url.lower() and page.locator(".nav-account, .profile-avatar, a.avatar").count() > 0:
            logged_in = True
            break
        time.sleep(1)

    if not logged_in:
        print("❌ Login wait timed out after 5 minutes.")
        browser.close()
        sys.exit(1)

    # Save session
    context.storage_state(path=str(SESSION_FILE))
    session_content = SESSION_FILE.read_text(encoding="utf-8")
    browser.close()

    print("\n" + "=" * 65)
    print("🎉 SUCCESS: Letterboxd session saved to .letterboxd_session.json!")
    print("=" * 65)
    print("\nTo enable 100% Cloud Sync in GitHub Actions without captchas:")
    print("1. Go to: https://github.com/s-afrid/trakt-sync-engine/settings/secrets/actions")
    print("2. Click 'New repository secret'")
    print("3. Name: LETTERBOXD_SESSION_JSON")
    print("4. Secret: Paste the content below:")
    print("-" * 65)
    print(session_content.strip())
    print("-" * 65)
