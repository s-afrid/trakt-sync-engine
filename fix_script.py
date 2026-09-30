import re

with open('scripts/automate_letterboxd_upload.py', 'r', encoding='utf-8') as f:
    content = f.read()

bad_js = """                    // Priority 1: Letterboxd official import confirmation button classes
                    const primary = document.querySelector("a.save-users-imported-imdb-history, a.submit-matched-films, input.save-users-imported-imdb-history");
                    if (primary) {
                        try { primary.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (e) {}
                        primary.click();
                        return { clicked: true, text: (primary.innerText || primary.value || '').trim(), method: "primary_class" };
                    }"""

good_js = """                    // Priority 1: Letterboxd official import confirmation button classes
                    const primary = document.querySelector("a.save-users-imported-imdb-history, a.submit-matched-films, input.save-users-imported-imdb-history");
                    if (primary) {
                        try { primary.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (e) {}
                        // CLOUDFLARE FIX: Do NOT click the button directly if we can avoid it. 
                        // A button click triggers Letterboxd's jQuery AJAX submission which fails silently behind Cloudflare.
                        // Instead, try to submit the parent form natively. This forces a full-page POST navigation 
                        // that can render the Cloudflare challenge widget correctly!
                        const parentForm = primary.closest('form');
                        if (parentForm && typeof parentForm.submit === 'function') {
                            parentForm.submit();
                        } else if (parentForm) {
                            // If form.submit is shadowed by an input named 'submit'
                            HTMLFormElement.prototype.submit.call(parentForm);
                        } else {
                            primary.click();
                        }
                        return { clicked: true, text: (primary.innerText || primary.value || '').trim(), method: "primary_class_native_submit" };
                    }"""

if bad_js in content:
    content = content.replace(bad_js, good_js)
    
    # Also, we should FAIL the job if save_confirmed is False!
    # Let's fix that.
    bad_success = """                if not save_confirmed:
                    print("⏱️ Save request dispatched; waiting 6s for backend processing to settle...")
                    time.sleep(6)

                success = True"""
    
    good_success = """                if not save_confirmed:
                    print("⚠️ Save request timed out! Letterboxd got stuck on 'Saving...' due to a silent Cloudflare block or server error.")
                    print("❌ Import failed.")
                    success = False
                else:
                    success = True"""
    content = content.replace(bad_success, good_success)

    with open('scripts/automate_letterboxd_upload.py', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Fixed script successfully!")
else:
    print("Could not find JS block to patch!")
