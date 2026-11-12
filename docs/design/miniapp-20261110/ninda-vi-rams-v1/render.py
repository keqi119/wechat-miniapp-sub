from pathlib import Path
import json, hashlib
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parent
images=root/'images'; images.mkdir(exist_ok=True)
manifest=json.loads((root/'source-manifest.json').read_text(encoding='utf-8'))
names=[p['name'] for p in manifest['pages']]
errors=[];requests=[];failed_requests=[];results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='chrome')
 for width in [320,390,430]:
  page=browser.new_page(viewport={'width':width,'height':844},device_scale_factor=2)
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('requestfailed',lambda r:failed_requests.append(r.url))
  page.route('http://**/*',lambda route:(requests.append(route.request.url),route.abort()))
  page.route('https://**/*',lambda route:(requests.append(route.request.url),route.abort()))
  for name in names:
   page.goto((root/'screens'/(name+'.html')).as_uri(),wait_until='load')
   page.evaluate('document.fonts.ready')
   assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(name,width,'horizontal overflow')
   assert not page.locator('img').evaluate_all('(images)=>images.some(i=>!i.complete||i.naturalWidth===0)'),(name,width,'image load')
   primary=page.locator('.primary')
   for el in primary.all():
    assert el.evaluate('e=>getComputedStyle(e).backgroundColor')=='rgb(35, 24, 21)',(name,width,'primary colour')
    assert el.evaluate('e=>getComputedStyle(e).color')=='rgb(255, 255, 255)',(name,width,'primary text')
   if name=='profile':
    assert page.locator('.personal-card').count()==1 and page.locator('.documents-card').count()==1
    assert page.locator('.profile-info-row').count()==3
    assert page.locator('[data-handler="verifyIdentity"]').count()==0
    for row in page.locator('.document-actions').all():
     boxes=[e.bounding_box() for e in row.locator('wx-button').all()]
     assert all(abs(b['y']-boxes[0]['y'])<1 for b in boxes),(width,'document button alignment')
   if name=='catalog':
    assert page.locator('.view-label').evaluate('e=>getComputedStyle(e).backgroundColor')=='rgb(35, 24, 21)'
   if width==390:
    page.screenshot(path=str(images/(name+'-390.png')),full_page=True)
    page.screenshot(path=str(images/(name+'-first-screen.png')),full_page=False)
   results.append({'page':name,'width':width,'passed':True})
  page.close()
 # Local navigation is demonstrable, while transactional controls do nothing.
 page=browser.new_page(viewport={'width':390,'height':844})
 page.goto((root/'screens/home.html').as_uri());page.locator('.hero-button').click();assert page.url.endswith('/catalog.html')
 page.goto((root/'screens/mine.html').as_uri());page.locator('.identity-entry').click();assert page.url.endswith('/profile.html')
 page.goto((root/'screens/bill.html').as_uri());before=page.url;page.locator('.primary').click();assert page.url==before
 page.close()
 for group,selected,full in [('overview',['home','catalog','use','mine'],False),('details',['profile','payments','bill'],True)]:
  titles={r['name']:r['title'] for r in manifest['pages']}
  suffix='-390.png' if full else '-first-screen.png'
  cards=''.join('<section><div class="caption"><b>'+titles[n]+'</b><span>0'+str(i+1)+'</span></div><img src="images/'+n+suffix+'"></section>' for i,n in enumerate(selected))
  board='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#e9ebed;font-family:'Microsoft YaHei',sans-serif;color:#231815;padding:32px}header{display:flex;align-items:flex-start;justify-content:space-between;border-top:5px solid #fcc900;padding-top:20px;margin-bottom:28px}h1{font-size:26px;margin:0 0 8px;font-weight:600}.sub{font-size:13px;color:#65615c;line-height:1.8}.stamp{font-size:12px;letter-spacing:2px;padding-top:5px}.grid{display:grid;grid-template-columns:repeat('''+str(len(selected))+''',390px);gap:24px;align-items:start}.caption{display:flex;justify-content:space-between;font-size:15px;padding:0 2px 12px}.caption span{color:#65615c;font-size:12px}section img{width:390px;display:block;border:1px solid #d8d8d5;border-radius:12px}footer{font-size:12px;color:#65615c;margin-top:24px;line-height:1.8}</style><header><div><h1>宁达汽车 · 小程序视觉优化</h1><div class="sub">VI 标准黄 #FCC900 · 黑灰操作 #231815 · 沿用现有页面布局</div></div><div class="stamp">VISUAL REVIEW / 01</div></header><main class="grid">'''+cards+'''</main><footer>视觉样稿，未改正式 UI。全部资料、金额与状态为合成示例；车型图为示意，非库存实拍。<br>车型照片 © S5A-0043 / Wikimedia Commons / CC BY 2.0，沿用项目已存设计素材。</footer></html>'''
  (root/(group+'.html')).write_text(board,encoding='utf-8')
  page=browser.new_page(viewport={'width':64+len(selected)*390+(len(selected)-1)*24,'height':1000},device_scale_factor=1.5)
  page.goto((root/(group+'.html')).as_uri(),wait_until='load');page.screenshot(path=str(root/(group+'.png')),full_page=True);page.close()
 browser.close()
assert not errors and not requests and not failed_requests,(errors,requests,failed_requests)
workspace=root.parents[3]
for item in manifest['sourceFiles']:
 path=workspace/item['path']
 assert hashlib.sha256(path.read_bytes()).hexdigest()==item['sha256'],str(path)+' changed during proposal'
def lum(h):
 vals=[int(h[i:i+2],16)/255 for i in (1,3,5)]
 vals=[c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in vals]
 return sum(c*w for c,w in zip(vals,[.2126,.7152,.0722]))
def contrast(a,b):
 a,b=sorted([lum(a),lum(b)],reverse=True);return round((a+.05)/(b+.05),2)
report={'screens':len(names),'layouts':results,'jsErrors':errors,'externalRequests':requests,'productFilesChangedDuringProposal':False,'contrast':{'whiteOnInk':contrast('#FFFFFF','#231815'),'inkOnYellow':contrast('#231815','#FCC900'),'mutedOnWhite':contrast('#65615C','#FFFFFF')},'scope':'Local visual proposal only; not WeChat device verification'}
(root/'layout-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'screens':len(names),'layoutsPassed':len(results),'externalRequests':len(requests),'contrast':report['contrast']}))
