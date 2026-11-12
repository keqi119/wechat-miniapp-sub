// Layout QA of the actual WCC/WCSC output. Synthetic fixtures stay outside the app.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { compile } = require('./compile-templates.cjs');
const project = path.resolve(__dirname, '../../..');
const src = path.join(project, 'apps/miniprogram/src');
const out = path.join(project, '.runtime/ninda/bright-native-20261102/layout');
fs.mkdirSync(out, { recursive: true });
const compiled = compile();
const generate = vm.runInNewContext('(function(global){' + compiled.wxml + '})({})', { window: {}, console });
global.wx = { getStorageSync: () => null, request() { throw Error('Network is disabled for layout QA'); } };
const definitions = {};
for (const route of require(path.join(src, 'app.json')).pages) {
  global.Page = definition => { definitions[route.split('/')[1]] = definition; };
  require(path.join(src, route + '.js'));
}
delete global.Page;
const photo = 'data:image/webp;base64,' + fs.readFileSync(path.join(project, 'docs/design/miniapp-20261102/assets/et5-design-example.webp')).toString('base64');
const car = { id: 'layout-car', name: '蔚来 ET5', brand: '蔚来', city: '上海', registrationText: '2022 年 8 月', mileageText: '66,706 km', rangeText: '以车辆资料为准', bodyType: '轿车', available: true, statusText: '可申请', imageUrl: photo, minFeeText: '¥3,999.00', tagline: '纯电轿车 · 资料与实车确认后办理' };
const plan = { id: 'layout-plan', title: '轻松出行 · 12 个月', available: true, termMonths: 12, mileageText: '1,500 km / 月', monthlyFeeText: '¥3,999.00', monthlyFeeParts: [{ label: '基础使用费', amountText: '¥3,699.00' }, { label: '里程包月费', amountText: '¥300.00' }], excessMileagePriceText: '¥1.50', swapIncludedText: '合同期内赠送 1 次', swapExtraFeeText: '¥800.00 / 次', energyText: '充换电费用自付', depositText: '以审核方案为准', conditions: ['具体押金以信用核验后的确认方案为准'], benefits: [] };
const subscription = { id: 'layout-order', vehicleName: car.name, planTitle: plan.title, statusText: '用车中', monthlyFeeText: plan.monthlyFeeText, mileageText: plan.mileageText, vehicleStageText: '当前车辆已交付' };
const bill = { id: 'layout-bill', title: '第 2 期订阅月费', reasonText: '第 2 期订阅月费', amountText: '¥3,999.00', statusText: '待支付', periodText: '2026-12-01 至 2026-12-31', dueDateText: '2026-12-01', subtitle: '蔚来 ET5 · 2026 年 12 月订阅月费', description: '基础使用费与里程包月费', canPay: true };
const order = { id: 'layout-order', title: car.name + ' · 12 个月订阅', statusText: '待交付', nextLabel: '押金与首期款已到账，等待车辆交付。', parties: [{ role: 'customer', label: '承租人', name: '示例客户' }], archives: [{ id: 'layout-archive', title: '车辆订阅主合同', statusText: '已归档', canRead: true }], bills: [{ ...bill, id: 'deposit', reasonText: '履约押金', amountText: '¥5,000.00', periodText: '', statusText: '已支付', canPay: false }, { ...bill, reasonText: '首期订阅月费', statusText: '已支付', canPay: false }], canPay: false, hasPendingBills: false, handovers: [] };
const insurance = { coverage: { statusText: '保险资料已核对', blockers: [] }, policies: [] };
const record = { ...bill, details: [{ label: '订阅车辆', value: car.name }, { label: '付款日', value: bill.dueDateText }], billDetails: { reasonText: bill.reasonText, periodText: bill.periodText, description: bill.description }, timeline: [], documents: [], actions: [{ id: 'pay', label: '支付账单' }] };
const cases = [];
function add(name, route, patch = {}, expected = [], absent = []) { cases.push({ name, route, data: { ...definitions[route].data, loading: false, error: '', ...patch }, expected, absent }); }
add('home', 'home', { vehicles: [car], context: {} }, ['选一台，刚刚好。']);
add('catalog', 'catalog', { items: [{ ...car, tagline: '车辆登记资料、配置和实际车况请查看详情。'.repeat(18) }, { ...car, id: 'layout-car-2', name: '蔚来 ET5T', minFeeText: '¥4,299.00' }], brands: ['蔚来', '特斯拉', '理想'] });
add('vehicle', 'vehicle', { vehicle: car, plans: [plan, { ...plan, id: 'layout-plan-2', title: '安心出行 · 24 个月', termMonths: 24 }], selectedPlan: plan }, ['基础使用费', '里程包月费', '超里程单价', '合同期内赠送 1 次']);
add('vehicle-long', 'vehicle', { vehicle: { ...car, name: '蔚来 ET5T 二〇二四款旅行版长车型名称布局核验' }, plans: [{ ...plan, title: '企业与家庭长期出行特别方案 · 月度全程用车', monthlyFeeText: '¥123,456.78' }], selectedPlan: { ...plan, monthlyFeeText: '¥123,456.78' } });
add('vehicle-unavailable', 'vehicle', { vehicle: { ...car, available: false, statusText: '已预订' }, plans: [{ ...plan, available: false }], selectedPlan: { ...plan, available: false } }, ['当前不能提交新申请']);
add('vehicle-empty', 'vehicle', { vehicle: car, plans: [], selectedPlan: null }, ['暂时没有可用产品']);
add('use', 'use', { subscription, showDrivingServices: true, bill, todos: [] });
add('use-before-delivery', 'use', { subscription: { ...subscription, statusText: '待交付', vehicleStageText: '等待实际交付' }, nextStep: '款项已到账，等待车辆交付', showDrivingServices: false, bill: { ...bill, statusText: '已支付' }, todos: [] }, ['款项已到账'], ['道路救援']);
add('mine', 'mine', { profile: { name: '示例客户', mobile: '13800000000' }, links: [{ type: 'orders', title: '我的订单' }, { type: 'contracts', title: '合同记录' }, { type: 'bills', title: '账单与支付' }], application: null });
add('records-bills', 'records', { type: 'bills', title: '我的账单', items: [bill, { ...bill, id: 'paid', title: '首期订阅月费', statusText: '已支付' }] });
add('bill-pending', 'record', { type: 'bills', title: '账单详情', record }, ['第 2 期订阅月费', '支付账单']);
add('bill-paid', 'record', { type: 'bills', title: '账单详情', record: { ...record, statusText: '已支付', actions: [] } }, ['已支付'], ['支付账单']);
add('order-paid', 'order-detail', { order, insurance, entitlements: [], summaryRows: [{ label: '订阅月费', value: plan.monthlyFeeText }, { label: '订阅期限', value: '12 个月' }] }, ['押金与首期款已到账，等待车辆交付。']);
add('order-pending-bills', 'order-detail', { order: { ...order, statusText: '待付款', nextLabel: '请按账单支付押金与首期款。', canPay: true, hasPendingBills: true, bills: [{ ...bill, amountText: '¥123,456.78' }] }, insurance, entitlements: [], summaryRows: [] });
add('order-archive-long-name', 'order-detail', { order, insurance, entitlements: [], summaryRows: [], archiveOpen: true, archive: { title: '车辆订阅主合同', selectedVersion: { version: 1, status: 'ARCHIVED', signedOnText: '2026-11-02', contractNumber: 'ND-LAYOUT-ONLY', files: [{ id: 'file', position: 1, name: '车辆订阅主合同_双方签署完整版本_含全部附件及签章页_二〇二六年十一月二日.pdf' }] } }, versionLabels: ['第 1 版 · 已归档'], versionIndex: 0 });
for (const status of ['PUBLISHED', 'CUSTOMER_CONFIRMED', 'COMPLETED', 'SUPERSEDED', 'OBJECTION_SUBMITTED']) {
  const submitted = status !== 'PUBLISHED';
  const handover = { id: 'LAYOUT-ONLY-HANDOVER-20261102', status, revision: 1, actualAtLabel: '实际交车时间', actualAtDisplay: '2026-11-02 10:30', actualAtValid: true, fileIds: ['file'], evidence: [{ id: 'file', name: '车辆外观与里程照片' }], checklist: [{ label: '交接里程', value: '66,706 公里' }, { label: '随车物品', value: '车辆钥匙、随车工具及证件已核对' }], onlineRecord: { termsTitle: '车辆线上交接约定', termsVersion: '1', termsContent: '排版核验合成文本：双方按本版本现场照片与查验资料核对交接事实。实际交付由后台另行确认。', confirmedAt: submitted ? '2026-11-02' : '', completedAt: status === 'COMPLETED' ? '2026-11-02' : '' } };
  add('handover-' + status.toLowerCase(), 'handover', { handover, subscription, canRespond: !submitted, submitted: submitted ? handover : null, decision: status === 'OBJECTION_SUBMITTED' ? 'dispute' : 'confirm', signing: { onlineRecord: true, title: status === 'COMPLETED' ? '已留存' : '办理记录', message: status === 'COMPLETED' ? '平台已核对实际完成并留存。' : '以当前交接版本为准', canSign: false }, evidenceOpen: true, readFileIds: [], name: '示例客户' }, status === 'COMPLETED' ? ['交接已完成'] : [], submitted ? ['我已阅读全部交接证据', '确认交接事实'] : []);
}
add('profile-login', 'profile');
add('profile-manual-review', 'profile', { authenticated: true, identityPolicy: 'MANUAL_REVIEW', identityStatusText: '未进行线上实名认证', name: '示例客户', profileMobile: '13800000000', consentCurrent: true, profile: { name: '示例客户' }, identityEnabled: false });
add('application', 'application', { vehicle: car, plan, context: { authenticated: true }, name: '示例客户', mobile: '13800000000', legal: { id: 'layout', title: '申请须知', content: '合成排版文字，正式内容由平台已发布协议提供。', version: 1 } });
for (const route of ['application-detail', 'service', 'mileage', 'settings', 'legal', 'sign']) add(route + '-default', route);
add('catalog-loading', 'catalog', { loading: true }, ['正在']);
add('catalog-error', 'catalog', { error: '网络连接暂时不可用，请稍后重新加载。' }, ['重新加载']);
add('catalog-empty', 'catalog', { items: [] });
const encode = value => JSON.stringify(value).replaceAll('<', '\\u003c');
fs.writeFileSync(path.join(out, 'compiled-wxss.js'), 'window.qaStyles=(function(global){' + compiled.wxss + '})({});');
const renderer = `function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag);for(const[k,v]of Object.entries(t.attr||{})){if(/^(bind|catch)/.test(k)||['value','checked','src'].includes(k)||v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}if(t.tag==='wx-checkbox'||t.tag==='wx-radio'){const i=document.createElement('input');i.type=t.tag==='wx-checkbox'?'checkbox':'radio';i.checked=!!t.attr?.checked;e.append(i);}else if(['wx-input','wx-textarea'].includes(t.tag)){const i=document.createElement(t.tag==='wx-input'?'input':'textarea');i.value=t.attr?.value||'';i.placeholder=t.attr?.placeholder||'';e.append(i);}else if(t.tag==='wx-image'){const i=document.createElement('img');i.src=t.attr?.src||'';i.style.objectFit=t.attr?.mode==='aspectFill'?'cover':'contain';e.append(i);}else(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
const tabs = ['home', 'catalog', 'use', 'mine'];
for (const item of cases) {
  const tree = generate('pages/' + item.route + '/index.wxml')(item.data);
  // Resolve local packaged image paths without a network server.
  const fixImages = node => { if (!node || typeof node !== 'object') return; if (node.attr?.src?.startsWith('/assets/')) node.attr.src = pathToFileURL(path.join(src, node.attr.src.slice(1))).href; for (const child of node.children || []) fixImages(child); };
  fixImages(tree);
  const tabbar = tabs.includes(item.route) ? '<nav class="qa-tabs">' + ['首页','选车','用车','我的'].map((label, i) => '<span class="' + (tabs[i] === item.route ? 'active' : '') + '"><img src="' + pathToFileURL(path.join(src, require(path.join(src, 'app.json')).tabBar.list[i][tabs[i] === item.route ? 'selectedIconPath' : 'iconPath'])).href + '">' + label + '</span>').join('') + '</nav>' : '';
  const navigationTitle = require(path.join(src, 'pages', item.route, 'index.json')).navigationBarTitleText || '宁达订阅';
  fs.writeFileSync(path.join(out, item.name + '.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${pathToFileURL(path.join(project, 'apps/miniprogram/scripts/preview/preview.css')).href}"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Microsoft YaHei',sans-serif;background:#f5f6f7;color:#231815;font-size:15px;line-height:1.6}.qa-navigation{height:48px;background:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 16px;font-size:15px;font-weight:600;border-bottom:1px solid #eee}.qa-navigation i{font-style:normal;font-size:12px;letter-spacing:2px;border:1px solid #ddd;border-radius:20px;padding:2px 9px}.qa-tabs{height:66px;position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #eee;display:flex;justify-content:space-around;align-items:center;z-index:80;font-size:11px;color:#65615c}.qa-tabs span{display:flex;align-items:center;flex-direction:column;gap:2px}.qa-tabs img{width:24px;height:24px}.qa-tabs .active{color:#231815}wx-scroll-view[scroll-y]{overflow-y:auto}wx-scroll-view[scroll-x]{overflow-x:auto}</style><body><header class="qa-navigation"><span>${tabs.includes(item.route) ? '' : '‹'}</span><span>${navigationTitle}</span><i>••• │ ○</i></header><main id="content"></main>${tabbar}<script src="compiled-wxss.js"></script><script>${renderer};document.getElementById('content').append(render(${encode(tree)}));for(const file of ['app.wxss','pages/${item.route}/index.wxss'])qaStyles(file)('',{deviceWidth:innerWidth,allowIllegalSelector:true});</script></body></html>`);
}
async function main() {
  const { chromium } = createRequire(path.join(project, 'apps/signing-h5/package.json'))('@playwright/test');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errors = [], external = [], results = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const item of cases) {
      await page.goto(pathToFileURL(path.join(out, item.name + '.html')).href);
      await page.evaluate(() => Promise.all([...document.images].map(i => i.complete ? undefined : new Promise(r => { i.onload = i.onerror = r; }))));
      const text = await page.locator('#content').innerText();
      const missing = item.expected.filter(s => !text.includes(s));
      const forbidden = item.absent.filter(s => text.includes(s));
      const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, overflowing: [...document.querySelectorAll('#content *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('[scroll-x]'); }).slice(0, 8).map(e => ({ tag: e.tagName, class: e.className, text: e.textContent.slice(0, 70) })) }));
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      const footer = await page.evaluate(() => {
        const action = document.querySelector('.sticky-actions');
        if (!action) return null;
        const flow = [...document.querySelector('.page').children].filter(e => { const style = getComputedStyle(e); return style.position !== 'fixed' && style.display !== 'none' && e.getBoundingClientRect().height > 0; });
        const last = flow.at(-1)?.getBoundingClientRect(), bar = action.getBoundingClientRect();
        return { height: bar.height, lastContentBottom: last?.bottom, top: bar.top, covered: !!last && last.bottom > bar.top + 1 };
      });
      const passed = !missing.length && !forbidden.length && geometry.scroll <= width + 1 && !footer?.covered;
      results.push({ case: item.name, width, passed, missing, forbidden, geometry, footer });
      if (width === 320 && ['vehicle-long', 'application'].includes(item.name)) await page.screenshot({ path: path.join(out, item.name + '-320-bottom.png') });
      await page.evaluate(() => scrollTo(0, 0));
      if (width === 390 || !passed) await page.screenshot({ path: path.join(out, item.name + '-' + width + '.png'), fullPage: true });
    }
  }
  await browser.close();
  const report = { generatedAt: new Date().toISOString(), scope: 'Actual WCC/WCSC output in desktop Chrome with synthetic display data; not WeChat device validation; no business API requests.', compiler: compiled.counts, cases: cases.length, checks: results.length, errors, external, failures: results.filter(r => !r.passed), results };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ cases: report.cases, checks: report.checks, failures: report.failures, runtimeErrors: errors, externalRequests: external }));
  assert.equal(report.failures.length, 0, 'Layout/state failures');
  assert.equal(errors.length, 0, 'Browser runtime errors');
  assert.equal(external.length, 0, 'Unexpected external request');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
