// Actual-wcc offline layout fixtures. Never contacts a business API or native payment.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { compile } = require('./compile-templates.cjs');
const { createApi } = require('../src/services/api');
const config = require('../src/config');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'evidence/usage-layout'), htmlDir = path.join(root, '.artifacts/usage-layout');
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(htmlDir, { recursive: true });
const compiled = compile(), generate = vm.runInNewContext('(function(global){' + compiled.wxml + '})({})', { window: {}, console });
const definitions = {};
for (const name of ['records', 'mileage', 'application-detail', 'handover']) vm.runInNewContext(fs.readFileSync(path.join(root, 'src/pages', name, 'index.js'), 'utf8'), { require: () => ({}), Page: value => { definitions[name] = value; } });
const terms = { version: 'MILEAGE_PACK_V1', documentId: 'qa-mileage-terms', documentVersion: 1, hash: 'a'.repeat(64), content: '离线合成排版资料，不作为生产协议。仅本订阅期有效，基础优先；包余额逐月结转，可抵当月未结算超里程，已结算月份不追溯。退订剩余额度失效，不退未使用费用；异常履约或争议转人工处理。' };
const period = { id: 'qa-period', sequence: 1, startDate: '2026-09-16', endDate: '2026-10-16', effectiveEndDate: '2026-10-16', status: 'AWAITING_READING', revision: 1, startReadingKm: 1000, endReadingKm: null, usedKm: null, baseUsedKm: null, packUsedKm: null, excessKm: null, excessAmount: null, billId: null, canSubmit: true, reviewNote: '待补月界仪表照片，尚不具备结算依据。' };
const base = { orderId: 'qa-order', orderStatus: 'ACTIVE', policyVersion: 'USAGE_V1', startedOn: '2026-09-16', returnedOn: null, baseAllowanceKm: 1500, excessPriceAmount: 150, packBalanceKm: 0, packStatus: 'ACTIVE', periods: [period], packs: [], ledger: [], products: [{ id: 'qa-pack', version: 1, km: 1000, amount: 80000 }, { id: 'qa-pack-2', version: 1, km: 2000, amount: 150000 }, { id: 'qa-pack-3', version: 1, km: 3000, amount: 200000 }], purchaseTerms: terms, canPurchase: true, returnSettlement: null };
const settlement = { id: 'qa-settlement', orderId: 'qa-order', status: 'READINGS_REQUIRED', revision: 1, returnedOn: '2026-10-16', unsettledPeriodIds: ['qa-period'], bills: [{ id: 'qa-deposit', type: 'DEPOSIT', amount: 519900, paidAmount: 519900, status: 'PAID', dueDate: '2026-09-16', description: '离线合成押金账单' }], depositRefundRequiredAmount: 519900, disputeReason: '', resolutionNote: '', canDispute: true };
const cases = [
  { name: 'pack-policy-unpublished', route: 'records', raw: { ...base, purchaseTerms: null, canPurchase: false }, text: '正式里程包购买协议尚未发布', checkboxes: 0 },
  { name: 'pack-unchecked', route: 'records', raw: base, select: true, text: '退订时剩余额度失效', checkboxes: 1, buyEnabled: false },
  { name: 'pack-explicit-consent', route: 'records', raw: base, select: true, accepted: true, text: '1000 km · ¥800.00', checkboxes: 1, buyEnabled: true },
  { name: 'pack-bill-not-credited', route: 'records', raw: { ...base, packs: [{ id: 'qa-purchase', km: 1000, amount: 80000, status: 'PENDING_PAYMENT', billId: 'qa-bill', remainingKm: 0 }] }, purchase: { purchase: { km: 1000, statusText: '待支付，尚未发放' }, bill: { id: 'qa-bill', amountText: '¥800.00' } }, text: '创建账单不会发放额度', checkboxes: 1 },
  { name: 'pack-server-credited', route: 'records', raw: { ...base, packBalanceKm: 1000, packs: [{ id: 'qa-purchase', km: 1000, amount: 80000, status: 'ACTIVE', billId: 'qa-bill', remainingKm: 1000 }], ledger: [{ id: 'qa-ledger', type: 'GRANT', deltaKm: 1000, createdAt: '2026-10-16T08:00:00Z' }] }, text: '支付到账发放', checkboxes: 1 },
  { name: 'pack-refund-pending',route:'records',raw:{...base,packBalanceKm:0,packs:[{id:'qa-purchase',km:1000,amount:80000,status:'REFUND_PENDING',billId:'qa-bill',remainingKm:1000}]},text:'退款核对中（已冻结，不可消费）',checkboxes:1 },
  { name: 'pack-refunded',route:'records',raw:{...base,packBalanceKm:0,packs:[{id:'qa-purchase',km:1000,amount:80000,status:'REFUNDED',billId:'qa-bill',remainingKm:0}],ledger:[{id:'qa-refund',type:'REFUND',deltaKm:-1000,createdAt:'2026-10-16T08:00:00Z'}]},text:'退款收回',checkboxes:1 },
  { name: 'return-evidence-and-refund-pending', route: 'records', raw: { ...base, orderStatus: 'SETTLING', returnedOn: '2026-10-16', packStatus: 'FROZEN', canPurchase: false, returnSettlement: { id: settlement.id, status: settlement.status, revision: 1 } }, settlement, text: '押金仍待退还 ¥5,199.00', checkboxes: 0 },
  { name: 'month-selection-required', route: 'mileage', raw: base, text: '选择需要申报或补证的订阅月', checkboxes: 0, submit: false },
  { name: 'month-boundary-photo-form', route: 'mileage', raw: base, periodSelected: true, text: '照片实际拍摄时间（北京时间）', checkboxes: 0, submit: true },
  { name: 'month-start-awaiting-prior', route: 'mileage', raw: { ...base, periods: [{ ...period, startReadingKm: null }] }, periodSelected: true, text: '待前月结算核对', checkboxes: 0, submit: true },
  { name: 'month-review-pending', route: 'mileage', raw: { ...base, periods: [{ ...period, status: 'REVIEW_PENDING', canSubmit: false, reviewNote: '证据待人工核验，尚未结算。' }] }, text: '仪表证据待人工审核', checkboxes: 0, submit: false },
  { name: 'final-plan-frozen-usage-policy', route: 'application-detail', raw: base, text: '本方案固定的月里程与加购、退订规则', checkboxes: 1 },
  { name:'handover-server-actual-time',route:'handover',raw:base,handover:{id:'qa-handover',type:'DELIVERY',actualAt:'2026-10-16T00:30:00Z',manifestHash:'qa-immutable-manifest',fileIds:[],checklist:[],evidence:[],status:'PUBLISHED',signatureStatus:'PENDING'},text:'实际交车时间（北京时间）',checkboxes:1 },
];
const encode = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const renderer = `function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag);for(const[k,v]of Object.entries(t.attr||{})){if(/^(bind|catch)/.test(k)||['value','checked'].includes(k)||v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}if(['wx-checkbox','wx-radio'].includes(t.tag)){const i=document.createElement('input');i.type=t.tag==='wx-radio'?'radio':'checkbox';i.checked=!!t.attr?.checked;if(t.attr?.disabled)i.disabled=true;e.append(i);}else if(['wx-input','wx-textarea'].includes(t.tag)){const i=document.createElement(t.tag==='wx-input'?'input':'textarea');i.value=t.attr?.value||'';e.append(i);}else(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
async function main() {
  for (const item of cases) {
    const api = createApi(config, value => value.success({ statusCode: 200, data: value.url.includes('/handovers/')?item.handover:value.url.includes('return-settlements') ? item.settlement : item.raw }), { getStorageSync: () => ({ token: 'offline-synthetic', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'qa-customer' } }) });
    const usage = await api.getUsageAccount('qa-order');
    const data = { ...definitions[item.route].data, loading: false, error: '', type: 'entitlements', title: '权益明细', items: [], usage, subscription: { id: usage.orderId, vehicleName: '离线合成订阅' }, selectedProduct: item.select ? usage.products[0] : null, selectedProductId: item.select ? usage.products[0].id : '', purchaseAccepted: item.accepted === true, purchase: item.purchase || null, settlement: item.settlement ? await api.getReturnSettlement(item.settlement.id, usage.orderId) : null };
    if (item.periodSelected) Object.assign(data, { selectedPeriod: usage.periods[0], periodId: usage.periods[0].id });
    if(item.handover)data.handover=await api.getHandover(item.handover.id);
    if (item.route === 'application-detail') data.application = { id: 'qa-application', status: 'AWAITING_CONFIRMATION', statusText: '待确认最终方案', vehicleName: '离线合成车型', monthlyFeeText: '¥5,199.00', timeline: [], finalPlan: { revision: 1, vehicleName: '离线合成车型', planTitle: '离线合成完整方案', termMonths: 12, mileageText: '每订阅月1500公里', energyText: '充电自付', benefits: [], monthlyFeeText: '¥5,199.00', depositText: '¥0.00', excessMileagePriceText: '¥1.50', startDateText: '2026.09.16', endDateText: '2027.09.15', firstDueDateText: '2026.09.16', billingRows: [], commercialRows: [], complete: true, usagePolicyComplete: true, usagePolicy: { version: 'USAGE_V1', documentVersion: 1, content: '离线合成的固定全文，不作为生产法律文本。每订阅月1500公里从实际交车日起算，优先基础且期末清零；包余额本订阅期结转，未结算当月超里程可抵，已结算月份不追溯；退订加购余额失效且不退未使用费用。月界证据人工核验，争议人工处理。' } } };
    const tree = generate('pages/' + item.route + '/index.wxml')(data);
    fs.writeFileSync(path.join(htmlDir, item.name + '.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(root, 'scripts/preview/preview.css')).href}"></head><body class="phone-body"><header id="preview-navigation">用量规则 · 离线合成排版核验</header><main id="preview-page"></main><script>${renderer};document.getElementById('preview-page').append(render(${encode(tree)}));const styles=(function(global){${compiled.wxss}})({});for(const file of ['app.wxss','pages/${item.route}/index.wxss'])styles(file)('',{deviceWidth:390,allowIllegalSelector:true});</script></body></html>`);
    delete item.raw; delete item.purchase; delete item.settlement;delete item.handover;
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), scope: 'Offline actual-wcc templates using synthetic display data. Browser layout only; no API, SDK, real upload/purchase/payment, preview or publishing.', viewport: { width: 390, height: 844 }, cases }, null, 2) + '\n');
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
        assert boxes.count()==item['checkboxes'],item['name']
        if boxes.count(): assert boxes.is_checked()==item.get('accepted',False),item['name']
        if 'buyEnabled' in item:
            buy=page.locator('wx-button').filter(has_text='创建所选里程包账单')
            assert buy.count()==1
            assert (buy.get_attribute('disabled') is None)==item['buyEnabled']
        if 'submit' in item: assert page.locator('wx-button').filter(has_text='提交本订阅月仪表证据').count()==(1 if item['submit'] else 0)
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
