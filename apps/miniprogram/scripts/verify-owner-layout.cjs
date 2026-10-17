// Compile actual WXML/WXSS and render synthetic states. No server, SDK or provider requests.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {compile}=require('./compile-templates.cjs'),root=path.resolve(__dirname,'..'),out=path.join(root,'evidence/owner-layout'),html=path.join(root,'.artifacts/owner-layout');fs.mkdirSync(out,{recursive:true});fs.mkdirSync(html,{recursive:true});
let definition;vm.runInNewContext(fs.readFileSync(path.join(root,'src/pages/owner/index.js'),'utf8'),{require:()=>({}),Page:v=>definition=v});
const owner={name:'合成车主企业有限公司',creditCode:'SYNTHETIC000000001',address:'合成地址',contactPhone:'021-55550000',statusText:'已核验',readyForSigning:true,realNameStatus:'VERIFIED'},record={id:'synthetic-task',resourceId:'synthetic-contract',statusText:'待双方签署',modeText:'逐份手动确认',status:'READY',reviewedAt:'2026-10-17',canSign:true,canChooseManual:true,body:'实际出租方：合成车主企业有限公司。\n乙方：合成客户。\n完整逐单条款，仅供离线版面检查。',sourceSha256:'a'.repeat(64),parties:[{role:'OWNER',status:'PENDING'},{role:'CUSTOMER',status:'SIGNED'}]};
const cases=[{name:'invitation',owner:null},{name:'identity-unchecked',owner:{...owner,realNameStatus:'NOT_STARTED',readyForSigning:false},identity:true},{name:'scope-unchecked',owner,options:{template:{title:'企业车主订阅合同',version:2,hash:'b'.repeat(64)},vehicles:[{vehicleId:'vehicle1',vehicle:{title:'合成 ET5T'}}]},auto:true},{name:'manual-unchecked',owner,record},{name:'manual-explicit',owner,record,pdfRead:true,documentAccepted:true,sign:true},{name:'signed-archived',owner,record:{...record,status:'ARCHIVED',statusText:'双方签署已归档',canSign:false,canChooseManual:false,signedFileId:'signed',parties:record.parties.map(p=>({...p,status:'SIGNED'}))}}];
const compiled=compile(),generate=vm.runInNewContext('(function(global){'+compiled.wxml+'})({})',{window:{},console});
const renderer=`function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag);for(const[k,v]of Object.entries(t.attr||{})){if(/^(bind|catch)/.test(k)||['value','checked'].includes(k)||v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}if(t.tag==='wx-checkbox'){const i=document.createElement('input');i.type='checkbox';i.checked=!!t.attr?.checked;e.append(i);}else(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
for(const c of cases){const data={...definition.data,loading:false,...c},tree=JSON.stringify(generate('pages/owner/index.wxml')(data)).replaceAll('<','\\u003c');fs.writeFileSync(path.join(html,c.name+'.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(root,'scripts/preview/preview.css')).href}"></head><body class="phone-body"><main id="preview-page"></main><script>${renderer};document.getElementById('preview-page').append(render(${tree}));const styles=(function(global){${compiled.wxss}})({});for(const f of ['app.wxss','pages/owner/index.wxss'])styles(f)('',{deviceWidth:390,allowIllegalSelector:true});</script></body></html>`);}
const python=`
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
cases=json.loads(${JSON.stringify(JSON.stringify(cases.map(c=>({name:c.name,sign:!!c.sign}))))});html=Path(${JSON.stringify(html)});out=Path(${JSON.stringify(out)});errors=[];requests=[]
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True);page=b.new_page(viewport={'width':390,'height':844})
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url) if r.url.startswith(('https:','http:')) else None)
 for c in cases:
  page.goto((html/(c['name']+'.html')).as_uri());button=page.locator('wx-button').filter(has_text='进入本企业手动签署')
  assert (button.count()==1 and button.get_attribute('disabled') is None)==c['sign'],c
  if c['name']!='manual-explicit':assert page.locator('input[type=checkbox]:checked').count()==0,c
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),c
  page.screenshot(path=str(out/(c['name']+'.png')),full_page=True);c['passed']=True
 b.close()
assert not errors,errors
assert not requests,requests
report={'scope':'Actual WXML/WXSS synthetic offline states only','cases':cases,'runtimeErrors':errors,'externalRequests':requests};(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report))
`;
const result=spawnSync('python',['-c',python],{encoding:'utf8',maxBuffer:1024*1024});if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);if(result.error)throw result.error;process.exitCode=result.status||0;
