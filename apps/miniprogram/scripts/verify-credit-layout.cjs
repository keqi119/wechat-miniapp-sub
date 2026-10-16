// Offline actual-wcc verification; explicitly synthetic display data only.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { compile } = require('./compile-templates.cjs');
const { createApi } = require('../src/services/api');
const config = require('../src/config');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'evidence/credit-layout'), htmlDir = path.join(root, '.artifacts/credit-layout');
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(htmlDir, { recursive: true });
const compiled = compile(), generate = vm.runInNewContext('(function(global){' + compiled.wxml + '})({})', { window: {}, console });
let definition; vm.runInNewContext(fs.readFileSync(path.join(root, 'src/pages/application-detail/index.js'), 'utf8'), { require: () => ({}), Page: value => { definition = value; } });
const document = { id: 'qa-credit-document', type: 'credit-verification', version: 1, title: '人工核验芝麻分及押金规则说明', content: '离线合成排版说明，不作为生产文案。' };
const base = { applicationId: 'qa-application', creditRevision: 1, ruleVersion: 'ZHIMA_MANUAL_V1', document, consent: null, verification: null, status: 'CONSENT_REQUIRED', canConsent: true, canDecline: true, consentRequirementsMet: true, canWithdraw: false, verificationCurrent: false, canConfirmFinalPlan: false, depositMultiplier: null };
const consent = { id: 'qa-consent', status: 'ACCEPTED', documentId: document.id, version: 1, acceptedAt: '2026-10-16T08:00:00Z' };
const bands = { GE750: '750分及以上', B700_749: '700—749分', B650_699: '650—699分', LT650: '低于650分', UNVERIFIABLE: '无法核验' };
const cases = [
  { name: 'unpublished', raw: { ...base, document: null, canConsent: false, canDecline: false }, text: '当前正式核验说明暂不可用' },
  { name: 'separate-consent-required', raw: base, checkbox: true, text: '单独授权本申请人工核验' },
  { name: 'privacy-update-required', raw: { ...base, canConsent: false, consentRequirementsMet: false }, text: '到账户设置查看并更新协议', decline: true },
  { name: 'accepted-awaiting-review', raw: { ...base, consent, status: 'AWAITING_VERIFICATION', canWithdraw: true }, text: '已授权，等待人工核验' },
  ...Object.keys(bands).map((band, index) => ({ name: 'verified-' + band.toLowerCase(), raw: { ...base, creditRevision: 2, consent, verification: { id: 'qa-verification', band, consentId: consent.id, verifiedAt: '2026-10-16T08:30:00Z' }, status: index < 3 ? 'VERIFIED' : 'MANUAL_REVIEW', verificationCurrent: true, canConfirmFinalPlan: index < 3, canWithdraw: true, depositMultiplier: index < 3 ? index : null }, text: '档位：' + bands[band] })),
  { name: 'withdrawn', raw: { ...base, consent: { ...consent, status: 'WITHDRAWN', withdrawnAt: '2026-10-16T09:00:00Z' }, status: 'CONSENT_REQUIRED' }, text: '已撤回后续核验授权', checkbox: true },
  { name: 'historical-contract', raw: { ...base, consent, status: 'HISTORICAL', canConsent: false, canDecline: false, canWithdraw: true }, text: '申请结束后的历史核验' },
];
const encode = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const renderer = `function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag);for(const[k,v]of Object.entries(t.attr||{})){if(/^(bind|catch)/.test(k)||['value','checked'].includes(k)||v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}if(t.tag==='wx-checkbox'){const i=document.createElement('input');i.type='checkbox';i.checked=!!t.attr?.checked;e.append(i);}else(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
async function main() {
  for (const item of cases) {
    const api = createApi(config, value => value.success({ statusCode: 200, data: item.raw }), { getStorageSync: () => ({ token: 'offline-synthetic', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'qa-customer' } }) });
    const creditReview = await api.getCreditReview('qa-application');
    const data = { ...definition.data, loading: false, application: { id: 'qa-application', status: 'IN_REVIEW', statusText: '人工审核中', title: '离线合成申请', vehicleName: '离线合成车型', planTitle: '离线合成方案', monthlyFeeText: '¥5,199.00', timeline: [] }, creditReview };
    const tree = generate('pages/application-detail/index.wxml')(data);
    fs.writeFileSync(path.join(htmlDir, item.name + '.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(root, 'scripts/preview/preview.css')).href}"></head><body class="phone-body"><header id="preview-navigation">申请详情 · 离线合成排版核验</header><main id="preview-page"></main><script>${renderer};document.getElementById('preview-page').append(render(${encode(tree)}));const styles=(function(global){${compiled.wxss}})({});for(const file of ['app.wxss','pages/application-detail/index.wxss'])styles(file)('',{deviceWidth:390,allowIllegalSelector:true});</script></body></html>`);
    delete item.raw;
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), scope: 'Offline actual-wcc templates with synthetic application/credit display data. Browser layout only; no business API, native SDK, real consent/credit review, preview or upload.', viewport: { width: 390, height: 844 }, cases }, null, 2) + '\n');
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
        boxes=page.locator('wx-checkbox input')
        assert boxes.count()==(1 if item.get('checkbox') else 0),item['name']
        if boxes.count(): assert not boxes.is_checked(),item['name']
        if item.get('decline'): assert page.locator('wx-button').filter(has_text='暂不授权，转人工联系处理').count()==1
        assert page.locator('wx-input').count()==0
        assert '请勿上传信用页面截图' in text
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
