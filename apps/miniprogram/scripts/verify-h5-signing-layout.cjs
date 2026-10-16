// Offline actual-wcc display only; synthetic data, no native SDK or business API.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { pathToFileURL } = require('node:url'), { spawnSync } = require('node:child_process');
const { compile } = require('./compile-templates.cjs'), { createApi } = require('../src/services/api'), config = require('../src/config');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'evidence/h5-signing-layout'), htmlDir = path.join(root, '.artifacts/h5-signing-layout');
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(htmlDir, { recursive: true });
const compiled = compile(), generate = vm.runInNewContext('(function(global){' + compiled.wxml + '})({})', { window: {}, console }), definitions = {};
for (const name of ['sign', 'settings']) vm.runInNewContext(fs.readFileSync(path.join(root, 'src/pages', name, 'index.js'), 'utf8'), { require: () => ({}), Page: value => { definitions[name] = value; } });
const cases = [
  ...['identity', 'contract', 'handover', 'order-change'].map(kind => ({ name: 'entry-' + kind, kind, enabled: true, text: '使用与小程序相同手机号', copy: true })),
  { name: 'entry-disabled', kind: 'contract', enabled: false, text: '签约入口尚未启用', copy: false },
  { name: 'entry-config-error', kind: 'contract', error: '合成配置错误：签约中心尚未核验', text: '签约中心尚未核验', copy: false },
  { name: 'returned-pending', kind: 'contract', enabled: true, status: 'PENDING', message: '服务端尚未确认完成，复制或返回小程序均不代表签署成功。', text: '结果待核实', copy: true },
  { name: 'returned-signed', kind: 'contract', enabled: true, status: 'SIGNED', message: '服务端已确认双方签署并归档，交付与资金状态另行核对。', text: '双方签署已归档', copy: true },
  { name: 'identity-verified', kind: 'identity', enabled: true, status: 'VERIFIED', text: '实名与证书已就绪', copy: true },
  ...['contract', 'handover', 'order-change'].map(kind => ({ name: 'query-error-' + kind, kind, enabled: true, status: 'UNKNOWN', statusError: '合成403/409或网络错误：查询未完成，结果尚未核实。', text: '查询未完成，结果尚未核实', copy: true })),
  { name: 'settings-no-identity-input', route: 'settings', text: '实名资料在微信签约网页中填写', copy: false },
];
const encode = value => JSON.stringify(value).replaceAll('<', '\u003c');
const renderer = `function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag);for(const[k,v]of Object.entries(t.attr||{})){if(/^(bind|catch)/.test(k)||['value','checked'].includes(k)||v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}if(t.tag==='wx-checkbox'){const i=document.createElement('input');i.type='checkbox';i.checked=!!t.attr?.checked;e.append(i);}else if(['wx-input','wx-textarea'].includes(t.tag)){const i=document.createElement(t.tag==='wx-input'?'input':'textarea');i.value=t.attr?.value||'';e.append(i);}else(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
async function main() {
  for (const item of cases) {
    const route = item.route || 'sign', data = { ...definitions[route].data, loading: false, error: item.error || '', status: item.status || 'UNKNOWN', statusError: item.statusError || '', message: item.message || '' };
    if (route === 'sign' && !item.error) {
      const api = createApi(config, v => v.success({ statusCode: 200, data: { mode: 'SERVICE_ACCOUNT_H5', entryUrl: 'https://app.subauto.keybox.cloud/miniapp-sign/', enabled: item.enabled } }), { getStorageSync: () => ({ token: 'offline-synthetic', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'qa-customer' } }) });
      data.signing = await api.getSigningGuidance(item.kind, item.kind === 'identity' ? 'qa-customer' : 'qa-record');
    }
    if (route === 'settings') Object.assign(data, { authenticated: true, profile: { name: '离线合成账户' }, consentCurrent: true, customerServiceTelephone: config.customerServiceTelephone, readiness: { readyForSigning: false, realNameStatus: 'NOT_STARTED' }, paymentVerifications: [] });
    const tree = generate('pages/' + route + '/index.wxml')(data);
    fs.writeFileSync(path.join(htmlDir, item.name + '.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(root, 'scripts/preview/preview.css')).href}"></head><body class="phone-body"><header id="preview-navigation">签约指引 · 离线合成排版核验</header><main id="preview-page"></main><script>${renderer};document.getElementById('preview-page').append(render(${encode(tree)}));const styles=(function(global){${compiled.wxss}})({});for(const file of ['app.wxss','pages/${route}/index.wxss'])styles(file)('',{deviceWidth:390,allowIllegalSelector:true});</script></body></html>`);
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
        assert page.locator('wx-web-view').count()==0,item['name']
        assert page.locator('wx-button').filter(has_text='复制签约入口').count()==int(item['copy']),item['name']
        assert '服务号菜单已添加' not in text
        if item.get('status')=='UNKNOWN' or item.get('status')=='PENDING': assert '双方签署已归档' not in text,item['name']
        if item.get('route')=='settings': assert page.locator('wx-input').count()==0,item['name']
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
