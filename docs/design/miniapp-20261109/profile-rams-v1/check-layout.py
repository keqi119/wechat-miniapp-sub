import json
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent
results = []
errors = []
external_requests = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="msedge", headless=True)
    for width in (320, 390, 430):
        page = browser.new_page(viewport={"width": width, "height": 920}, device_scale_factor=1)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: external_requests.append(request.url) if request.url.startswith(("http:", "https:")) else None)
        page.route("http://**/*", lambda route: route.abort())
        page.route("https://**/*", lambda route: route.abort())
        page.goto((root / "profile-rams.html").as_uri(), wait_until="load")
        state = page.evaluate("""() => {
            const identity = [...document.querySelectorAll('.identity-row dt, .identity-row dd')];
            const typography = identity.map(e => {
                const s = getComputedStyle(e);
                return [s.fontFamily, s.fontSize, s.fontWeight, s.lineHeight, s.color].join('|');
            });
            const overflowingFields = identity.filter(e => e.scrollWidth > e.clientWidth + 1).length;
            const inlineActions = [...document.querySelectorAll('.document-actions')].every(row => {
                const [a, b] = [...row.children].map(e => e.getBoundingClientRect());
                return Math.abs(a.y - b.y) < 1 && a.height >= 44 && b.height >= 44;
            });
            const [contact, logout] = [...document.querySelectorAll('.account-button')].map(e => e.getBoundingClientRect());
            const touchTargets = [...document.querySelectorAll('#profile-proposal button')].every(e => {
                const b = e.getBoundingClientRect(); return b.width >= 44 && b.height >= 44;
            });
            return {
                overflow: document.documentElement.scrollWidth > innerWidth,
                cards: document.querySelectorAll('.profile-card').length,
                tabs: document.querySelectorAll('[role=tablist]').length,
                identityTypography: typography,
                uniformTypography: new Set(typography).size === 1,
                overflowingFields,
                inlineActions,
                parallelAccountActions: Math.abs(contact.y - logout.y) < 1,
                touchTargets,
                verificationColor: getComputedStyle(document.querySelector('.verified')).backgroundColor,
                screenWidth: document.querySelector('.screen').getBoundingClientRect().width
            };
        }""")
        assert not state["overflow"] and not state["overflowingFields"], state
        assert state["cards"] == 2 and state["tabs"] == 0, state
        assert state["uniformTypography"] and state["inlineActions"] and state["parallelAccountActions"] and state["touchTargets"], state
        assert state["verificationColor"] == "rgb(249, 190, 0)", state
        page.locator(".screen").screenshot(path=str(root / f"profile-rams-{width}.png"))
        page.get_by_role("button", name="查看身份证人像面", exact=True).click()
        assert page.get_by_role("dialog").is_visible()
        page.get_by_role("button", name="知道了", exact=True).click()
        assert not page.get_by_role("dialog").is_visible()
        results.append({"viewportWidth": width, **state})
        page.close()
    browser.close()

def luminance(hex_color):
    values = [int(hex_color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    linear = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in values]
    return sum(v * c for v, c in zip(linear, (0.2126, 0.7152, 0.0722)))

def contrast(a, b):
    high, low = sorted((luminance(a), luminance(b)), reverse=True)
    return round((high + 0.05) / (low + 0.05), 2)

contrasts = {
    "textOnWhite": contrast("#231815", "#ffffff"),
    "captionOnWhite": contrast("#62666a", "#ffffff"),
    "verifiedOnBrandYellow": contrast("#231815", "#f9be00"),
}
assert min(contrasts.values()) >= 4.5
assert not errors and not external_requests, (errors, external_requests)
report = {"scope": "Synthetic, local visual proposal only. Not a WeChat runtime or production acceptance.", "viewports": results, "contrastRatios": contrasts, "javascriptErrors": errors, "externalRequests": external_requests}
(root / "layout-check.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"viewportsPassed": len(results), "contrastRatios": contrasts, "javascriptErrors": len(errors), "externalRequests": len(external_requests)}))
