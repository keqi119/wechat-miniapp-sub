// Actual-wcc offline synthetic display only: no business HTTP, SDK, payment or signing.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { compile } = require('./compile-templates.cjs');
const { createApi } = require('../src/services/api');
const { vehicle, assignment, account, period, change } = require('../tests/fixtures/b2.cjs');
const config = require('../src/config');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'evidence/vehicle-change-layout'), htmlDir = path.join(root, '.artifacts/vehicle-change-layout');
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(htmlDir, { recursive: true });
const compiled = compile(), generate = vm.runInNewContext('(function(global){' + compiled.wxml + '})({})', { window: {}, console });
const definitions = {};
for (const name of ['record', 'records', 'mileage', 'handover', 'use']) vm.runInNewContext(fs.readFileSync(path.join(root, 'src/pages', name, 'index.js'), 'utf8'), { require: () => ({}), Page: value => { definitions[name] = value; } });
const oldSide = { id: 'return1', type: 'SWAP_RETURN', vehicleId: 'v-old', vehicleTitle: '合成旧车', assignmentId: 'a-old', changeId: 'vc1', status: 'COMPLETED', signatureStatus: 'SIGNED', actualAt: '2026-10-10T02:00:00Z', readingKm: 90500, manifestHash: 'f'.repeat(64), fileIds: [], checklist: [], evidence: [], customerResponse: 'CONFIRM' };
const newSide = { ...oldSide, id: 'delivery1', type: 'SWAP_DELIVERY', vehicleId: 'v-new', vehicleTitle: '合成新车', assignmentId: null, status: 'PUBLISHED', signatureStatus: 'DRAFT', actualAt: '2026-10-10T03:00:00Z', readingKm: 20, customerResponse: null };
const originalAssignment = assignment({ status: 'CLOSED', endAt: oldSide.actualAt, endReadingKm: 90500 });
const gap = change({ status: 'SWAP_RETURNED', originalAssignment, currentAssignment: null, returnHandover: oldSide, deliveryHandover: newSide, canConfirm: false, canReject: false, contract: { id: 'am1', status: 'SIGNED', signedFileId: 'signed1', sourceFileId: 'source1' } });
const segments = [{ id: 's-old', assignmentId: 'a-old', vehicleId: 'v-old', vehicleTitle: '合成旧车', startAt: '2026-09-16T02:00:00Z', endAt: oldSide.actualAt, startReadingKm: 90000, endReadingKm: 90500, readingId: null, status: 'READY', revision: 1, canSubmit: false }, { id: 's-new', assignmentId: 'a-new', vehicleId: 'v-new', vehicleTitle: '合成新车', startAt: newSide.actualAt, endAt: null, startReadingKm: 20, endReadingKm: null, readingId: null, status: 'OPEN', revision: 1, canSubmit: true }];
const usageRaw = { orderId: 'o1', orderStatus: 'ACTIVE', policyVersion: 'USAGE_V1', startedOn: '2026-09-16', returnedOn: null, baseAllowanceKm: 1500, excessPriceAmount: 150, packBalanceKm: 1000, packStatus: 'ACTIVE', currentAssignment: assignment({ id: 'a-new', vehicle: vehicle('v-new'), startReadingKm: 20 }), assignments: [originalAssignment, assignment({ id: 'a-new', vehicle: vehicle('v-new'), startReadingKm: 20 })], periods: [{ ...period, id: 'up1', effectiveEndDate: '2026-10-16', status: 'AWAITING_READING', revision: 1, startReadingKm: 90000, endReadingKm: null, usedKm: null, baseUsedKm: null, packUsedKm: null, excessKm: null, excessAmount: null, canSubmit: true, segments, reviewNote: '新车月界照片尚待补证，不估算月总用量。' }], packs: [], ledger: [], products: [], purchaseTerms: null, canPurchase: false };
const reserved = account({ cycle: { ...account().cycle, freeAvailable: 0, freeReserved: 1 }, canRequest: false, reservations: [{ id: 'r1', changeId: 'vc1', source: 'FREE', cycleSequence: 1, status: 'RESERVED' }], ledger: [{ id: 'l1', type: 'RESERVE', source: 'FREE', cycleSequence: 1, changeId: 'vc1', recordedAt: '2026-10-09T02:00:00Z' }] });
const cases = [
  { name: 'swap-free-available', route: 'records', text: '免费可用', rawAccount: account(), forbidden: '购买换车次数' },
  { name: 'swap-reserved-not-consumed', route: 'records', text: '已预占，尚未消费', rawAccount: reserved },
  { name: 'swap-account-no-car', route: 'records', text: '当前暂无车辆，换车待交付', rawAccount: account({ currentAssignment: null, canRequest: false }) },
  { name: 'swap-formal-unchecked', text: '旧车交还前核清', raw: change({ originalAssignment: assignment() }), checked: false, confirm: false },
  { name: 'swap-formal-explicit-reading', text: '确认本版本换车方案', raw: change({ originalAssignment: assignment() }), checked: true, confirm: true },
  { name: 'swap-unapproved-document', text: '正式换车补充条款尚不可用', raw: change({ quote: { ...change().quote, document: null } }), confirm: false },
  { name: 'swap-expired-quote', text: '本版本客户确认期限已过', raw: change({ quote: { ...change().quote, expiresAt: '2020-01-01T00:00:00Z' } }), confirm: false },
  { name: 'swap-one-side-gap', text: '已还旧车，待交新车', raw: gap },
  { name: 'swap-recovery-new-version', text: '本次仅重新确认日期', raw: { ...gap, status: 'AWAITING_CONFIRMATION', deliveryHandover: null, recoveryOnly: true, canConfirm: true, canReject: true, contract: { id: 'am3', status: 'DRAFT' }, quote: { ...gap.quote, id: 'q3', revision: 3, previousQuoteId: 'q2', recoveryFromQuoteId: 'q2', financeSourceQuoteId: 'q1' } }, checked: false, confirm: false },
  { name: 'swap-recovery-restored-signed', text: '查看已完成交接及归档记录', raw: { ...gap, deliveryHandover: null, recoveryOnly: true, quote: { ...gap.quote, id: 'q2', revision: 2, recoveryFromQuoteId: 'q1', financeSourceQuoteId: 'q1' } } },
  { name: 'swap-applied-server-state', text: '换车已实际完成并生效', raw: { ...gap, status: 'APPLIED', currentAssignment: usageRaw.currentAssignment, deliveryHandover: { ...newSide, status: 'COMPLETED', signatureStatus: 'SIGNED' }, actualCompletedAt: newSide.actualAt, recordedAt: '2026-10-12T03:00:00Z' } },
  { name: 'swap-return-handover', route: 'handover', text: '本单仅确认旧车交还，不是退订', side: oldSide },
  { name: 'swap-delivery-handover', route: 'handover', text: '新车实际交付时间', side: newSide },
  { name: 'swap-mileage-missing-selection', route: 'mileage', text: '合成新车 · 待本车月界证据', segment: false },
  { name: 'swap-mileage-selected-new-car', route: 'mileage', text: '本车期初确认读数 20 km', segment: true },
  { name: 'swap-current-car-gap', route: 'use', text: '当前暂无车辆，换车待交付' },
];
const encode = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const renderer = `function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag);for(const[k,v]of Object.entries(t.attr||{})){if(/^(bind|catch)/.test(k)||['value','checked'].includes(k)||v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}if(t.tag==='wx-checkbox'||t.tag==='wx-radio'){const i=document.createElement('input');i.type=t.tag==='wx-checkbox'?'checkbox':'radio';i.checked=!!t.attr?.checked;e.append(i);}else if(['wx-input','wx-textarea'].includes(t.tag)){const i=document.createElement(t.tag==='wx-input'?'input':'textarea');i.value=t.attr?.value||'';e.append(i);}else(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
async function main() {
  for (const item of cases) {
    const api = createApi(config, v => { const route = v.url.replace(/^https:\/\/[^/]+\/api/, ''); let data;
      if (route.endsWith('/swap-account')) data = item.rawAccount || account();
      else if (route.endsWith('/usage-account')) data = usageRaw;
      else if (route.startsWith('/customer/handovers/')) data = item.side;
      else if (route === '/customer/dashboard') data = { subscription: { id: 'o1', orderId: 'o1', vehicleName: '旧车不得回退', currentAssignment: null, activeChangeId: 'vc1', monthlyFeeText: '¥5,199.00' } };
      else data = item.raw || change();
      v.success({ statusCode: 200, data });
    }, { getStorageSync: () => ({ token: 'offline-synthetic', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'c1' } }) });
    const route = item.route || 'record', data = { ...definitions[route].data, loading: false, error: '' };
    if (route === 'record') { const value = await api.getOrderChange('vc1'); Object.assign(data, { type: 'orderchanges', id: 'vc1', record: value, change: value, changeRead: item.checked === true }); }
    if (route === 'records') Object.assign(data, { type: 'entitlements', title: '权益明细', items: [], swap: await api.getSwapAccount('o1'), usage: await api.getUsageAccount('o1') });
    if (route === 'handover') { const h = await api.getHandover(item.side.id); Object.assign(data, { handover: h, subscription: { vehicleName: h.vehicleTitle }, submitted: h.customerResponse ? h : null, evidenceOpen: true }); }
    if (route === 'mileage') { const usage = await api.getUsageAccount('o1'), selectedPeriod = usage.periods[0], selectedSegment = item.segment ? selectedPeriod.segments[1] : null; Object.assign(data, { subscription: { id: 'o1' }, usage, selectedPeriod, periodId: selectedPeriod.id, selectedSegment, segmentId: selectedSegment?.id || '', boundaryDate: selectedSegment?.boundaryDate || '' }); }
    if (route === 'use') Object.assign(data, await api.getDashboard());
    const tree = generate('pages/' + route + '/index.wxml')(data);
    fs.writeFileSync(path.join(htmlDir, item.name + '.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(root, 'scripts/preview/preview.css')).href}"></head><body class="phone-body"><header id="preview-navigation">换车与逐车里程 · 离线合成排版核验</header><main id="preview-page"></main><script>${renderer};document.getElementById('preview-page').append(render(${encode(tree)}));const styles=(function(global){${compiled.wxss}})({});for(const file of ['app.wxss','pages/${route}/index.wxss'])styles(file)('',{deviceWidth:390,allowIllegalSelector:true});</script></body></html>`);
    delete item.raw; delete item.rawAccount; delete item.side;
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), scope: 'Offline actual-wcc synthetic display only. No API/DB/SDK, SMS, payment, signing, preview, QR or upload.', viewport: { width: 390, height: 844 }, cases }, null, 2) + '\n');
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
        if item.get('forbidden'): assert item['forbidden'] not in text,item['name']
        if 'confirm' in item:
            button=page.locator('wx-button').filter(has_text='确认本版本换车方案')
            enabled=button.count()>0 and button.get_attribute('disabled') is None
            assert enabled==item['confirm'],item['name']
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
