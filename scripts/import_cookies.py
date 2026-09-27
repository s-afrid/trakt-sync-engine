#!/usr/bin/env python3
"""
Letterboxd Cookie Extension Session Importer
--------------------------------------------
Imports cookies exported from browser extensions (Cookie-Editor, EditThisCookie),
transforms them into Playwright storageState format, and saves to .letterboxd_session.json.

Also generates the exact string needed for GitHub Secrets (LETTERBOXD_SESSION_JSON).

Usage:
  python scripts/import_cookies.py
  python scripts/import_cookies.py path/to/cookies.json
"""

import sys
import os
import json
import time
from pathlib import Path

# Fix Windows console UTF-8 encoding
if sys.platform == "win32":
    import io
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True, write_through=True)
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True, write_through=True)
    except Exception:
        pass

ROOT_DIR = Path(__file__).resolve().parent.parent
TARGET_FILE = ROOT_DIR / ".letterboxd_session.json"

def normalize_same_site(val: str) -> str:
    if not val:
        return "Lax"
    lower = str(val).lower()
    if lower == "strict":
        return "Strict"
    if lower in ("none", "no_restriction"):
        return "None"
    return "Lax"

def convert_to_playwright(raw_data) -> dict:
    if isinstance(raw_data, str):
        raw_data = json.loads(raw_data.strip())

    cookie_list = []
    if isinstance(raw_data, list):
        cookie_list = raw_data
    elif isinstance(raw_data, dict):
        if "cookies" in raw_data and isinstance(raw_data["cookies"], list):
            cookie_list = raw_data["cookies"]
        else:
            raise ValueError("Dictionary does not contain a 'cookies' list.")
    else:
        raise ValueError("Invalid format: expected JSON array of cookies or Playwright storage state.")

    default_expiry = int(time.time()) + (365 * 24 * 3600)
    transformed_cookies = []

    for c in cookie_list:
        if not isinstance(c, dict) or "name" not in c or "value" not in c:
            continue

        domain = c.get("domain", ".letterboxd.com")
        if "letterboxd.com" not in domain:
            domain = ".letterboxd.com"

        exp = c.get("expires") or c.get("expirationDate") or default_expiry
        try:
            exp = int(float(exp))
        except Exception:
            exp = default_expiry

        http_only = bool(c.get("httpOnly", False))
        if c["name"] == "letterboxd.user" or c["name"].startswith("__Host"):
            http_only = True

        transformed_cookies.append({
            "name": str(c["name"]),
            "value": str(c["value"]),
            "domain": str(domain),
            "path": str(c.get("path", "/")),
            "expires": exp,
            "httpOnly": http_only,
            "secure": bool(c.get("secure", True)),
            "sameSite": normalize_same_site(c.get("sameSite")),
        })

    return {
        "cookies": transformed_cookies,
        "origins": [
            {
                "origin": "https://letterboxd.com",
                "localStorage": []
            }
        ]
    }

def copy_to_clipboard(text: str) -> bool:
    try:
        import subprocess
        if sys.platform == "win32":
            subprocess.run(["clip"], input=text.encode("utf-16"), check=True)
            return True
        elif sys.platform == "darwin":
            subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=True)
            return True
        else:
            subprocess.run(["xclip", "-selection", "clipboard"], input=text.encode("utf-8"), check=True)
            return True
    except Exception:
        return False

def main():
    print("=" * 65)
    print("🍪 Letterboxd Cookie Extension Session Importer")
    print("=" * 65)

    raw_text = ""
    # Option 1: File path passed as argument
    if len(sys.argv) > 1:
        fpath = Path(sys.argv[1])
        if fpath.exists():
            raw_text = fpath.read_text(encoding="utf-8")
            print(f"📁 Loaded cookies from file: {fpath.name}")
        else:
            print(f"❌ File not found: {fpath}")
            sys.exit(1)
    else:
        print("How to export cookies from Letterboxd:")
        print(" 1. Open https://letterboxd.com in your browser (logged in).")
        print(" 2. Click your cookie extension (e.g. Cookie-Editor, EditThisCookie).")
        print(" 3. Click 'Export' (JSON format).")
        print("\nPaste the exported JSON below, then press Enter and Ctrl+Z (or Ctrl+D):")
        print("-" * 65)
        try:
            raw_text = sys.stdin.read()
        except KeyboardInterrupt:
            print("\nAborted.")
            sys.exit(0)

    if not raw_text.strip():
        print("❌ No input received.")
        sys.exit(1)

    try:
        session = convert_to_playwright(raw_text)
    except Exception as e:
        print(f"❌ Error parsing cookies: {e}")
        sys.exit(1)

    # Save to .letterboxd_session.json
    TARGET_FILE.write_text(json.dumps(session, indent=2), encoding="utf-8")
    print(f"\n✅ Converted {len(session['cookies'])} cookies!")
    print(f"💾 Successfully saved Playwright session to: {TARGET_FILE.name}")

    user_cookie = next((c for c in session["cookies"] if c["name"] == "letterboxd.user"), None)
    if user_cookie:
        exp_time = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(user_cookie['expires']))
        print(f"🔑 Authentication Verified: 'letterboxd.user' found!")
        print(f"⏳ Cookie valid until: {exp_time}")
    else:
        print("⚠️ Warning: 'letterboxd.user' cookie was not found in the export.")

    # Single-line JSON for GitHub Secrets
    single_line_json = json.dumps(session, separators=(',', ':'))
    copied = copy_to_clipboard(single_line_json)

    print("\n" + "=" * 65)
    print("☁️ GitHub Actions Secret (LETTERBOXD_SESSION_JSON)")
    print("=" * 65)
    if copied:
        print("📋 Session string has been COPIED to your clipboard automatically!")
    print("To update your cloud sync runner:")
    print(" 1. Go to your repo -> Settings -> Secrets and variables -> Actions")
    print(" 2. Open secret: LETTERBOXD_SESSION_JSON")
    print(" 3. Paste the updated session string.\n")

if __name__ == "__main__":
    main()
