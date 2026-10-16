// Offline actual-wcc display fixtures only; never uses a business API or native SDK.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { compile } = require('./compile-templates.cjs');
const { createApi } = require('../src/services/api');
const config = require('../src/config');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'evidence/delivery-delay-layout'), htmlDir = path.join(root, '.artifacts/delivery-delay-layout');
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(htmlDir, { recursive: true });
const compiled = compile(), generate = vm.runInNewContext('(function(global){' + compiled.wxml + '})({})', { window: {}, console });
const definitions = {};
for (const name of ['record', 'records', 'use']) vm.runInNewContext(fs.readFileSync(path.join(root, 'src/pages', name, 'index.js'), 'utf8'), { require: () => ({}), Page: value => { definitions[name] = value; } });
const document = { id: 'qa-legal', type: 'delivery-delay-amendment', version: 1, hash: 'a'.repeat(64), content: '离线合成排版资料，不是生产法律文本。\n本次协商将交车日期顺延，保持原订阅月数。双方核对逐期费用、原款沿用、补款及退款后另行签署；未完成真实资金核对与后台生效前，不代表已经交车。' };
const period = { sequence: 1, startDate: '2026-11-16', endDate: '2026-12-16', dueDate: '2026-11-10', amount: 519900, originalAmount: 519900, netPaidAmount: 519900, carryAmount: 500000, chargeAmount: 19900, refundAmount: 19900, calculationBasis: '离线合成：本期金额5199元，原成功交易净实收5199元；安排沿用5000元，补收与退款各199元。' };
const base = { id: 'qa-change', orderId: 'qa-order', kind: 'DELIVERY_DELAY', revision: 3, status: 'AWAITING_CONFIRMATION', reason: '合成延期交车方案', quote: { id: 'qa-quote', revision: 1, commercialHash: 'b'.repeat(64), newStartDate: period.startDate, newEndDate: '2026-12-15', months: 1, expiresAt: '2099-01-01T00:00:00Z', periods: [period], reason: '双方协商调整', settlementExplanation: '原款按实际成功交易核对后沿用，不重复收款；差额另立普通账单，退款由财务核实。', handoverArrangement: '按本次确认日期预约现场交车，实际交车另核对证据并签署交接单。', cancellationTerms: '如再延期或无法履行，转人工逐单协商，不自动退订或扣押金。', document }, contract: null, finance: { obligations: [], refunds: [], blockers: [] }, blockers: [], capabilityNote: '离线合成显示：签署、资金和生效分别记录。', canConfirm: true, canReject: true, canSign: false, canSync: false };
const pending = { ...base, status: 'AWAITING_FINANCE', canConfirm: false, canReject: false, canSync: true, contract: { id: 'qa-contract', status: 'SIGNED', sourceFileId: 'qa-pdf', signedFileId: 'qa-signed' }, finance: { obligations: [{ ...period, allocatedAmount: 500000, chargeBillId: 'qa-bill', chargeStatus: 'PUBLISHED' }], refunds: [{ id: 'qa-refund', amount: 19900, status: 'PROCESSING' }], blockers: ['退款渠道结果仍待核实，不能报为全部业务完成。'] } };
const cases = [
  { name: 'delay-draft-hidden', raw: { ...base, status: 'DRAFT', quote: null, canConfirm: false, canReject: false }, text: '正式方案尚待发布', boxes: 0 },
  { name: 'delay-formal-unchecked', raw: base, text: '2026.12.15（含当日）', boxes: 1, enabled: false },
  { name: 'delay-explicit-reading', raw: base, accepted: true, text: '原款净实收', boxes: 1, enabled: true },
  { name: 'delay-document-unavailable', raw: { ...base, quote: { ...base.quote, document: null } }, text: '正式延期补充条款尚不可用', boxes: 0 },
  { name: 'delay-confirmation-expired', raw: { ...base, quote: { ...base.quote, expiresAt: '2020-01-01T00:00:00Z' }, canConfirm: false }, text: '本版本客户确认期限已过', boxes: 0 },
  { name: 'delay-confirmed-expired-continues', raw: { ...base, status: 'AWAITING_SIGNATURE', quote: { ...base.quote, expiresAt: '2020-01-01T00:00:00Z', confirmedAt: '2019-12-31T08:00:00Z' }, canConfirm: false, canReject: false, canSign: true }, text: '查看补充协议签约指引', forbiddenText: '本版本客户确认期限已过', boxes: 0 },
  { name: 'delay-awaiting-signature', raw: { ...base, status: 'AWAITING_SIGNATURE', canConfirm: false, canReject: false, canSign: true, canSync: true, contract: { id: 'qa-contract', status: 'PENDING', sourceFileId: 'qa-pdf' } }, text: '查看补充协议签约指引', boxes: 0 },
  { name: 'delay-signed-finance-pending', raw: pending, text: '退款渠道结果仍待核实', boxes: 0 },
  { name: 'delay-applied-server-state', raw: { ...pending, status: 'APPLIED', finance: { obligations: [], refunds: [], blockers: [] } }, text: '延期方案已生效', boxes: 0 },
  { name: 'delay-list', raw: base, route: 'records', text: '延期交车补充方案', boxes: 0 },
  { name: 'delay-dashboard-link', raw: base, route: 'use', text: '查看本订阅延期交车方案', boxes: 0, forbiddenText: '用车中' },
];
const encode = value => JSON.stringify(value).replaceAll('<', '\u003c');
const renderer = `function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag);for(const[k,v]of Object.entries(t.attr||{})){if(/^(bind|catch)/.test(k)||['value','checked'].includes(k)||v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}if(t.tag==='wx-checkbox'){const i=document.createElement('input');i.type='checkbox';i.checked=!!t.attr?.checked;e.append(i);}else if(['wx-input','wx-textarea'].includes(t.tag)){const i=document.createElement(t.tag==='wx-input'?'input':'textarea');i.value=t.attr?.value||'';e.append(i);}else(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
async function main() {
  for (const item of cases) {
    const api = createApi(config, value => { const { id, orderId, kind, status, revision, reason, createdAt, quote } = item.raw; const quoteSummary = quote ? { id: quote.id, revision: quote.revision, newStartDate: quote.newStartDate, newEndDate: quote.newEndDate, months: quote.months, commercialHash: quote.commercialHash, expiresAt: quote.expiresAt } : null; value.success({ statusCode: 200, data: value.url.endsWith('/customer/order-changes') ? { items: [{ id, orderId, kind, status, revision, reason, createdAt, quoteSummary }], total: 1, page: 1, pageSize: 50 } : item.raw }); }, { getStorageSync: () => ({ token: 'offline-synthetic', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'qa-customer' } }) });
    const change = await api.getOrderChange('qa-change'), route = item.route || 'record';
    const data = { ...definitions[route].data, loading: false, error: '', type: 'orderchanges', title: '延期交车方案', record: change, change, changeRead: item.accepted === true, items: [change] };
    if (route === 'records') data.items = (await api.getOrderChanges()).items;
    if (route === 'use') Object.assign(data, { subscription: { id: 'qa-order', statusText: '待交车', vehicleName: '离线合成待交车车辆', planTitle: '离线合成套餐', deliveryDelayChangeId: change.id, monthlyFeeText: '¥5,199.00' }, todos: [], bill: null, services: [], entitlements: [] });
    const tree = generate('pages/' + route + '/index.wxml')(data);
    fs.writeFileSync(path.join(htmlDir, item.name + '.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(root, 'scripts/preview/preview.css')).href}"></head><body class="phone-body"><header id="preview-navigation">延期交车 · 离线合成排版核验</header><main id="preview-page"></main><script>${renderer};document.getElementById('preview-page').append(render(${encode(tree)}));const styles=(function(global){${compiled.wxss}})({});for(const file of ['app.wxss','pages/${route}/index.wxss'])styles(file)('',{deviceWidth:390,allowIllegalSelector:true});</script></body></html>`);
    delete item.raw;
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), scope: 'Offline actual-wcc template layout using synthetic display data only. No API, SDK, signing, payments, DevTools preview or publishing.', viewport: { width: 390, height: 844 }, cases }, null, 2) + '\n');
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
        if item.get('forbiddenText'): assert item['forbiddenText'] not in text,item['name']
        boxes=page.locator('wx-checkbox input')
        assert boxes.count()==item['boxes'],item['name']
        if boxes.count(): assert boxes.is_checked()==item.get('accepted',False),item['name']
        if 'enabled' in item:
            button=page.locator('wx-button').filter(has_text='确认本版本延期方案')
            assert button.count()==1,item['name']
            assert (button.get_attribute('disabled') is None)==item['enabled'],item['name']
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
