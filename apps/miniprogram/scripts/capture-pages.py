"""Capture offline wcc layout fixtures; never contacts a business API."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parents[1]
out = root / 'evidence' / 'page-comparison'
report = json.loads((out / 'report.json').read_text(encoding='utf-8'))
errors = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page(viewport={'width':390,'height':844}, device_scale_factor=1)
    page.on('pageerror', lambda error: errors.append(str(error)))
    for row in report['pages']:
        for mode in ['reference','real']:
            page.goto(f"http://127.0.0.1:18939/{mode}-{row['page']}.html", wait_until='networkidle')
            page.screenshot(path=str(out / row[mode]), full_page=True)
            row[mode+'Overflow'] = page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
    browser.close()
report['browser'] = 'Microsoft Edge headless via Playwright'
report['runtimeErrors'] = errors
(out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'screenshots':len(report['pages'])*2,'runtimeErrors':errors,'overflows':[r['page'] for r in report['pages'] if r['realOverflow'] or r['referenceOverflow']]}, ensure_ascii=False))
if errors: raise SystemExit(1)
