// Actual WCC/WCSC sources with synthetic records in an isolated headless browser.
// No service, SDK, network, user browser, upload, or real customer data is used.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url'),compiler=require('miniprogram-compiler');
const root=path.resolve(__dirname,'..'),repo=path.resolve(root,'../..'),out=path.join(repo,'.runtime/ninda/profile-layout-20261029/layout'),html=path.join(out,'html');
fs.mkdirSync(html,{recursive:true});
const sources=['pages/profile/index.js','pages/profile/index.wxml','pages/profile/index.wxss'];
const code=fs.readFileSync(path.join(root,'src',sources[0]),'utf8');let definition;
vm.runInNewContext(code,{Page:v=>definition=v,require:id=>id.includes('config')?{customerServiceTelephone:'13800000000'}:id.includes('handover-location')?require('../src/utils/handover-location'):{}});
const options={maxBuffer:16*1024*1024},wxml=compiler.wxmlToJs(path.join(root,'src'),{...options,wxmlList:[sources[1]]}),wxss=compiler.wxssToJs(path.join(root,'src'),{...options,wxssList:['app.wxss',sources[2]]});
const render=vm.runInNewContext('(function(global){'+wxml+'})({})',{window:{},console})(sources[1]);
const docs=['terms','privacy'].map(type=>({id:type,type,version:8,content:'合成已发布条款'}));
const base={...definition.data,authenticated:true,profile:{name:'合成客户'},name:'合成客户',profileMobile:'13800000000',drivingYears:'3',identityEnabled:true,identityStatusText:'未核验',legalDocuments:docs,legalDocumentsReady:true,consentCurrent:true};
const files={identityFront:{id:'front',name:'身份证人像面.jpg'},identityBack:{id:'back',name:'身份证国徽面.jpg'},drivingLicense:{id:'license',name:'驾驶证.jpg'}};
const cases=[
 {name:'anonymous',data:{authenticated:false}},
 {name:'empty-unverified',data:{}},
 {name:'uploaded-unverified',data:{profileFiles:files,identityFrontFileId:'front',identityBackFileId:'back',drivingLicenseFileId:'license'}},
 {name:'verified',data:{profileFiles:files,identityVerified:true,identityStatusText:'已实名',verifiedAt:'2026-10-29 10:00'}},
 {name:'amendment-payment',data:{applicationId:'synthetic-application',reviewNote:'请补充清晰完整的证件。\n核对交接地点。',note:'合成补充说明',locationEnabled:true,locationName:'停车场入口',locationAddress:'合成路1号',locationSaved:true,profileFiles:files,paymentVerifications:[{id:'synthetic-payment',title:'合成验收',amountText:'0.01元',statusText:'待查询',canStart:false}],consentCurrent:false}},
 {name:'long-feedback',data:{profileFiles:{...files,identityFront:{id:'front',name:'合成超长中文证件文件名需要正确换行并且不能挤出按钮.jpg'}},dirty:true},feedback:'资料版本已更新，请先核对当前资料。输入已保留，不会自动覆盖。\n'.repeat(20)}
];
const encode=v=>JSON.stringify(v).replaceAll('<','\\u003c');
const renderer=`function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag);for(const[k,v]of Object.entries(t.attr||{})){if(/^(bind|catch)/.test(k)||['value','checked'].includes(k)||v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}if(t.tag==='wx-checkbox'){const i=document.createElement('input');i.type='checkbox';i.checked=!!t.attr?.checked;e.append(i);}else if(['wx-input','wx-textarea'].includes(t.tag)){const i=document.createElement(t.tag==='wx-input'?'input':'textarea');i.value=t.attr?.value||'';i.placeholder=t.attr?.placeholder||'';e.append(i);}else(t.children||[]).forEach(c=>e.append(render(c)));if(t.attr?.bindtap==='dismissFeedback')e.addEventListener('click',()=>instance.dismissFeedback());return e;}`;
for(const item of cases){const data={...base,...item.data},tree=render(data);fs.writeFileSync(path.join(html,item.name+'.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${pathToFileURL(path.join(root,'scripts/preview/preview.css')).href}"><style>#preview-page{padding-bottom:0}wx-scroll-view{overflow-y:auto;overscroll-behavior:contain}wx-label.consent-row{display:flex}</style></head><body class="phone-body"><header id="preview-navigation">个人资料 · 离线合成排版</header><main id="preview-page"></main><script>${renderer};let def;function Page(v){def=v}function require(id){return id.includes('config')?{customerServiceTelephone:'13800000000'}:id.includes('handover-location')?{initialLocationData:()=>({})}:{};} ${code}
const generate=(function(global){${wxml}})({}),pageRender=generate('pages/profile/index.wxml');const instance={...def,data:${encode(data)},setData(value){Object.assign(this.data,value);document.querySelector('.profile-feedback')?.remove();if(this.data.feedback){const nodes=render(pageRender(this.data));const el=nodes.querySelector?.('.profile-feedback');if(el)document.getElementById('preview-page').append(el);}}};window.instance=instance;document.getElementById('preview-page').append(render(${encode(tree)}));const styles=(function(global){${wxss}})({});for(const file of ['app.wxss','pages/profile/index.wxss'])styles(file)('',{deviceWidth:innerWidth,allowIllegalSelector:true});</script></body></html>`);}
const report={scope:'Offline synthetic actual WCC/WCSC rendering only; not WeChat DevTools or device verification. No user browser or remote access.',generatedAt:new Date().toISOString(),source: sources.map(file=>({path:'apps/miniprogram/src/'+file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'src',file))).digest('hex')})),cases:cases.map(({name,feedback})=>({name,feedback:feedback||null}))};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const python=`
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path(${JSON.stringify(out)})
report=json.loads((out/'report.json').read_text(encoding='utf-8'))
results=[];errors=[];external=[]
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='msedge',headless=True)
 for width,height in [(320,700),(390,844)]:
  page=browser.new_page(viewport=dict(width=width,height=height),device_scale_factor=1)
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('http://**/*',lambda route:route.abort())
  page.route('https://**/*',lambda route:route.abort())
  page.on('request',lambda req:external.append(req.url) if req.url.startswith(('http:','https:')) else None)
  for item in report['cases']:
   page.goto((out/'html'/(item['name']+'.html')).as_uri(),wait_until='load')
   text=page.locator('#preview-page').inner_text()
   assert '未分类' not in text
   assert page.locator('wx-button[data-type="privacy"]').count()==1
   assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),item['name']
   result=dict(name=item['name'],width=width,height=height,overflow=False)
   if item['feedback']:
    page.evaluate('window.scrollTo(0,550)')
    before=page.evaluate('scrollY')
    page.evaluate('(message)=>instance.showFeedback(message)',item['feedback'])
    assert page.evaluate('scrollY')==before
    box=page.locator('.profile-feedback').bounding_box()
    assert box and box['y']>=0 and box['y']+box['height']<=height
    state=page.locator('.feedback-scroll').evaluate('(el)=>({height:el.clientHeight,total:el.scrollHeight})')
    assert state['height']<state['total'] and state['height']<=height*0.39,state
    page.locator('.feedback-scroll').evaluate('(el)=>el.scrollTop=200')
    assert page.locator('.feedback-scroll').evaluate('(el)=>el.scrollTop')>0
    assert page.evaluate('scrollY')==before
    result.update(scrollBefore=before,feedbackInternalScroll=state)
   screenshot=item['name']+'-'+str(width)+'.png'
   page.screenshot(path=str(out/screenshot),full_page=not bool(item['feedback']))
   if item['feedback']:
    page.locator('.feedback-close').click()
    assert page.locator('.profile-feedback').count()==0
    assert page.evaluate('scrollY')==before
    assert page.locator('wx-input[data-field="name"] input').input_value()=='合成客户'
    result['closePreservedScrollAndDraft']=True
   result.update(screenshot=screenshot,passed=True)
   results.append(result)
  page.close()
 browser.close()
assert not errors,errors
assert not external,external
report.update(results=results,runtimeErrors=errors,externalRequests=external)
(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\\n',encoding='utf-8')
print(json.dumps(dict(cases=len(results),screenshots=len(results),runtimeErrors=errors,externalRequests=external)))
`;
const result=spawnSync('python',['-c',python],{encoding:'utf8',maxBuffer:1024*1024,timeout:60000});if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);if(result.error)throw result.error;if(result.status!==0)process.exitCode=1;
