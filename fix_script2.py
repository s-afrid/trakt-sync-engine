import re

with open('scripts/automate_letterboxd_upload.py', 'r', encoding='utf-8') as f:
    content = f.read()

bad_wait = """                save_confirmed = False
                wait_start = time.time()
                while time.time() - wait_start < 40:
                    cur_url = page.url
                    # Check if Letterboxd navigated to import summary, diary, or user page"""

good_wait = """                save_confirmed = False
                wait_start = time.time()
                while time.time() - wait_start < 40:
                    # Solve any Turnstile challenges that pop up mid-submission!
                    try:
                        handle_turnstile_if_present(page, timeout_sec=5)
                    except Exception:
                        pass

                    cur_url = page.url
                    # Check if Letterboxd navigated to import summary, diary, or user page"""

if bad_wait in content:
    content = content.replace(bad_wait, good_wait)
    with open('scripts/automate_letterboxd_upload.py', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Fixed script successfully!")
else:
    print("Could not find wait block to patch!")
