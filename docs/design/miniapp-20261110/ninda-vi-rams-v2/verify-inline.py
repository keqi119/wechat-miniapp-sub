"""Inspect the same restricted wrapper used for inline review, without real APIs."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image
import hashlib, io, json, sys

sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parent
errors=[]; failed=[]; requests=[]; host_runtime=[]; results=[]
host_scripts={
    'https://unpkg.com/@floating-ui/core@1.7.3/dist/floating-ui.core.umd.min.js',
    'https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js',
    'https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js',
}
def record_request(request):
    if request.url in host_scripts: host_runtime.append(request.url)
    elif request.url.startswith('http'): requests.append(request.url)
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    context=browser.new_context(device_scale_factor=2)
    for outer in [320,352,422,462]:
        page=context.new_page()
        page.set_viewport_size({'width':outer,'height':1000})
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('requestfailed',lambda request:failed.append(request.url))
        page.on('request',record_request)
        page.goto((root/'inline-preview.html').as_uri(),wait_until='load')
        frame=page.frames[1]
        frame.locator('#nd-ui-review').wait_for()
        if frame.locator('.nd-tabbar').is_hidden(): frame.locator('.nd-back').click()
        assert len(page.frames)==2, 'Unexpected nested content frame'
        assert not frame.locator('img').evaluate_all('(all)=>all.some(i=>!i.complete||i.naturalWidth===0)')
        for name in ['home','catalog','use','mine']:
            frame.locator('#nd-tab-'+name).click()
            frame.wait_for_timeout(460)
            assert frame.locator('.nd-tab[aria-selected="true"]').get_attribute('data-destination')==name
            active=frame.locator('#nd-screen-'+name)
            assert active.is_visible()
            assert active.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),(outer,name,'content overflow')
            assert frame.locator('.nd-screen:not([hidden])').count()==1
            assert frame.locator('.nd-tab[aria-selected="true"]').evaluate('''e=>{
              const highlight=document.querySelector('.nd-tab-indicator').getBoundingClientRect();
              return [...e.querySelectorAll('img,.nd-tab-label')].every(child=>{
                const box=child.getBoundingClientRect();
                return box.left>=highlight.left-1&&box.right<=highlight.right+1&&box.top>=highlight.top&&box.bottom<=highlight.bottom;
              });
            }'''),(outer,name,'icon and text not inside yellow block')
            results.append({'width':round(frame.locator('.nd-device').bounding_box()['width']),'page':name,'passed':True})
        for name,selector in [('profile','.nd-identity-entry'),('payments','[data-type="payments"]'),('bill','[data-type="bills"]')]:
            frame.locator(selector).click()
            assert frame.locator('#nd-screen-'+name).is_visible()
            assert frame.locator('#nd-screen-'+name).evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),(outer,name,'overflow')
            assert frame.locator('.nd-tabbar').is_hidden()
            if name=='profile':
                assert frame.locator('.nd-profile-info-row').count()==3
                assert frame.locator('[data-handler="verifyIdentity"]').count()==0
                for row in frame.locator('.nd-document-actions').all():
                    boxes=[el.bounding_box() for el in row.locator('button').all()]
                    assert len(boxes)==2 and abs(boxes[0]['y']-boxes[1]['y'])<1
            frame.locator('.nd-back').click()
            assert frame.locator('#nd-screen-mine').is_visible()
            results.append({'width':round(frame.locator('.nd-device').bounding_box()['width']),'page':name,'passed':True})
        frame.locator('#nd-tab-home').click(); frame.wait_for_timeout(450)
        forward=frame.evaluate('''()=>{
          document.querySelector('#nd-tab-catalog').click();
          return [...document.getAnimations()].filter(a=>a.effect.target.classList.contains('nd-screen')).map(a=>({page:a.effect.target.dataset.screen,frames:a.effect.getKeyframes().map(k=>k.transform)}));
        }''')
        assert next(a for a in forward if a['page']=='catalog')['frames'][0]=='translateX(100%)'
        assert next(a for a in forward if a['page']=='home')['frames'][-1]=='translateX(-100%)'
        frame.wait_for_timeout(450)
        backward=frame.evaluate('''()=>{
          document.querySelector('#nd-tab-home').click();
          return [...document.getAnimations()].filter(a=>a.effect.target.classList.contains('nd-screen')).map(a=>({page:a.effect.target.dataset.screen,frames:a.effect.getKeyframes().map(k=>k.transform)}));
        }''')
        assert next(a for a in backward if a['page']=='home')['frames'][0]=='translateX(-100%)'
        frame.wait_for_timeout(450)
        same=frame.evaluate('''()=>{
          document.querySelector('#nd-tab-home').click();
          return [...document.getAnimations()].map(a=>a.effect.target.className);
        }''')
        assert same==['nd-ripple'],same
        frame.evaluate("['mine','catalog','use','home','mine'].forEach(name=>document.querySelector('#nd-tab-'+name).click())")
        frame.wait_for_timeout(460)
        assert frame.locator('.nd-screen:not([hidden])').count()==1
        assert frame.locator('#nd-screen-mine').is_visible()
        assert frame.locator('.nd-ripple').count()==0
        page.emulate_media(reduced_motion='reduce')
        frame.locator('#nd-tab-home').click()
        assert frame.evaluate('document.getAnimations().length')==0
        if outer==422:
            frame.locator('.nd-device').screenshot(path=str(root/'interactive-home.png'))
            frame.locator('#nd-tab-mine').click()
            frame.locator('.nd-identity-entry').click()
            frame.locator('.nd-device').screenshot(path=str(root/'interactive-profile.png'))
        page.close()
    # A compact motion demonstration, using actual browser animation frames.
    page=browser.new_page(viewport={'width':422,'height':1000},device_scale_factor=1)
    page.goto((root/'inline-preview.html').as_uri(),wait_until='load')
    frame=page.frames[1]; frame.locator('#nd-ui-review').wait_for()
    frames=[]; durations=[]
    def capture(duration):
        frames.append(Image.open(io.BytesIO(frame.locator('.nd-device').screenshot(animations='allow'))).convert('RGB'))
        durations.append(duration)
    capture(900)
    for name in ['catalog','use','mine','use','catalog','home']:
        frame.evaluate("name=>{document.querySelector('#nd-tab-'+name).click();document.getAnimations().forEach(a=>{a.effect.updateTiming({fill:'both'});a.pause();a.currentTime=0});}",name)
        for time in [0,30,60,90,120,150,180,200,220,260]:
            frame.evaluate('t=>document.getAnimations().forEach(a=>a.currentTime=t)',time)
            capture(30 if time<180 else 40)
        frame.evaluate('document.getAnimations().forEach(a=>a.finish())')
        frame.wait_for_timeout(20)
        capture(700)
    frames[0].save(root/'navigation-motion.gif',save_all=True,append_images=frames[1:],duration=durations,loop=0,optimize=True)
    browser.close()
manifest=json.loads((root/'source-manifest.json').read_text(encoding='utf-8'))
workspace=root.parents[3]
for item in manifest['sourceFiles']:
    assert hashlib.sha256((workspace/item['path']).read_bytes()).hexdigest()==item['sha256']
assert not errors and not failed and not requests,(errors,failed,requests)
report={'scope':'Visual prototype; no WeChat device acceptance or production writes','layouts':results,'jsErrors':errors,'failedRequests':failed,'productExternalRequests':requests,'hostRuntimeScripts':sorted(set(host_runtime)),'directions':'Right destination enters from right; left destination enters from left','sameTab':'Ripple only','rapidNavigation':'Only final selected destination remains visible','reducedMotion':'Instant navigation, no ripple','sourceFilesUnchanged':True,'fragmentBytes':(root/'ninda-navigation.html').stat().st_size}
(root/'inline-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'layoutsPassed':len(results),'errors':errors,'requests':len(requests),'gifBytes':(root/'navigation-motion.gif').stat().st_size}))
