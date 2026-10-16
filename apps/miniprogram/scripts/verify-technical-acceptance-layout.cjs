// Offline actual-wcc display only. No API/DB/native SDK or supplier navigation.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { spawnSync } = require('node:child_process'), { pathToFileURL } = require('node:url');
const { compile } = require('./compile-templates.cjs'), { createApi } = require('../src/services/api'), config = require('../src/config');
const { document, detail, summary, ready } = require('../tests/fixtures/technical-acceptance.cjs');
const root = path.resolve(__dirname,'..'), out = path.join(root,'evidence/technical-acceptance-layout'), htmlDir = path.join(root,'.artifacts/technical-acceptance-layout');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(htmlDir,{recursive:true});
const template = fs.readFileSync(path.join(root,'../../docs/legal/versions/technical-signing/technical-signing-verification-v1.md'),'utf8');
const values = { verificationNo:'SYNTHETIC-TA-1',generatedAt:'2026-10-16 20:00:00',participantName:'离线合成参与者',maskedMobile:'138****0000',platformSignatureSlot:'甲方企业签章见末尾独立签署区',participantSignatureSlot:'乙方本人签署见末尾独立签署区' };
const content = template.replace(/\{\{(\w+)\}\}/g,(_,k)=>{if(!values[k])throw Error('Unknown synthetic slot');return values[k];});if(/\{\{|\}\}/.test(content))throw Error('Unresolved synthetic text');
const doc={...document,content},base=detail({document:doc});
const cases = [
  {name:'technical-unchecked-full-text',value:base,text:'本人逐份确认',confirm:false},
  {name:'technical-read-without-data-consent',value:base,read:true,text:'本次必要信息处理',confirm:false},
  {name:'technical-both-explicit-choices',value:base,read:true,accepted:true,text:'本次必要信息处理',confirm:true},
  {name:'technical-awaiting-independent-approval',value:ready({document:doc,approval:null,canSign:false}),text:'本人确认已记录',sign:false},
  {name:'technical-ready-to-sign',value:ready({document:doc}),text:'进入本人签署',sign:true},
  {name:'technical-partial-pending',value:ready({document:doc,status:'PENDING',signatureStatus:'PENDING',canSign:false}),text:'签署处理中，尚未完成归档',sign:false},
  {name:'technical-signed-archived',value:ready({document:doc,status:'SIGNED',signatureStatus:'SIGNED',signedFileId:'signed1',canSign:false}),text:'本份双方真实签署已核验并归档',sign:false},
  {name:'technical-stopped-channel-pending',value:ready({document:doc,status:'STOPPED',stoppedAt:'2026-10-16T12:05:00Z',signatureStatus:'PENDING',canSign:false,canStop:false}),text:'不能据此认定供应商在途任务已撤销',sign:false},
  {name:'technical-stopped-late-archive',value:ready({document:doc,status:'STOPPED',stoppedAt:'2026-10-16T12:05:00Z',signatureStatus:'SIGNED',signedFileId:'signed1',canSign:false,canStop:false}),text:'本份双方真实签署已核验并归档',sign:false},
  {name:'technical-signing-disabled-confirm-allowed',value:detail({document:doc,enabled:false}),text:'暂未开放实际签署',confirm:false,sign:false},
  {name:'technical-general-consent-update',value:detail({document:doc,consentRequirementsMet:false,canConfirm:false}),text:'前往账户设置阅读当前协议',confirm:false},
  {name:'technical-purged-read-only',value:detail({status:'PURGED',retentionStatus:'PURGED',document:null,sourceFileId:null,canConfirm:false,canStop:false}),text:'独立验证资料已清理',confirm:false,sign:false},
  {name:'technical-purged-historical-signed',value:detail({status:'PURGED',retentionStatus:'PURGED',document:null,signatureStatus:'SIGNED',sourceFileId:null,signedFileId:null,canConfirm:false,canStop:false}),text:'历史记录保留双方签署事实',confirm:false,sign:false},
  {name:'technical-settings-assigned',route:'settings',assigned:true,text:'查看本份全文与真实签署结果'},
  {name:'technical-settings-none',route:'settings',assigned:false,text:'电子签署实名准备'},
];
const compiled=compile(),generate=vm.runInNewContext('(function(global){'+compiled.wxml+'})({})',{window:{},console}),definitions={};
for(const route of ['technical-acceptance','settings'])vm.runInNewContext(fs.readFileSync(path.join(root,'src/pages',route,'index.js'),'utf8'),{require:()=>({}),Page:v=>{definitions[route]=v;}});
const renderer=`function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag);for(const[k,v]of Object.entries(t.attr||{})){if(/^(bind|catch)/.test(k)||['value','checked'].includes(k)||v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}if(t.tag==='wx-checkbox'){const i=document.createElement('input');i.type='checkbox';i.checked=!!t.attr?.checked;e.append(i);}else(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
async function main(){
  for(const item of cases){const route=item.route||'technical-acceptance';let record=null,items=[];const api=createApi(config,v=>v.success({statusCode:200,data:route==='settings'?{items:item.assigned?[summary()]:[]}:item.value}),{getStorageSync:()=>({token:'offline-synthetic',expiresAt:'2099-01-01T00:00:00Z',customer:{id:'c1'}})});
    if(route==='settings')items=await api.getTechnicalAcceptances();else record=await api.getTechnicalAcceptance('ta1');
    const data={...definitions[route].data,loading:false,error:'',record,documentRead:item.read===true,dataAccepted:item.accepted===true,consentUpdateRequired:record?.consentRequirementsMet===false&&!record?.confirmedAt};
    if(route==='settings')Object.assign(data,{authenticated:true,profile:{name:'离线合成账户'},consentCurrent:true,legalDocuments:[],readiness:{realNameStatus:'VERIFIED',certBound:true,readyForSigning:true},identityVerified:true,identityStatusText:'已完成实名核验',certificateStatusText:'签署证书已就绪',signingConfig:{enabled:true,signProviderConfigured:true},technicalAcceptances:items});
    const tree=generate('pages/'+route+'/index.wxml')(data),json=JSON.stringify(tree).replaceAll('<','\\u003c');
    fs.writeFileSync(path.join(htmlDir,item.name+'.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(root,'scripts/preview/preview.css')).href}"></head><body class="phone-body"><header id="preview-navigation">技术签署验证 · 离线合成版面</header><main id="preview-page"></main><script>${renderer};document.getElementById('preview-page').append(render(${json}));const styles=(function(global){${compiled.wxss}})({});for(const file of ['app.wxss','pages/${route}/index.wxss'])styles(file)('',{deviceWidth:390,allowIllegalSelector:true});</script></body></html>`);delete item.value;
  }
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({generatedAt:new Date().toISOString(),scope:'Offline actual-wcc synthetic account and resolved approved template display only; no real customer/API/DB/channel/SDK/QR/preview/upload. Hashes and file IDs are synthetic.',viewport:{width:390,height:844},cases},null,2)+'\n');
  const python=`
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
html=Path(${JSON.stringify(htmlDir)});out=Path(${JSON.stringify(out)})
report=json.loads((out/'report.json').read_text(encoding='utf-8'));errors=[];external=[]
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='msedge',headless=True)
 page=browser.new_page(viewport=report['viewport'],device_scale_factor=1)
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('request',lambda r:external.append(r.url) if r.url.startswith(('http:','https:')) else None)
 for item in report['cases']:
  page.goto((html/(item['name']+'.html')).as_uri(),wait_until='load');text=page.locator('#preview-page').inner_text()
  assert item['text'] in text,item['name']
  assert page.locator('wx-web-view').count()==0
  if item.get('route')=='settings':
   assert page.locator('wx-button').filter(has_text='查看本份全文与真实签署结果').count()==int(item['assigned'])
  else:
   assert page.locator('wx-input').count()==0
   button=page.locator('wx-button').filter(has_text='确认本份文件及单独同意')
   assert (button.count()==1 and button.get_attribute('disabled') is None)==item.get('confirm',False),item['name']
   assert page.locator('wx-button').filter(has_text='进入本人签署').count()==int(item.get('sign',False)),item['name']
   assert '不表示整套系统' in text or '独立验证资料已清理' in text
  item['overflow']=page.evaluate('document.documentElement.scrollWidth>innerWidth+1');assert not item['overflow'],item['name']
  item['screenshot']=item['name']+'.png';page.screenshot(path=str(out/item['screenshot']),full_page=True)
  if item['name'] in ['technical-unchecked-full-text','technical-both-explicit-choices','technical-stopped-late-archive','technical-general-consent-update']:
   page.screenshot(path=str(out/(item['name']+'-top.png')))
   page.locator('wx-button').filter(has_text='返回账户设置').scroll_into_view_if_needed();page.screenshot(path=str(out/(item['name']+'-actions.png')))
  item['passed']=True
 browser.close()
assert not errors,errors
assert not external,external
report.update(browser='Microsoft Edge headless via Playwright',runtimeErrors=errors,externalRequests=external)
(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\\n',encoding='utf-8')
print(json.dumps(dict(cases=len(report['cases']),runtimeErrors=errors,externalRequests=external)))
`;
  const result=spawnSync('python',['-c',python],{encoding:'utf8',maxBuffer:1024*1024});if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);if(result.error)throw result.error;process.exitCode=result.status||0;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
