import re

with open("scripts/automate_letterboxd_upload.py", "r", encoding="utf-8") as f:
    content = f.read()

start_str = 'eval_res = p_page.evaluate("""async () => {'
end_str = '}""")\n'

start_idx = content.find(start_str)
if start_idx == -1:
    print("Could not find start of evaluate block")
    exit(1)

end_idx = content.find(end_str, start_idx)
if end_idx == -1:
    print("Could not find end of evaluate block")
    exit(1)

end_idx += len(end_str)

new_eval = '''eval_res = p_page.evaluate("""async () => {
                            // Find the internal Film ID. Letterboxd stores this in multiple places.
                            let filmId = document.body.getAttribute('data-film-id');
                            if (!filmId) {
                                const poster = document.querySelector('.film-poster, [data-film-id]');
                                if (poster) filmId = poster.getAttribute('data-film-id');
                            }
                            if (!filmId) {
                                // Sometimes it's in a JS variable
                                if (window.letterboxd_film_id) filmId = window.letterboxd_film_id;
                            }
                            
                            const csrfInput = document.querySelector('input[name="__csrf"]');
                            const csrfToken = csrfInput ? csrfInput.value : (window.letterboxd_csrf || window.__letterboxd_csrf || '');

                            let fetchSuccess = false;

                            if (filmId) {
                                try {
                                    // 1. User's exact snippet (No CSRF in body, just action)
                                    const res1 = await fetch('/csi/film/' + filmId + '/sidebar-actions/', {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                                            'X-Requested-With': 'XMLHttpRequest'
                                        },
                                        body: 'action=remove-watchlist'
                                    });
                                    if (res1.ok) fetchSuccess = true;
                                } catch (e) {}

                                try {
                                    // 2. Canonical endpoint with CSRF just in case
                                    if (csrfToken) {
                                        const res2 = await fetch('/s/film/' + filmId + '/watchlist', {
                                            method: 'POST',
                                            headers: {
                                                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                                                'X-Requested-With': 'XMLHttpRequest'
                                            },
                                            body: '__csrf=' + encodeURIComponent(csrfToken) + '&action=remove-watchlist'
                                        });
                                        if (res2.ok) fetchSuccess = true;
                                    }
                                } catch (e) {}
                            }

                            // 3. Absolute Fallback: Click the active button if it exists
                            let clickedFallback = false;
                            const activeBtn = document.querySelector("#userpanel .add-to-watchlist.-active, #userpanel a[data-action*='watchlist'].-active, .panel-watchlist.-watchlisted a, #userpanel .action-watchlist.-active");
                            if (activeBtn) {
                                try {
                                    activeBtn.click();
                                    clickedFallback = true;
                                } catch (e) {}
                            }

                            return { 
                                found: true, 
                                inWatchlist: true, // We assume it might have been
                                clicked: fetchSuccess || clickedFallback, 
                                method: fetchSuccess ? "fetch_unconditional" : (clickedFallback ? "click_fallback" : "failed"), 
                                filmId: filmId 
                            };
                        }""")\n'''

content = content[:start_idx] + new_eval + content[end_idx:]

with open("scripts/automate_letterboxd_upload.py", "w", encoding="utf-8") as f:
    f.write(content)
print("Successfully patched evaluate block for unconditional AJAX Watchlist removal!")
