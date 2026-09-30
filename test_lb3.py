
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('https://letterboxd.com/film/exodus-gods-and-kings/')
    page.wait_for_selector('.action-watched', timeout=10000)
    html = page.evaluate('''(function() {
        const btn = document.querySelector('.action-watched');
        return btn ? btn.outerHTML : 'No watched button';
    })()''')
    print('Watched Button HTML:', html)
    browser.close()
