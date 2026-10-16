// Offline actual-wcc layout verification. Synthetic data never enters the release package.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { compile } = require('./compile-templates.cjs');
const root = path.resolve(__dirname, '..');
const htmlDir = path.join(root, '.artifacts/payment-verification-layout');
const out = path.join(root, 'evidence/payment-verification-layout');
fs.mkdirSync(htmlDir, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const compiled = compile();
const generate = vm.runInNewContext('(function(global){' + compiled.wxml + '})({})', { window: {}, console });
let definition;
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/pages/settings/index.js'), 'utf8'), { require: () => ({}), Page: value => { definition = value; } });
const row = (status, resumeAllowed = false) => definition.verificationRow({ id: 'qa-offline-verification', amount: 1, currency: 'CNY', title: '微信支付验收', amountText: '¥0.01', status, statusText: { AUTHORIZED: '已授权，尚未付款', PENDING: '支付结果待确认', SUCCEEDED: '支付成功' }[status], canPay: status !== 'SUCCEEDED', expiresAt: '2099-01-01T00:00:00Z' }, resumeAllowed);
const cases = [
  { name: 'anonymous', authenticated: false, records: [] },
  { name: 'no-authorization', records: [] },
  { name: 'authorized', records: [row('AUTHORIZED')], pay: '支付 0.01 元', enabled: true },
  { name: 'consent-required', records: [row('AUTHORIZED')], consentCurrent: false, pay: '支付 0.01 元', enabled: false },
  { name: 'pending-query-only', records: [row('PENDING')] },
  { name: 'pending-explicit-resume', records: [row('PENDING', true)], pay: '继续本次验收（0.01 元）', enabled: true },
  { name: 'query-failed', records: [{ ...row('PENDING'), canStart: false, resumeAllowed: false }], verificationError: '查询未完成，结果尚未核实，请稍后重新查询。' },
  { name: 'server-confirmed-paid', records: [row('SUCCEEDED')] },
  { name: 'expired-manual-review', records: [{ ...row('PENDING'), status: 'EXPIRED', statusText: '需人工核对支付结果', canPay: false, canStart: false, resumeAllowed: false, manualReviewRequired: true, statusMessage: '授权已到期，渠道暂未查到本单，需人工核对；不能认定未扣款。' }] },
];
const escape = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const renderer = `function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag);for(const[k,v]of Object.entries(t.attr||{})){if(/^(bind|catch)/.test(k)||['value','checked'].includes(k)||v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}if(t.tag==='wx-input'){const i=document.createElement('input');i.value=t.attr?.value||'';e.append(i);}else if(t.tag==='wx-checkbox'){const i=document.createElement('input');i.type='checkbox';i.checked=!!t.attr?.checked;e.append(i);}else(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
for (const item of cases) {
  const data = { ...definition.data, authenticated: true, consentCurrent: true, profile: { name: '离线合成排版账户', mobile: '仅离线排版' }, legalDocuments: [{ id: 'qa-terms', type: 'terms', title: '用户协议', version: 1 }, { id: 'qa-privacy', type: 'privacy', title: '隐私政策', version: 1 }], customerServiceTelephone: '18616570212', readiness: { readyForSigning: false }, ...item, paymentVerifications: item.records };
  const tree = generate('pages/settings/index.wxml')(data);
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(root, 'scripts/preview/preview.css')).href}"></head><body class="phone-body"><header id="preview-navigation"><span>账户设置 · 离线合成排版核验</span></header><main id="preview-page"></main><script>${renderer};document.getElementById('preview-page').append(render(${escape(tree)}));const styles=(function(global){${compiled.wxss}})({});for(const file of ['app.wxss','pages/settings/index.wxss'])styles(file)('',{deviceWidth:390,allowIllegalSelector:true});</script></body></html>`;
  fs.writeFileSync(path.join(htmlDir, item.name + '.html'), html);
}
const report = { generatedAt: new Date().toISOString(), scope: 'Offline actual-wcc templates with explicitly synthetic display data; browser layout only. No business API, native SDK, real payment, production customer, preview or upload.', viewport: { width: 390, height: 844 }, cases };
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
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
        visible=bool(item['records']) and item.get('authenticated',True)
        assert ('微信支付验收' in text)==visible,item['name']
        pay=page.locator('wx-button').filter(has_text='0.01 元')
        assert pay.count()==(1 if item.get('pay') else 0),item['name']
        if item.get('pay'):
            assert pay.inner_text()==item['pay']
            assert (pay.get_attribute('disabled') is None)==item['enabled']
        if visible:
            assert '不订阅车辆、不生成租赁合同' in text
            assert page.locator('[data-id="qa-offline-verification"]').filter(has_text='查询本次验收状态').count()==1
        if item['name']=='expired-manual-review':
            assert '不能认定未扣款' in text
            assert '需人工核对支付结果' in text
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
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
process.exitCode = result.status || 0;
