import re

with open('scripts/automate_letterboxd_upload.py', 'r', encoding='utf-8') as f:
    content = f.read()

bad_js = """                        const parentForm = primary.closest('form');
                        if (parentForm && typeof parentForm.submit === 'function') {
                            parentForm.submit();
                        } else if (parentForm) {
                            // If form.submit is shadowed by an input named 'submit'
                            HTMLFormElement.prototype.submit.call(parentForm);
                        } else {
                            primary.click();
                        }"""

good_js = """                        const parentForm = primary.closest('form') || document.querySelector('form.import-step-2, form#imdb-form');
                        if (parentForm && typeof parentForm.submit === 'function') {
                            parentForm.submit();
                        } else if (parentForm) {
                            // If form.submit is shadowed by an input named 'submit'
                            HTMLFormElement.prototype.submit.call(parentForm);
                        } else {
                            primary.click();
                        }"""

if bad_js in content:
    content = content.replace(bad_js, good_js)
    with open('scripts/automate_letterboxd_upload.py', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Fixed script successfully!")
else:
    print("Could not find JS block to patch!")
