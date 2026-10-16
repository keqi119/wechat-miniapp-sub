// Offline visual QA only: synthetic source fixtures never enter the native release package.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { compile } = require('./compile-templates.cjs');
const ROOT = path.resolve(__dirname, '..');
const REFERENCE = path.resolve(ROOT, '../../reference/miniprogram-mock');
const OUT = path.join(ROOT, 'evidence/page-comparison');
const HTML = path.join(ROOT, '.artifacts/page-comparison-html');
const fixture = require(path.join(REFERENCE, 'src/services/fixtures'));
const original = require(path.join(REFERENCE, 'src/services/mock'));
const memory = new Map();
global.wx = { getStorageSync: key => memory.get(key), setStorageSync: (key, value) => memory.set(key, value) };
const escape = value => JSON.stringify(value).replaceAll('<', '\\u003c');
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(HTML, { recursive: true });
  original.setScenario('active');
  const key = require(path.join(REFERENCE, 'src/config')).storageKey;
  memory.get(key).application = fixture.initialState('confirm').application;
  const dashboard = await original.getDashboard();
  const application = await original.getApplication();
  const home = await original.getHome();
  const catalog = await original.getVehicles();
  const detail = await original.getVehicle(fixture.vehicles[0].id);
  const applicationConfig = require(path.join(REFERENCE, 'src/app.json'));
  const renderCode = `function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}if(t.tag==='wx-demo-banner'){return render(banner);}const e=document.createElement(t.tag),a=t.attr||{};for(const[k,v]of Object.entries(a)){if(/^(bind|catch)/.test(k)||['value','checked'].includes(k)||v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}if(t.tag==='wx-image'){const i=document.createElement('img');i.src=a.src||'';e.append(i);}else if(['wx-input','wx-textarea'].includes(t.tag)){const i=document.createElement(t.tag==='wx-input'?'input':'textarea');i.value=a.value||'';i.placeholder=a.placeholder||'';e.append(i);}else if(t.tag==='wx-checkbox'){const i=document.createElement('input');i.type='checkbox';i.checked=!!a.checked;e.append(i);}else(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
  const report = { scope: 'Offline browser layout comparison of actual wcc templates using explicitly synthetic QA display models; no API/device/payment/signing claims.', viewport: { width: 390, height: 844 }, pages: [] };
  for (const [mode, root] of [['reference', REFERENCE], ['real', ROOT]]) {
    const compiled = compile(path.join(root, 'src'));
    const generate = vm.runInNewContext('(function(global){' + compiled.wxml + '})({})', { window: {}, console });
    for (const route of applicationConfig.pages) {
      const page = route.split('/')[1]; let def;
      vm.runInNewContext(fs.readFileSync(path.join(root, 'src', route+'.js'),'utf8'), { require: () => ({}), Page: value => { def=value; } });
      const data = { ...def.data, ...dashboard, ...detail, ...home, ...catalog, loading: false, error: '', profile: fixture.initialState('active').profile, context: { mode: mode==='real'?'api':'mock', authenticated: true, profile: fixture.initialState('active').profile }, application, selectedPlan: detail.plans[0], plan: detail.plans[0], items: dashboard.services, type: 'bills', record: (await original.getRecords('bills'))[0], name: '体验客户', mobile: '13800000000', drivingYears: '5', legal: { id: 'qa-legal', title: 'QA 申请文案', version: 1, content: '此处仅用于离线排版核验，不作为生产协议。' }, handover: { id: 'qa-handover', manifestHash: 'qa-hash', fileIds: [], checklist: [{ label: '随车物品', value: '2 把钥匙' }], evidence: [] }, authenticated: true };
      if(mode==='real'&&page==='application-detail')data.application={...application,finalPlan:{...application.finalPlan,complete:true,startDateText:'2026.11.01',endDateText:'2026.11.30',firstDueDateText:'2026.10.25',excessMileagePriceText:'¥0.80',billingRows:[{sequence:1,amountText:'¥2,999.00',dueDateText:'2026.10.25',periodText:'2026.11.01—2026.11.30'}],commercialRows:['车辆及 VIN/车牌','使用限制','车辆状况披露','合同联系地址','里程累计与结转','超里程计算及上限','使用费用承担','保险与免责','保养维修责任','服务覆盖','交还车安排','提前解约规则','押金退款规则','其他费用'].map((label,index)=>({key:'qa-'+index,label,value:'离线合成排版资料；此处展示逐单已确认的完整约定，不用于生产签署。'}))}};
      if(page==='catalog')data.items=catalog.items;
      if(page==='records'){data.items=await original.getRecords('bills');data.title='账单';}
      if(page==='legal'&&mode==='real'){data.title='QA 协议排版';data.intro='仅离线排版核验';data.sections=[{title:'费用与流程',text:'月度费用与押金以正式方案为准。'}];}
      const tree = generate(route+'.wxml')(data);
      const banner = mode==='reference' ? generate('components/demo-banner/index.wxml')({ demo: true }) : null;
      const tabs = applicationConfig.tabBar.list.some(t=>t.pagePath===route) ? applicationConfig.tabBar.list.map(t=>`<button><img src="/${t.pagePath===route?t.selectedIconPath:t.iconPath}"><span>${t.text}</span></button>`).join('') : '';
      const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/preview.css"></head><body class="phone-body"><header id="preview-navigation"><span id="preview-title">纯电主义 · ${page}</span></header><main id="preview-page"></main>${tabs?'<nav id="preview-tabs">'+tabs+'</nav>':''}<script>const tree=${escape(tree)},banner=${escape(banner)};${renderCode};document.getElementById('preview-page').append(render(tree));const styles=(function(global){${compiled.wxss}})({});for(const file of ${escape(['app.wxss',route+'.wxss',...(mode==='reference'?['components/demo-banner/index.wxss']:[])])}){const build=styles(file);if(build)build('',{deviceWidth:390,allowIllegalSelector:true});}</script></body></html>`;
      fs.writeFileSync(path.join(HTML,mode+'-'+page+'.html'),html);
      if(mode==='real')report.pages.push({page,reference:'reference-'+page+'.png',real:'real-'+page+'.png',originalStylesIdentical:fs.readFileSync(path.join(REFERENCE,'src',route+'.wxss')).equals(fs.readFileSync(path.join(ROOT,'src',route+'.wxss')))});
    }
  }
  fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');
  const server=http.createServer((req,res)=>{const name=decodeURIComponent(req.url.split('?')[0]);let file;if(/^\/(reference|real)-[a-z-]+\.html$/.test(name))file=path.join(HTML,name.slice(1));else if(name==='/preview.css')file=path.join(ROOT,'scripts/preview/preview.css');else if(/^\/assets\/[a-z-]+\.png$/.test(name))file=path.join(ROOT,'src',name.slice(1));else{res.writeHead(404);res.end();return;}res.setHeader('Content-Type',name.endsWith('.png')?'image/png':name.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(file));});
  server.listen(18939,'127.0.0.1',()=>console.log('Offline layout QA: http://127.0.0.1:18939'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
