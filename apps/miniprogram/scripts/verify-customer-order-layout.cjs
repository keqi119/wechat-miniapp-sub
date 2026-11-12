// Offline real-WXML/wcsc verification. All data is synthetic; no business requests.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {spawnSync}=require('node:child_process');
const {compile}=require('./compile-templates.cjs');
const {orderRecord,related}=require('../tests/fixtures/customer-order-overview.cjs');
const root=path.resolve(__dirname,'..');
const sourceRoot=path.resolve(process.env.MINIAPP_SOURCE_ROOT||process.env.MINIAPP_SOURCE_DIR||path.join(root,'src'));
const out=path.resolve(process.env.MINIAPP_QA_OUTPUT||path.join(root,'.artifacts/customer-order-layout'));
fs.mkdirSync(out,{recursive:true});
const compiled=compile(sourceRoot);
const generate=vm.runInNewContext('(function(global){'+compiled.wxml+'})({})',{window:{},console});
const states={
  draft:orderRecord(),
  ready:orderRecord({detail:{contracts:[related('offline-contract','订阅主合同','PENDING','/pages/record/index?type=contracts&id=offline-contract',{statusText:'待签署',canSign:true,documents:[{id:'offline-source',title:'待签合同文件',url:'/api/customer/files/offline-source'}]})]}}),
  payment:orderRecord({status:'AWAITING_PAYMENT',detail:{guidance:{title:'核对并支付本单账单',description:'请进入已发布账单查看应付金额和支付状态。'},bills:[related('offline-bill','首期账单','PENDING','/pages/record/index?type=bills&id=offline-bill',{statusText:'待支付',canPay:true,amountText:'¥0.01'})]}}),
  handover:orderRecord({status:'AWAITING_HANDOVER',detail:{guidance:{title:'等待车辆交接',description:'请核对已发布的本单交接记录。'},handovers:[related('offline-handover','交车记录','PUBLISHED','/pages/handover/index?id=offline-handover',{statusText:'待核对'})]}}),
  active:orderRecord({status:'ACTIVE',detail:{vehicle:{title:'真实当前车辆 · 离线合成',imageUrl:'',originalTitle:'原车不作为当前车',currentState:'CURRENT'},guidance:{title:'订阅进行中',description:'按本单账单与服务记录继续用车。'}}}),
  gap:orderRecord({status:'ACTIVE',detail:{vehicle:{title:'当前暂无交付车辆',imageUrl:'',originalTitle:'旧车不得冒充当前车',currentState:'ORIGINAL'},guidance:{title:'核对交付进度',description:'当前暂无交付车辆，请联系运营核对。'}}}),
  settling:orderRecord({status:'SETTLING',detail:{vehicle:{title:'车辆已交还',imageUrl:'',originalTitle:'已交还原车不作当前车',currentState:'RETURNED'},guidance:{title:'等待结算',description:'已还车，请核对已发布的费用与押金结算。'}}}),
  completed:orderRecord({status:'COMPLETED',detail:{guidance:{title:'订阅已完成',description:'可查看本次合同、账单及交接记录。'}}}),
  cancelled:orderRecord({status:'CANCELLED',detail:{guidance:{title:'订单已取消',description:'可查看历史订单信息，无需继续办理。'}}}),
  legacy:{id:'offline-order',title:'车辆订阅订单',status:'AWAITING_SIGNATURE',statusText:'待签约',createdAt:'2026-10-25T17:10:00Z',details:[{label:'编号',value:'offline-order'},{label:'创建时间',value:'2026-10-25T17:10:00Z'}],planSnapshot:{privateMarker:'不可展示原始快照'},actions:[],timeline:[],documents:[]},
  bill:{id:'offline-bill',type:'bills',title:'离线真实账单',statusText:'待支付',amountText:'¥0.01',details:[{label:'应付日期',value:'2026.10.26'}],actions:[{id:'pay',label:'立即支付'}],timeline:[],documents:[]},
};
if(process.env.MINIAPP_ORDER_DTO_FIXTURE){const fixture=JSON.parse(fs.readFileSync(process.env.MINIAPP_ORDER_DTO_FIXTURE,'utf8'));if(fixture.synthetic!==true)throw Error('Layout fixture must be synthetic');states.api_contract=fixture.record;}
const expected=Object.fromEntries(Object.entries(states).map(([key,record])=>[key,{id:record.id,createdAtText:record.orderDetail?.createdAtText||'2026-10-26 01:10:00（北京时间）',summaryValues:(record.orderDetail?.summaryRows||[]).map(row=>row.value)}]));
const renderer=`function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag);for(const[k,v]of Object.entries(t.attr||{})){if(v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
(async()=>{
  for(const [state,record]of Object.entries(states)){
    let definition;
    const helpers={load:async(p,fn)=>p.setData({...await fn(),loading:false}),go:()=>{throw Error('Layout must not navigate');}};
    vm.runInNewContext(fs.readFileSync(path.join(sourceRoot,'pages/record/index.js'),'utf8'),{Page:v=>definition=v,require:name=>name.includes('/services/')?{getRecord:async()=>record}:name.includes('/utils/page')?helpers:require(path.resolve(sourceRoot,'pages/record',name)),wx:{showModal(){},setNavigationBarTitle(){}}});
    const page={...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,v)}};
    page.setData({type:state==='bill'?'bills':'orders',id:record.id});await page.reload();
    for(const mode of state==='draft'?['default','expanded']:['default'])for(const width of [320,390]){
      const data={...page.data,showOrderTerms:mode==='expanded',message:'点击反馈不应出现在订单正文'};
      const tree=generate('pages/record/index.wxml')(data);
      fs.writeFileSync(path.join(out,`order-${width}-${state}-${mode}.html`),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(root,'scripts/preview/preview.css')).href}"></head><body class="phone-body"><header id="preview-navigation">${state==='bill'?'记录':'订单'}详情 · 离线排版核验</header><main id="preview-page"></main><script>${renderer};document.getElementById('preview-page').append(render(${JSON.stringify(tree).replaceAll('<','\\u003c')}));const styles=(function(global){${compiled.wxss}})({});for(const file of ['app.wxss','pages/record/index.wxss'])styles(file)('',{deviceWidth:${width},allowIllegalSelector:true});</script></body></html>`);
    }
  }
  const python=`
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path(${JSON.stringify(out)})
results=[]
errors=[]
external=[]
expected=${JSON.stringify(expected)}
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    for width in [320,390]:
        page=browser.new_page(viewport={'width':width,'height':844},device_scale_factor=1)
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('request',lambda r:external.append(r.url) if r.url.startswith(('http:','https:')) else None)
        for state in ${JSON.stringify(Object.keys(states))}:
            for mode in (['default','expanded'] if state=='draft' else ['default']):
                page.goto((out/f'order-{width}-{state}-{mode}.html').as_uri(),wait_until='load')
                text=page.locator('#preview-page').inner_text()
                assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(width,state,mode)
                if state=='bill':
                    assert '离线真实账单' in text and '立即支付' in text
                    assert page.locator('.order-heading').count()==0
                else:
                    assert text.count(expected[state]['id'])==1,(width,state,mode,text)
                    assert expected[state]['createdAtText'] in text and '2026-10-25T17:10:00Z' not in text
                    assert '点击反馈不应出现在订单正文' not in text
                    assert '立即签署' not in text and '立即支付' not in text
                    assert page.locator('[bindtap="act"]').count()==0
                    if state=='legacy':
                        assert '订单摘要暂未提供或版本待核对' in text and '不可展示原始快照' not in text
                        assert '¥0.01' not in text
                    else:
                        for value in expected[state]['summaryValues']: assert value in text,(width,state,value)
                        if state!='api_contract':assert '离线合成出租企业' in text and '1500 公里' in text
                        assert page.locator('.order-related').first.bounding_box()['y'] < page.locator('.order-section').first.bounding_box()['y']
                        if mode=='expanded':
                            assert '完整条款全文测试' in text and '原始已确认方案' in text
                        else:
                            assert '完整条款全文测试' not in text
                    if state=='draft':
                        assert '准备中' in text and '暂无已发布账单' in text and '暂无已发布交接记录' in text
                        assert page.locator('[bindtap="openOrderRelated"]').count()==0
                    if state=='ready':
                        button=page.locator('[bindtap="openOrderDocument"]')
                        assert button.get_attribute('data-id')=='offline-contract'
                        assert button.get_attribute('data-file-id')=='offline-source'
                    if state=='gap':assert '当前暂无交付车辆' in text and '旧车不得冒充当前车' not in text
                    if state=='active':assert '真实当前车辆' in text and '原车不作为当前车' not in text
                    if state=='settling':assert '车辆已交还' in text and '已交还原车不作当前车' not in text
                    if state=='api_contract':
                        period=page.locator('.order-summary-item').last
                        assert period.bounding_box()['width']>page.locator('.order-summary-grid').bounding_box()['width']*0.9
                page.screenshot(path=str(out/f'order-{width}-{state}-{mode}.png'),full_page=state in ['draft','legacy','api_contract'])
                results.append({'width':width,'state':state,'mode':mode,'horizontalOverflow':False})
        page.close()
    browser.close()
assert not errors,errors
assert not external,external
report={'cases':results,'runtimeErrors':errors,'externalRequests':external,'productionMutations':False,'runtime':'Offline actual wcc/wcsc + synthetic DTO + Edge layout; not a device test'}
(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\\n',encoding='utf-8')
print(json.dumps({'cases':len(results),'runtimeErrors':len(errors),'externalRequests':len(external),'passed':True}))
`;
  const result=spawnSync('python',['-c',python],{encoding:'utf8',maxBuffer:1024*1024});
  if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);if(result.error)throw result.error;process.exitCode=result.status||0;
})().catch(error=>{console.error(error);process.exitCode=1});
