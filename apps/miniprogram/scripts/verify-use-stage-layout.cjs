// Offline real-WXML layout checks with synthetic dashboard responses only.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {spawnSync}=require('node:child_process');
const {compile}=require('./compile-templates.cjs');
const root=path.resolve(__dirname,'..');
const sourceRoot=path.resolve(process.env.MINIAPP_SOURCE_ROOT||process.env.MINIAPP_SOURCE_DIR||path.join(root,'src'));
const out=path.resolve(process.env.MINIAPP_QA_OUTPUT||path.join(root,'.artifacts/use-stage-layout'));
fs.mkdirSync(out,{recursive:true});
const {createApi}=require(path.join(sourceRoot,'services/api'));
const config=require(path.join(sourceRoot,'config'));
const compiled=compile(sourceRoot);
const generate=vm.runInNewContext('(function(global){'+compiled.wxml+'})({})',{window:{},console});
const base={id:'offline-order',orderId:'offline-order',vehicleName:'ET5T · 离线合成订阅车辆',vehicle:{id:'offline-vehicle',name:'ET5T · 离线合成订阅车辆'},imageUrl:'',currentAssignment:null,activeChangeId:null,deliveryDelayChangeId:null,mileageText:'每月 1500 公里',monthlyFeeText:'¥0.01',planTitle:'12 个月订阅'};
const current={id:'offline-assignment',status:'ACTIVE',vehicle:{id:'offline-current-car',title:'已交付车辆 · 离线合成'},startAt:'2026-10-26T00:00:00Z',endAt:null,startReadingKm:23000,endReadingKm:null};
const cases={
  signature:{...base,status:'AWAITING_SIGNATURE',statusText:'待签约'},
  signature_application:{...base,status:'AWAITING_SIGNATURE',statusText:'待签约'},
  payment:{...base,status:'AWAITING_PAYMENT',statusText:'待支付'},
  handover:{...base,status:'AWAITING_HANDOVER',statusText:'待交付'},
  active:{...base,status:'ACTIVE',statusText:'使用中',currentAssignment:current},
  swap:{...base,status:'ACTIVE',statusText:'使用中',vehicle:null,activeChangeId:'offline-change'},
  unassigned:{...base,status:'ACTIVE',statusText:'使用中',vehicle:null},
  settling:{...base,status:'SETTLING',statusText:'结算中',vehicle:null,activeChangeId:'historical-change'},
  completed:{...base,status:'COMPLETED',statusText:'已完成',vehicle:null},
  cancelled:{...base,status:'CANCELLED',statusText:'已取消',activeChangeId:'historical-change'},
};
const renderer=`function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag);for(const[k,v]of Object.entries(t.attr||{})){if(v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
(async()=>{
  const requests=[];
  for(const [name,subscription]of Object.entries(cases)){
    const api=createApi(config,request=>{requests.push(request.method);request.success({statusCode:200,data:{subscription,application:name==='signature_application'?{id:'offline-application',status:'CONFIRMED',vehicleName:'旧申请不应重复显示',planTitle:'旧申请套餐'}:null,active:subscription.status==='ACTIVE',mileage:0,todos:[],bill:null,services:[],entitlements:[]}})}, {getStorageSync:()=>({token:'offline-only',expiresAt:'2099-01-01T00:00:00Z',customer:{id:'offline-customer'}})});
    let definition;
    vm.runInNewContext(fs.readFileSync(path.join(sourceRoot,'pages/use/index.js'),'utf8'),{Page:v=>definition=v,require:name=>name.includes('/services/')?api:{load:async(p,fn)=>p.setData({...await fn(),loading:false}),go:()=>{throw Error('Layout must not navigate');}}});
    const page={...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,v)}};await page.reload();
    const tree=generate('pages/use/index.wxml')(page.data);
    for(const width of [320,390])fs.writeFileSync(path.join(out,`use-${width}-${name}.html`),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(root,'scripts/preview/preview.css')).href}"></head><body class="phone-body"><header id="preview-navigation">用车 · 离线排版核验</header><main id="preview-page"></main><script>${renderer};document.getElementById('preview-page').append(render(${JSON.stringify(tree).replaceAll('<','\\u003c')}));const styles=(function(global){${compiled.wxss}})({});for(const file of ['app.wxss','pages/use/index.wxss'])styles(file)('',{deviceWidth:${width},allowIllegalSelector:true});</script></body></html>`);
  }
  if(requests.some(method=>method!=='GET'))throw Error('Unexpected mutation');
  const python=`
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path(${JSON.stringify(out)})
results=[]
errors=[]
external=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    for width in [320,390]:
        page=browser.new_page(viewport={'width':width,'height':844},device_scale_factor=1)
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('request',lambda r:external.append(r.url) if r.url.startswith(('http:','https:')) else None)
        for state in ${JSON.stringify(Object.keys(cases))}:
            page.goto((out/f'use-{width}-{state}.html').as_uri(),wait_until='load')
            text=page.locator('#preview-page').inner_text()
            assert '每月套餐里程' in text and '每月 1500 公里' in text and '¥0.01' in text
            assert '最近确认里程' not in text and '暂无当前车辆读数' not in text
            assert page.locator('[bindtap="openSubscription"]').count()==1
            assert page.locator('[bindtap="openSubscription"]').inner_text()=='查看本订单'
            assert '合同记录' in text and '立即签署' not in text
            assert '还没有开始的订阅' not in text and '查看申请进度' not in text,(width,state,text)
            assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(width,state)
            if state in ['signature','signature_application','payment','handover']:
                assert '离线合成订阅车辆' in text and '尚未交付' in text and '换车' not in text
                assert '道路救援' not in text and page.locator('.next-step').count()==1
                if state=='signature':
                    assert '联系运营核对合同准备与签署进度' in text
                    assert page.locator('.order-action').bounding_box()['y']<844
            elif state=='active':
                assert '已交付车辆 · 离线合成' in text and '道路救援' in text
            elif state=='swap':
                assert '暂无分配车辆' in text and '换车办理中' in text
            elif state=='unassigned':
                assert '尚待核实' in text and '换车办理中' not in text
            elif state in ['settling','completed','cancelled']:
                assert '换车' not in text and '道路救援' not in text
            page.screenshot(path=str(out/f'use-{width}-{state}.png'),full_page=state=='signature')
            results.append({'width':width,'state':state,'horizontalOverflow':False,'exactOrderAction':True})
        page.close()
    browser.close()
assert not errors,errors
assert not external,external
report={'cases':results,'runtimeErrors':errors,'externalRequests':external,'productionMutations':False,'runtime':'Offline actual wcc/wcsc + synthetic API + Edge layout; not a WeChat device test'}
(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\\n',encoding='utf-8')
print(json.dumps({'cases':len(results),'runtimeErrors':len(errors),'externalRequests':len(external),'passed':True}))
`;
  const result=spawnSync('python',['-c',python],{encoding:'utf8',maxBuffer:1024*1024});
  if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);if(result.error)throw result.error;process.exitCode=result.status||0;
})().catch(e=>{console.error(e);process.exitCode=1});
