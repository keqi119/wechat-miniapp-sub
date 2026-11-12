import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

test('cancellation uses server facts, keeps forms on failed reads, scopes revisions, and does not request protected evidence for finance',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const result=await build({configFile:false,root,logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'cancel-fixture',resolveId:id=>id==='virtual:cancel-fixture.tsx'?id:undefined,load:id=>id==='virtual:cancel-fixture.tsx'?`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {OrderOfflineActions} from '/src/order-offline';import {api} from '/src/core';import '/src/style.css';import '/src/ninda-brand.css';import '/src/domain-ui.css';import '/src/order-workspace.css';
 const finance=new URLSearchParams(location.search).has('finance');api.setSession({user:{id:'operator',username:'local',role:finance?'FINANCE':'ADMIN',permissions:finance?['orders.read','bills.read','payments.read','refunds.read']:['*']},csrfToken:'local'});
 function Fixture(){const[id,setId]=useState('o1'),[revision,setRevision]=useState(0),[blocked,setBlocked]=useState(false),[mount,setMount]=useState(0);const p={version:1,orderId:id,orderRevision:3,currentStep:'PAYMENT',steps:['APPLICATION','CONTRACT','PAYMENT','DELIVERY','IN_USE','RETURN','SETTLEMENT'].map(key=>({key,label:key,state:'WAITING',summary:'',checks:[],actions:[]})),blockers:[],attention:[],related:{archives:[],bills:[],tasks:[],handovers:[],settlements:[]}};return <div style={{height:'100dvh',overflow:'auto',padding:20}}><button onClick={()=>setId('o2')}>切到其他订单</button><button onClick={()=>setBlocked(v=>!v)}>切换父读取状态</button><button onClick={()=>setMount(v=>v+1)}>重新进入当前订单</button><OrderOfflineActions key={mount} order={{id,revision:3,status:'AWAITING_PAYMENT',contractMode:'OFFLINE'}} process={p} disabled={blocked} refreshKey={revision} after={async()=>setRevision(v=>v+1)} renderValues={v=><pre>{JSON.stringify(v)}</pre>} onOpenSection={()=>{}}/></div>};createRoot(document.getElementById('root')).render(<Fixture/>);
 `:undefined}],build:{write:false,minify:false,rollupOptions:{input:'virtual:cancel-fixture.tsx',output:{entryFileNames:'fixture.js'}}}});
 const bundle=Array.isArray(result)?result[0]:result;if(!('output' in bundle))throw new Error('Expected bundle');const output=bundle.output;
 const styles=output.filter(f=>f.type==='asset'&&f.fileName.endsWith('.css')).map(f=>`<link rel="stylesheet" href="/${f.fileName}">`).join('');
 const server=createServer((req,res)=>{const a=output.find(f=>'/'+f.fileName===req.url);res.setHeader('Content-Type',a?a.fileName.endsWith('.css')?'text/css':'text/javascript':'text/html');res.end(a?(a.type==='chunk'?a.code:a.source):`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<div id="root"></div><script type="module" src="/fixture.js"></script>`)});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;let browser:Browser|undefined;
 try{try{browser=await chromium.launch({headless:true})}catch(e){if(!(e instanceof Error)||!e.message.includes("Executable doesn't exist"))throw e;browser=await chromium.launch({channel:'chrome',headless:true})}
  const page=await browser.newPage({viewport:{width:1440,height:900}});let failure=false,phase='EVIDENCE',foreign=false,success=false;const writes:{path:string;body:any}[]=[],reads:string[]=[];
  await page.route('**/api/**',route=>{const req=route.request(),path=new URL(req.url()).pathname.slice(4);assert.equal(new URL(req.url()).origin,origin);if(req.method()!=='GET'){writes.push({path,body:req.postDataJSON()});if(success){failure=true;return route.fulfill({json:{id:'o1',status:'CANCELLED',revision:4}})}return route.fulfill({status:409,json:{error:{message:'资料版本已更新'}}})}reads.push(path);
   if(path.endsWith('/cancellation-readiness'))return failure?route.fulfill({status:503,json:{error:{message:'取消条件读取失败'}}}):route.fulfill({json:readiness(foreign?'o1':path.split('/')[3],phase,page.url().includes('finance'))});
   if(path==='/admin/legal-documents')return route.fulfill({json:{items:[{id:'tpl',type:'OFFLINE_TERMINATION',status:'PUBLISHED',title:'终止协议正式模板',version:1,confirmedBy:'approver',confirmedAt:'2026-10-29T00:00:00Z'}]}});
   return route.fulfill({json:{items:[]}});
  });
  await page.goto(origin);
  await expect(page.getByRole('tab',{name:/确认签署情况/})).toBeVisible();
  await expect(page.getByRole('tab',{name:/终止协议/})).toBeDisabled();
  await expect(page.getByRole('tab',{name:/资金核查/})).toBeDisabled();
  await expect(page.getByRole('tab',{name:/确认取消/})).toBeDisabled();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);assert.equal(writes.length,0);
  await page.getByRole('button',{name:'确认已有签署记录',exact:true}).click();
  await page.getByRole('textbox',{name:'确认说明',exact:true}).fill('本人核对实际签署情况');
  failure=true;await page.getByRole('button',{name:'刷新取消条件',exact:true}).click();
  await expect(page.getByText('取消条件读取失败',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'确认确认已有签署记录',exact:true})).toBeDisabled();
  await expect(page.getByRole('textbox',{name:'确认说明',exact:true})).toHaveValue('本人核对实际签署情况');
  failure=false;await page.getByRole('button',{name:'刷新取消条件',exact:true}).click();
  await page.getByRole('button',{name:'确认确认已有签署记录',exact:true}).click();
  await expect(page.getByText('资料版本已更新',{exact:true})).toBeVisible();
  assert.equal(writes[0].path,'/admin/orders/o1/offline-cancellation/review');assert.equal(writes[0].body.revision,1);assert.equal(writes[0].body.reviewId,'r1');assert.equal(writes[0].body.decision,'APPROVED');
  phase='TERMINATION';await page.getByRole('button',{name:'刷新取消条件',exact:true}).click();
  await expect(page.getByRole('tab',{name:/终止协议/})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('tab',{name:/资金核查/})).toBeDisabled();
  await expect(page.getByRole('textbox',{name:'确认说明',exact:true})).toHaveCount(0);
  await page.getByRole('tab',{name:/确认签署情况/}).click();
  await expect(page.getByRole('button',{name:'确认已有签署记录',exact:true})).toHaveCount(0);
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  phase='CONFIRM';await page.getByRole('button',{name:'刷新取消条件',exact:true}).click();
  await expect(page.getByRole('tab',{name:/确认取消/})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:/资金核查/}).click();
  await page.getByRole('button',{name:'重新进入当前订单',exact:true}).click();
  await expect(page.getByRole('tab',{name:/资金核查/})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:/确认取消/}).click();
  await page.getByRole('button',{name:'取消本单',exact:true}).click();
  await page.getByRole('textbox',{name:'取消原因',exact:true}).fill('真实取消原因测试');
  await page.getByRole('button',{name:'切换父读取状态',exact:true}).click();
  await expect(page.getByRole('button',{name:'确认取消本单',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'切换父读取状态',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'取消原因',exact:true})).toHaveValue('真实取消原因测试');
  success=true;await page.getByRole('button',{name:'确认取消本单',exact:true}).click();
  await expect(page.getByText(/取消命令已提交.*最新进度读取失败/)).toBeVisible();
  assert.equal(writes[1].path,'/admin/orders/o1/cancel');assert.equal(writes[1].body.revision,3);assert.equal(writes.length,2);
  failure=false;foreign=true;await page.getByRole('button',{name:'切到其他订单',exact:true}).click();
  await expect(page.getByText('取消条件与当前订单不一致，请重新读取。',{exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'取消原因',exact:true})).toHaveCount(0);
  foreign=false;phase='EVIDENCE';const before=reads.length;await page.goto(origin+'/?finance=1');
  await expect(page.getByText('签署材料由平台运营办理，当前岗位不显示原件。',{exact:true})).toBeVisible();
  assert.equal(reads.slice(before).some(path=>path.includes('/offline-archives')||path.includes('/offline-cancellation')),false);assert.equal(writes.length,2);
  for(const width of [1440,1366,1024,800,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 }finally{await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
function readiness(orderId:string,currentStep:string,finance:boolean){
 const ready=currentStep==='CONFIRM',confirmed=currentStep!=='EVIDENCE';
 const cmd=(key:string,label:string,rev:number,enabled=true)=>({key,label,kind:'OPEN_FORM',enabled,target:{resource:'orders',id:orderId,orderId},expectedRevision:rev,...(!enabled?{disabledReason:'请先完成前序步骤'}:{})});
 const review=finance?null:{id:'r1',orderId,revision:1,status:confirmed?'APPROVED':'SUBMITTED',paperStatus:'SIGNED',reason:'线下合同已签署',submittedBy:'operator',businessSnapshotMatches:true};
 const actions=finance?[]:[cmd('SUBMIT_CANCELLATION_REVIEW','重新确认签署情况',1,!confirmed),cmd('REVIEW_CANCELLATION_EVIDENCE','确认已有签署记录',1,!confirmed),cmd('CANCEL_ORDER','取消本单',3,ready),{key:'CREATE_ARCHIVE',label:'生成本单终止协议',kind:'OPEN_FORM',enabled:confirmed&&!ready,target:{resource:'offline-archives',orderId,section:'TERMINATION'},expectedRevision:0}];
 const keys=['EVIDENCE','TERMINATION','FUNDS','CONFIRM'],index=keys.indexOf(currentStep);
 return {version:1,orderId,orderRevision:3,orderStatus:'AWAITING_PAYMENT',observedAt:'2026-10-30T00:11:00Z',mode:'PRE_DELIVERY_CANCEL',canCancel:ready,currentStep,signing:{paperStatus:'SIGNED',source:'CONFIRMATION'},steps:keys.map((key,i)=>({key,label:{EVIDENCE:'确认签署情况',TERMINATION:'终止协议',FUNDS:'资金核查',CONFIRM:'确认取消'}[key],state:i<index?'DONE':i>index?'WAITING':ready?'CURRENT':'BLOCKED',summary:'按顺序完成当前步骤',checks:[],actions:[]})),blockers:ready?[]:[{code:confirmed?'TERMINATION_REQUIRED':'CANCELLATION_REVIEW_REQUIRED',label:'当前事项待完成',state:'BLOCKED'}],attention:[],actions,related:{review,terminationArchive:null,bills:[],payments:[],refunds:[],tasks:[],changes:[]},effects:['未结束账单作废，合同和收退款记录保留。','车辆解除预留后转为未上架。']};
}
