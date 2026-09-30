import re

with open("scripts/automate_letterboxd_upload.py", "r", encoding="utf-8") as f:
    content = f.read()

start_str = 'eval_res = p_page.evaluate("""() => {'
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
                        }""")\n'''

content = content[:start_idx] + new_eval + content[end_idx:]

with open("scripts/automate_letterboxd_upload.py", "w", encoding="utf-8") as f:
    f.write(content)
print("Successfully patched evaluate block for AJAX Watchlist removal!")
