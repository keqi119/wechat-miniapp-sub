// Visual QA of real built admin and actual-wcc miniapp templates. Every API request is intercepted.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const admin = resolve(import.meta.dirname, '..'), mini = resolve(admin, '../miniprogram');
const out = join(admin, 'qa/ninda-yellow-black-v2'), miniOut = join(mini, 'evidence/ninda-yellow-black-v2');
const htmlRoot = join(mini, '.artifacts/ninda-yellow-black-v2');
for (const directory of [out, miniOut, htmlRoot]) mkdirSync(directory, { recursive: true });
const require = createRequire(import.meta.url), { compile } = require(join(mini, 'scripts/compile-templates.cjs'));
const compiled = compile(join(mini, 'src'));
const generate = vm.runInNewContext('(function(global){' + compiled.wxml + '})({})', { window: {}, console });
const app = JSON.parse(readFileSync(join(mini, 'src/app.json'), 'utf8'));
const vehicle = { id:'synthetic-car',name:'蔚来 ES6 · 离线展示',brand:'蔚来',city:'上海',registrationText:'2022 年上牌',mileageText:'68,000 km',minFeeText:'¥4,999',statusText:'可订阅',available:true,bodyType:'纯电 SUV',imageUrl:'' };
const miniCases = [
  { name:'home',route:'pages/home/index',data:{loading:false,error:'',vehicles:[vehicle],nextAction:null} },
  { name:'catalog',route:'pages/catalog/index',data:{loading:false,error:'',items:[vehicle],brands:['蔚来','特斯拉','小鹏'],brand:'',query:'',appliedQuery:''} },
  { name:'settings',route:'pages/settings/index',data:{authenticated:false,legalDocumentsReady:true,legalDocuments:[{id:'qa-terms',type:'terms',title:'用户协议 · 离线排版',version:1},{id:'qa-privacy',type:'privacy',title:'隐私政策 · 离线排版',version:1}],signingConfig:null,customerServiceTelephone:'18616570212'} },
];
const escape = value => JSON.stringify(value).replaceAll('<','\\u003c');
const renderer = `function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag),a=t.attr||{};for(const[k,v]of Object.entries(a)){if(/^(bind|catch)/.test(k)||['value','checked'].includes(k)||v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}if(t.tag==='wx-image'){const i=document.createElement('img');i.src=a.src||'';e.append(i);}else if(['wx-input','wx-textarea'].includes(t.tag)){const i=document.createElement(t.tag==='wx-input'?'input':'textarea');i.value=a.value||'';i.placeholder=a.placeholder||'';e.append(i);}else if(t.tag==='wx-checkbox'){const i=document.createElement('input');i.type='checkbox';i.checked=!!a.checked;e.append(i);}else(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
for(const item of miniCases){
  let definition;
  vm.runInNewContext(readFileSync(join(mini,'src',item.route+'.js'),'utf8'), { require:()=>({}), Page:value=>{definition=value;} });
  const tree=generate(item.route+'.wxml')({...definition.data,...item.data});
  const hasTabs=app.tabBar.list.some(tab=>tab.pagePath===item.route);
  const tabs=hasTabs?`<nav id="preview-tabs">${app.tabBar.list.map(tab=>`<button ${tab.pagePath===item.route?'aria-current="page"':''}><img src="/${tab.pagePath===item.route?tab.selectedIconPath:tab.iconPath}"><span>${tab.text}</span></button>`).join('')}</nav>`:'';
  const title=JSON.parse(readFileSync(join(mini,'src',item.route+'.json'),'utf8')).navigationBarTitleText;
  const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/mini/preview.css"><style>.phone-body{background:#f6f4ee;color:#231815}#preview-navigation{background:${app.window.navigationBarBackgroundColor};color:#231815;border-bottom:0}#preview-tabs{background:${app.tabBar.backgroundColor}}#preview-tabs button{color:${app.tabBar.color}}#preview-tabs button[aria-current=page]{color:${app.tabBar.selectedColor};font-weight:700}wx-scroll-view[scroll-x]{overflow-x:auto}.brand-image img{object-fit:fill}</style></head><body class="phone-body"><header id="preview-navigation"><span>${title}</span></header><main id="preview-page"></main>${tabs}<script>${renderer};document.getElementById('preview-page').append(render(${escape(tree)}));const styles=(function(global){${compiled.wxss}})({});for(const file of ['app.wxss',${escape(item.route+'.wxss')}])styles(file)('',{deviceWidth:390,allowIllegalSelector:true});</script></body></html>`;
  writeFileSync(join(htmlRoot,item.name+'.html'),html);
}
const server=createServer((req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  let file;
  if(pathname==='/mini/preview.css')file=join(mini,'scripts/preview/preview.css');
  else if(/^\/mini\/(home|catalog|settings)\.html$/.test(pathname))file=join(htmlRoot,pathname.split('/').at(-1));
  else if(/^\/assets\/(ninda-logo|home|home-active|car|car-active|key|key-active|person|person-active)\.png$/.test(pathname))file=join(mini,'src',pathname);
  else if(pathname==='/'||pathname==='/index.html')file=join(admin,'dist/index.html');
  else if(pathname==='/field.html')file=join(admin,'dist/field.html');
  else if(/^\/assets\/[A-Za-z0-9_.-]+$/.test(pathname))file=join(admin,'dist',pathname);
  if(!file){res.writeHead(404);res.end();return;}
  file=resolve(file);assert.ok([admin,mini].some(root=>file.startsWith(root+sep)));
  try{const type=file.endsWith('.png')?'image/png':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript';res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`, expected='https://api.evsub.ndacar.com/api';
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],apiRequests=[],screens=[];
let mode='login';
const page=await browser.newPage({viewport:{width:1440,height:960}});
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===origin)return route.continue();
  apiRequests.push({url:url.href,method:request.method(),mode});
  assert.ok(url.href.startsWith(expected+'/'),'Unexpected external request is blocked: '+url.origin);
  const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-CSRF-Token'};
  const send=(status,data)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  assert.equal(request.method(),'GET','Brand screenshots do not write business state');
  const isField=mode==='field-tasks';
  if(url.pathname.endsWith('/admin/auth/me'))return mode.endsWith('login')?send(401,{error:{code:'UNAUTHORIZED',message:'离线排版未登录'}}):send(200,{user:{id:'qa-brand-user',username:'visual-qa',name:'排版验收',role:isField?'FIELD':'ADMIN',permissions:isField?['field-tasks.read']:['*']},csrfToken:'synthetic-visual-only'});
  if(url.pathname.endsWith('/admin/vehicles'))return send(200,{items:[{id:'synthetic-car-1',title:'蔚来 ES6 · 离线展示',brand:'蔚来',city:'上海',mileageKm:68000,status:'PUBLISHED',createdAt:'2026-10-19T00:00:00Z'},{id:'synthetic-car-2',title:'特斯拉 Model 3 · 离线展示',brand:'特斯拉',city:'上海',mileageKm:45000,status:'DRAFT',createdAt:'2026-10-19T00:00:00Z'}],total:2,page:1,pageSize:20});
  if(url.pathname.endsWith('/admin/field-tasks'))return send(200,{items:[{id:'qa-task',type:'DELIVERY',vehicleTitle:'蔚来 ES6 · 离线展示',plateNumber:'合成展示',customerName:'排版客户',orderId:'qa-order-20261019',status:'ASSIGNED',note:'仅验证手机端排版，不对应真实交车。'}],total:1,page:1,pageSize:12});
  if(url.pathname.endsWith('/admin/dashboard'))return send(200,{counts:{},recentActivity:[]});
  return send(200,{items:[],total:0,page:1,pageSize:20});
});
async function capture(name,directory){
  await page.evaluate(()=>Promise.all(Array.from(document.images).map(image=>image.complete?Promise.resolve():new Promise(resolve=>{image.onload=resolve;image.onerror=resolve;}))));
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  assert.equal(overflow,false,name+' viewport overflow');
  await page.screenshot({path:join(directory,name+'.png'),fullPage:true});
  const viewportScreenshot=directory===miniOut?name+'-viewport.png':null;
  if(viewportScreenshot)await page.screenshot({path:join(directory,viewportScreenshot),fullPage:false});
  screens.push({name,overflow:false,viewport:page.viewportSize(),viewportScreenshot});
}
try{
  await page.goto(origin);await page.getByRole('button',{name:'进入工作台'}).waitFor();
  assert.equal(await page.locator('.login-submit').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(249, 190, 0)');
  await capture('admin-login',out);
  mode='vehicles';await page.goto(origin+'/?qa=vehicles#vehicles');await page.locator('tbody tr').first().waitFor();await capture('admin-vehicles',out);
  mode='field-login';await page.setViewportSize({width:390,height:844});await page.goto(origin+'/field.html');await page.getByRole('button',{name:'进入我的任务'}).waitFor();await capture('field-login',out);
  mode='field-tasks';await page.reload();await page.locator('.task-card').waitFor();await capture('field-tasks',out);
  for(const item of miniCases){await page.goto(origin+'/mini/'+item.name+'.html');await page.locator('.page').waitFor();await capture('mini-'+item.name,miniOut);}
  assert.deepEqual(errors,[]);
  const report={recordedAt:new Date().toISOString(),scope:'Offline visual QA: actual built admin and actual-wcc miniapp templates, explicitly synthetic fixtures, all external requests intercepted. No credentials, DB, real API, native device, payment, signing, upload or deployment.',palette:{yellow:'#F9BE00',ink:'#231815'},apiTarget:expected,screens,apiRequests,runtimeErrors:errors};
  writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');writeFileSync(join(miniOut,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({screenshots:screens.length+screens.filter(row=>row.viewportScreenshot).length,runtimeErrors:errors.length,apiTarget:expected}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
