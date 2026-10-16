// Offline actual-wcc display only; synthetic data, no native SDK or business API.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { pathToFileURL } = require('node:url'), { spawnSync } = require('node:child_process');
const { compile } = require('./compile-templates.cjs'), { createApi } = require('../src/services/api'), config = require('../src/config');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'evidence/settings-readiness-layout'), htmlDir = path.join(root, '.artifacts/settings-readiness-layout');
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(htmlDir, { recursive: true });
const compiled = compile(), generate = vm.runInNewContext('(function(global){' + compiled.wxml + '})({})', { window: {}, console }), definitions = {};
for (const name of ['sign', 'settings', 'middle']) vm.runInNewContext(fs.readFileSync(path.join(root, 'src', name === 'middle' ? 'pagesFace/pages/middle/middle.js' : 'pages/' + name + '/index.js'), 'utf8'), { require: () => ({}), Page: value => { definitions[name] = value; } });
const cases = [
  {name:'settings-verified-certificate-ready',route:'settings',enabled:true,identityVerified:true,readiness:{realNameStatus:'VERIFIED',certBound:true,readyForSigning:true},text:'签署证书已就绪',webview:false},
  {name:'settings-verified-certificate-pending',route:'settings',enabled:true,identityVerified:true,readiness:{realNameStatus:'VERIFIED',certBound:false,readyForSigning:false},text:'签署证书尚待核验',webview:false},
  {name:'settings-pending-verification',route:'settings',enabled:true,readiness:{realNameStatus:'PENDING',certBound:false,readyForSigning:false},text:'实名核验处理中',webview:false},
  {name:'settings-disabled-unverified',route:'settings',enabled:false,readiness:{realNameStatus:'NOT_STARTED',certBound:false,readyForSigning:false},text:'小程序内实名与签署暂未启用',webview:false},
  {name:'settings-verified-query-error',route:'settings',enabled:true,identityVerified:true,error:'查询未完成，请稍后主动查询。',readiness:{realNameStatus:'VERIFIED',certBound:true,readyForSigning:true},text:'查询未完成',webview:false},
];
const encode = value => JSON.stringify(value).replaceAll('<', '\u003c');
const renderer = `function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag);for(const[k,v]of Object.entries(t.attr||{})){if(/^(bind|catch)/.test(k)||['value','checked'].includes(k)||v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}if(t.tag==='wx-checkbox'){const i=document.createElement('input');i.type='checkbox';i.checked=!!t.attr?.checked;e.append(i);}else if(['wx-input','wx-textarea'].includes(t.tag)){const i=document.createElement(t.tag==='wx-input'?'input':'textarea');i.value=t.attr?.value||'';e.append(i);}else if(t.tag==='wx-web-view'){e.textContent='离线供应商页面容器 · 未加载供应商网页';e.style.cssText='display:flex;align-items:center;justify-content:center;min-height:700px;padding:20px;background:#F4F3EF;';}else(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
async function main() {
  for (const item of cases) {
    const route=item.route||'sign';
    const data={...definitions[route].data,loading:false,error:'',kind:item.kind||'',title:{identity:'实名与证书准备',contract:'主合同签署',handover:'交接单签署','order-change':'订阅变更补充协议签署'}[item.kind]||'',enabled:item.enabled!==false,status:item.status||'PENDING',statusError:item.statusError||'',message:item.status==='SIGNED'?'服务端已确认双方签署并归档，实际交付或资金另行核对。':'页面返回不能代替服务端核验。',url:item.webview?(item.kind==='identity'?'https://realnameverify16.fadada.com/synthetic':'https://textapi17.fadada.com/api2/synthetic'):''};
    if(route==='middle')Object.assign(data,{ready:false,error:'刷脸跳转尚未配置完成，请返回当前实名或签署流程查询，并联系运营。'});
    if(route==='settings')Object.assign(data,{authenticated:true,customerServiceTelephone:config.customerServiceTelephone,message:'',profile:{name:'离线合成账户'},consentCurrent:true,legalDocuments:[{id:'t1',type:'terms',title:'合成用户协议',version:1,content:'合成正文'},{id:'p1',type:'privacy',title:'合成隐私政策',version:2,content:'合成正文'}],readiness:item.readiness,identityAccepted:false,signingConfig:{enabled:item.enabled===true,signProviderConfigured:true,faceBridgeConfigured:false},paymentVerifications:[]});
    if(route==='settings'){const instance={data,setData:v=>Object.assign(data,v)};definitions.settings.applyReadiness.call(instance,item.readiness);data.error=item.error||'';}
    const tree = generate(route === 'middle' ? 'pagesFace/pages/middle/middle.wxml' : 'pages/' + route + '/index.wxml')(data);
    fs.writeFileSync(path.join(htmlDir, item.name + '.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(root, 'scripts/preview/preview.css')).href}"></head><body class="phone-body"><header id="preview-navigation">原生实名与签署 · 离线合成排版核验</header><main id="preview-page"></main><script>${renderer};document.getElementById('preview-page').append(render(${encode(tree)}));const styles=(function(global){${compiled.wxss}})({});for(const file of ['app.wxss','${route === 'middle' ? 'pagesFace/pages/middle/middle.wxss' : 'pages/' + route + '/index.wxss'}'])styles(file)('',{deviceWidth:390,allowIllegalSelector:true});</script></body></html>`);
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), scope: 'Offline actual-wcc synthetic layout only. No API, SDK, clipboard, browser external navigation, QR, SMS, payment, signing, preview or upload.', viewport: { width: 390, height: 844 }, cases }, null, 2) + '\n');
  const python = `
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
html_dir=Path(${JSON.stringify(htmlDir)})
out=Path(${JSON.stringify(out)})
report=json.loads((out/'report.json').read_text(encoding='utf-8'))
errors=[]
external=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport=report['viewport'],device_scale_factor=1)
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.on('request',lambda req:external.append(req.url) if req.url.startswith(('http:','https:')) else None)
    for item in report['cases']:
        page.goto((html_dir/(item['name']+'.html')).as_uri(),wait_until='load')
        text=page.locator('#preview-page').inner_text()
        assert item['text'] in text,item['name']
        assert page.locator('wx-web-view').count()==int(item['webview']),item['name']
        assert page.locator('wx-button').filter(has_text='复制签约入口').count()==0,item['name']
        assert '服务号菜单已添加' not in text
        if item.get('status')=='UNKNOWN' or item.get('status')=='PENDING': assert '双方签署已归档' not in text,item['name']
        if item.get('route')=='settings':
            assert page.locator('wx-input').count()==(0 if item.get('identityVerified') else 2),item['name']
            assert page.locator('wx-button').filter(has_text='办理本人实名核验').count()==(0 if item.get('identityVerified') else 1),item['name']
            assert page.locator('wx-button').filter(has_text='核验实名与证书状态').count()==1,item['name']
            if item.get('identityVerified'): assert '已完成实名核验' in text,item['name']
        item['overflow']=page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
        assert not item['overflow'],item['name']
        item['screenshot']=item['name']+'.png'
        page.screenshot(path=str(out/item['screenshot']),full_page=True)
        item['passed']=True
    browser.close()
assert not errors,errors
assert not external,external
report.update(browser='Microsoft Edge headless via Playwright',runtimeErrors=errors,externalRequests=external)
(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\\n',encoding='utf-8')
print(json.dumps(dict(cases=len(report['cases']),screenshots=len(report['cases']),runtimeErrors=errors,externalRequests=external)))
`;
  const result = spawnSync('python', ['-c', python], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout); if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error; process.exitCode = result.status || 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
