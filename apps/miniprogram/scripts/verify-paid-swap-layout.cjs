// Actual-wcc offline synthetic display only. No API/DB/SDK/real payment.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { pathToFileURL } = require('node:url'), { spawnSync } = require('node:child_process');
const { compile } = require('./compile-templates.cjs'), { createApi } = require('../src/services/api'), config = require('../src/config');
const { product, terms, purchase, paidAccount } = require('../tests/fixtures/paid-swap.cjs');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'evidence/paid-swap-layout'), htmlDir = path.join(root, '.artifacts/paid-swap-layout');
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(htmlDir, { recursive: true });
const compiled = compile(), generate = vm.runInNewContext('(function(global){' + compiled.wxml + '})({})', { window: {}, console });
let definition; vm.runInNewContext(fs.readFileSync(path.join(root, 'src/pages/records/index.js'), 'utf8'), { require: () => ({}), Page: value => { definition = value; } });
const paid = { ...purchase().bill, status: 'PAID', paidAmount: 80000 };
const cases = [
  { name: 'paid-swap-unchecked', account: paidAccount(), text: '创建800元一次普通账单', create: false },
  { name: 'paid-swap-explicit-choice', account: paidAccount(), checked: true, text: '固定800元', create: true },
  { name: 'paid-swap-disabled', account: paidAccount({ canPurchase: false, purchaseBlockers: ['购买开关尚未启用，已有记录可继续核对'] }), text: '购买开关尚未启用', create: false },
  { name: 'paid-swap-unpublished', account: paidAccount({ purchaseTerms: null, canPurchase: false }), text: '正式换车购买说明尚未发布', create: false },
  { name: 'paid-swap-no-car-gap', account: paidAccount({ currentAssignment: null, canRequest: false }), text: '当前暂无车辆，换车待交付', create: false },
  ...['PENDING_PAYMENT','ACTIVE','CONSUMED','EXPIRED','PAYMENT_REVIEW','REFUND_PENDING','REFUNDED','VOID'].map(status => {
    const row = purchase({ status, bill: status === 'PENDING_PAYMENT' ? purchase().bill : status === 'VOID' ? { ...purchase().bill, status: 'VOID' } : paid, creditId: status === 'PENDING_PAYMENT' || status === 'VOID' ? null : 'cr1', paymentId: status === 'VOID' ? null : 'pay1', canPay: status === 'PENDING_PAYMENT', canClose: status === 'PENDING_PAYMENT', manualReviewRequired: ['PAYMENT_REVIEW','REFUND_PENDING'].includes(status), statusMessage: ['PAYMENT_REVIEW','REFUND_PENDING'].includes(status) ? '真实到账或渠道退款尚待人工核账，不可认定未扣款。' : '', refunds: status === 'REFUND_PENDING' ? [{ id: 'rf1', amount: 80000, status: 'PROCESSING' }] : status === 'REFUNDED' ? [{ id: 'rf1', amount: 80000, status: 'SUCCEEDED' }] : [] });
    return { name: 'paid-swap-state-' + status.toLowerCase(), account: paidAccount({ purchases: [row], paidAvailable: status === 'ACTIVE' ? 1 : 0, paidConsumed: status === 'CONSUMED' ? 1 : 0, paidFrozen: ['PAYMENT_REVIEW','REFUND_PENDING'].includes(status) ? 1 : 0, paidExpired: status === 'EXPIRED' ? 1 : 0 }), text: { PENDING_PAYMENT: '待支付，尚未发放', ACTIVE: '已到账，可按服务端余额使用', CONSUMED: '已实际消费', EXPIRED: '已失效，不可使用', PAYMENT_REVIEW: '到账待人工核账，不可使用', REFUND_PENDING: '退款待核实，次数冻结', REFUNDED: '已退款，不可使用', VOID: '已撤销' }[status], create: false };
  }),
  { name: 'paid-swap-refund-failed-frozen', account: paidAccount({ paidFrozen: 1, purchases: [purchase({ status: 'REFUND_PENDING', canPay: false, canClose: false, bill: paid, creditId: 'cr1', manualReviewRequired: true, statusMessage: '本次退款失败，原次数仍冻结，须人工核账。', refunds: [{ id: 'rf1', amount: 80000, status: 'FAILED' }] })] }), text: '该次退款失败', create: false },
  { name: 'paid-swap-restored-original', account: paidAccount({ paidAvailable: 1, purchases: [purchase({ status: 'ACTIVE', bill: paid, creditId: 'cr1', canPay: false, canClose: false, refunds: [{ id: 'rf1', amount: 80000, status: 'REJECTED' }], statusMessage: '原权益经财务独立核查恢复；未另行购买或发放。' })], ledger: [{ id: 'l1', type: 'RESTORE', source: 'PAID', cycleSequence: null, changeId: null, purchaseId: 'sp1', recordedAt: '2026-10-16T03:00:00Z' }] }), text: '已核查恢复原次数', create: false },
  { name: 'paid-swap-multiple-sources', account: paidAccount({ paidAvailable: 2, purchases: [purchase({ status: 'ACTIVE', bill: paid, creditId: 'cr1', canPay: false, canClose: false, statusMessage: '已可信到账，本订阅一次。' }), purchase({ id: 'sp2', billId: 'bill2', status: 'ACTIVE', bill: { ...paid, id: 'bill2' }, creditId: 'cr2', canPay: false, canClose: false, statusMessage: '已可信到账，本订阅一次。' })] }), text: '购买 sp2', create: false },
  { name: 'paid-swap-reserved-source', account: paidAccount({ freeAvailable: 0, paidAvailable: 0, paidReserved: 1, purchases: [purchase({ status: 'ACTIVE', bill: paid, creditId: 'cr1', canPay: false, canClose: false, reservedChangeId: 'vc1', statusMessage: '已可信到账，当前预占在原换车流程，不可另用。' })], reservations: [{ id: 'r1', changeId: 'vc1', source: 'PAID', cycleSequence: null, status: 'RESERVED' }] }), text: '已到账并预占，不可另用', create: false },
  { name: 'paid-swap-close-unknown', account: paidAccount({ purchases: [purchase({ canPay: false, canClose: false, paymentId: 'pay1', manualReviewRequired: true, statusMessage: '原渠道关单结果尚未核实，不可认定未扣款。' })] }), text: '原渠道关单结果尚未核实', create: false },
];
const renderer = `function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag);for(const[k,v]of Object.entries(t.attr||{})){if(/^(bind|catch)/.test(k)||['value','checked'].includes(k)||v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}if(t.tag==='wx-checkbox'){const i=document.createElement('input');i.type='checkbox';i.checked=!!t.attr?.checked;e.append(i);}else if(t.tag==='wx-textarea'){const i=document.createElement('textarea');i.value=t.attr?.value||'';e.append(i);}else(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
async function main() {
  for (const item of cases) {
    const api = createApi(config, v => v.success({ statusCode: 200, data: item.account }), { getStorageSync: () => ({ token: 'offline-synthetic', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'c1' } }) });
    const swap = await api.getSwapAccount('o1'), data = { ...definition.data, type: 'entitlements', title: '权益明细', loading: false, error: '', items: [], usage: null, swap, swapPurchaseAccepted: item.checked === true };
    const tree = generate('pages/records/index.wxml')(data), json = JSON.stringify(tree).replaceAll('<', '\\u003c');
    fs.writeFileSync(path.join(htmlDir, item.name + '.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(root, 'scripts/preview/preview.css')).href}"></head><body class="phone-body"><header id="preview-navigation">付费换车次数 · 离线合成版面</header><main id="preview-page"></main><script>${renderer};document.getElementById('preview-page').append(render(${json}));const styles=(function(global){${compiled.wxss}})({});for(const file of ['app.wxss','pages/records/index.wxss'])styles(file)('',{deviceWidth:390,allowIllegalSelector:true});</script></body></html>`);
    delete item.account;
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), scope: 'Offline actual-wcc synthetic display only. No API/DB/SDK, SMS, clipboard, payment, refund, signing, QR, preview or upload.', viewport: { width: 390, height: 844 }, cases }, null, 2) + '\n');
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
        assert '0.01' not in text,item['name']
        assert page.locator('wx-web-view').count()==0
        button=page.locator('wx-button').filter(has_text='创建800元一次普通账单')
        enabled=button.count()==1 and button.get_attribute('disabled') is None
        assert enabled==item['create'],item['name']
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
  if (result.stdout) process.stdout.write(result.stdout); if (result.stderr) process.stderr.write(result.stderr); if (result.error) throw result.error; process.exitCode = result.status || 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
