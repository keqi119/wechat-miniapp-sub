// Offline actual-wcc layout verification. Synthetic data only; no business requests.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { compile } = require('./compile-templates.cjs');
const root=path.resolve(__dirname,'..');
const sourceRoot=path.resolve(process.env.MINIAPP_SOURCE_ROOT || path.join(root,'src'));
const out=path.resolve(process.env.MINIAPP_QA_OUTPUT || path.join(root,'.artifacts/final-plan-confirmation-layout'));
fs.mkdirSync(out,{recursive:true});
const compiled=compile(sourceRoot);
const generate=vm.runInNewContext('(function(global){'+compiled.wxml+'})({})',{window:{},console});
let definition;
vm.runInNewContext(fs.readFileSync(path.join(sourceRoot,'pages/application-detail/index.js'),'utf8'),{require:()=>({}),Page:v=>definition=v});
const application={id:'offline-application',status:'AWAITING_CONFIRMATION',statusText:'待确认最终方案',title:'离线合成验收套餐',vehicleName:'ET5T · 离线合成车辆',planTitle:'12个月',monthlyFeeText:'¥0.01',timeline:[],finalPlan:{revision:1,complete:true,usagePolicyComplete:true,vehicleName:'ET5T · 离线合成车辆',planTitle:'离线合成套餐',termMonths:12,mileageText:'每月1500公里',energyText:'充电自理',benefits:['合成订阅权益'],monthlyFeeText:'¥0.01',depositText:'¥0.00',excessMileagePriceText:'¥1.50',startDateText:'2026.11.01',endDateText:'2027.10.31',firstDueDateText:'2026.10.26',billingRows:Array.from({length:12},(_,i)=>({sequence:i+1,amountText:'¥0.01',dueDateText:'2026.11.01',periodText:'离线合成服务期间'})),commercialRows:Array.from({length:14},(_,i)=>({key:String(i),label:'逐单约定 '+(i+1),value:'离线合成车辆、费用及服务条款，不作为生产合同。'})),notes:'离线排版核验，不作为生产合同。',lessorSnapshot:{name:'离线合成出租企业',creditCode:'仅供本地排版',address:'离线合成地址',phone:'测试联系信息',sharingNotice:{content:'本说明为离线排版数据。为本单履约向实际出租方提供必要合同资料，须由用户单独同意。'}},usagePolicy:{policyVersion:'USAGE_V1',documentVersion:1,content:'离线合成月里程与退订规则。每月1500公里，超里程按方案约定结算。'}}};
const data={...definition.data,loading:false,application,creditReview:{status:'VERIFIED',verificationCurrent:true,canConfirmFinalPlan:true,bandText:'750分及以上',depositRuleText:'押金0元'},actionError:'不应出现在正文的点击错误',actionMessage:'不应出现在正文的点击成功'};
const encode=v=>JSON.stringify(v).replaceAll('<','\\u003c');
const renderer=`function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag);for(const[k,v]of Object.entries(t.attr||{})){if(/^(bind|catch)/.test(k)||['value','checked'].includes(k)||v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}if(t.tag==='wx-checkbox'){const i=document.createElement('input');i.type='checkbox';i.checked=!!t.attr?.checked;e.append(i);}else if(t.tag==='wx-textarea'){const i=document.createElement('textarea');i.value=t.attr?.value||'';e.append(i);}else(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
for(const width of [320,390])for(const mode of ['default','expanded','historical']){
  const display=mode==='expanded'?{...data,showPlanDetails:true,showLessorDetails:true,showRejectForm:true}:mode==='historical'?{...data,showPlanDetails:true,showLessorDetails:true,application:{...application,status:'CONFIRMED'},creditReview:{status:'HISTORICAL',canConfirmFinalPlan:false}}:data;
  const tree=generate('pages/application-detail/index.wxml')(display);
  fs.writeFileSync(path.join(out,`final-plan-${width}-${mode}.html`),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(root,'scripts/preview/preview.css')).href}"><style>#preview-page{padding-bottom:0}</style></head><body class="phone-body"><header id="preview-navigation">申请详情 · 离线排版核验</header><main id="preview-page"></main><script>${renderer};document.getElementById('preview-page').append(render(${encode(tree)}));const styles=(function(global){${compiled.wxss}})({});for(const file of ['app.wxss','pages/application-detail/index.wxss'])styles(file)('',{deviceWidth:${width},allowIllegalSelector:true});</script></body></html>`);
}
const python=`
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path(${JSON.stringify(out)})
results=[]
errors=[]
requests=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    for width in [320,390]:
        page=browser.new_page(viewport={'width':width,'height':844},device_scale_factor=1)
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('request',lambda r:requests.append(r.url) if r.url.startswith(('http:','https:')) else None)
        page.goto((out/f'final-plan-{width}-default.html').as_uri(),wait_until='load')
        text=page.locator('#preview-page').inner_text()
        assert '完整方案与条款' in text
        assert '逐期账单与服务期间' not in text
        assert '¥0.01' in text and '¥0.00' in text and '12 个月' in text
        assert '离线合成出租企业' in text and '2026.11.01' in text and '1500公里' in text
        assert '已核验' in page.locator('.credit-card').inner_text()
        assert '后台' not in page.locator('.confirmation-steps').inner_text()
        assert page.locator('.confirmation-section wx-checkbox input').count()==2
        assert '不应出现在正文' not in text
        assert page.locator('wx-checkbox input').count()==2
        assert page.locator('wx-checkbox input:checked').count()==0
        assert page.locator('.sticky-actions wx-textarea').count()==0
        assert page.locator('.rejection-section wx-textarea').count()==0
        assert page.locator('.sticky-actions wx-button').count()==2
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
        page.screenshot(path=str(out/f'final-plan-{width}-top.png'))
        footer=page.locator('.sticky-actions').bounding_box()
        padding=page.locator('.detail-page').evaluate('(e)=>parseFloat(getComputedStyle(e).paddingBottom)')
        assert footer['height']<padding,(width,footer,padding)
        for index in range(2):
            box=page.locator('wx-checkbox input').nth(index)
            box.evaluate("e=>e.scrollIntoView({block:'center'})")
            rect=box.bounding_box()
            assert rect['y']>48 and rect['y']+rect['height']<footer['y'],(width,index,rect,footer)
            page.screenshot(path=str(out/f'final-plan-{width}-consent-{index+1}.png'))
        page.goto((out/f'final-plan-{width}-expanded.html').as_uri(),wait_until='load')
        text=page.locator('#preview-page').inner_text()
        assert 'USAGE_V1' in text and '逐期账单与服务期间' in text and '逐单商业约定' in text and '离线合成月里程与退订规则' in text
        assert page.locator('.rejection-section wx-textarea').count()==1
        assert page.locator('.sticky-actions wx-textarea').count()==0
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
        page.evaluate('window.scrollTo(0,document.body.scrollHeight)')
        cancel=page.locator('wx-button').filter(has_text='取消申请').bounding_box()
        assert cancel['y']+cancel['height']<=footer['y']+1,(width,cancel,footer)
        page.screenshot(path=str(out/f'final-plan-{width}-bottom.png'))
        results.append({'width':width,'footerHeight':footer['height'],'bottomPadding':padding,'bothConsentsReachable':True,'rejectionInBody':True,'horizontalOverflow':False})
        page.goto((out/f'final-plan-{width}-historical.html').as_uri(),wait_until='load')
        assert page.locator('.credit-card .status-chip').inner_text()=='历史记录'
        assert page.locator('.sticky-actions').count()==0
        assert page.locator('wx-checkbox').count()==0
        assert '逐期账单与服务期间' in page.locator('#preview-page').inner_text()
        assert '本说明为离线排版数据' in page.locator('.lessor-details').inner_text()
        page.close()
    browser.close()
assert not errors,errors
assert not requests,requests
report={'cases':results,'runtimeErrors':errors,'externalRequests':requests,'nativeModal':'Validated by behavior tests; browser layout does not emulate WeChat native modal','productionMutations':False}
(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
`;
const result=spawnSync('python',['-c',python],{encoding:'utf8',maxBuffer:1024*1024});
if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
if(result.error)throw result.error;process.exitCode=result.status||0;
