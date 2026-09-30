
from playwright.sync_api import sync_playwright
import time
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('https://letterboxd.com/film/exodus-gods-and-kings/')
    time.sleep(2)
    html = page.evaluate('''(function() {
        const panel = document.querySelector('#userpanel');
        return panel ? panel.innerHTML : 'No userpanel';
    })()''')
    print('Panel HTML:', html)
    browser.close()
