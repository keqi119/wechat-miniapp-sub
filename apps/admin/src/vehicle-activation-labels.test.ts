import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {resources,statusLabel,actionAllowed} from './resources.ts';
import {vehicleLedgerStatus} from './vehicle-ledger-display.ts';

test('vehicle operational activation labels do not imply catalog publication',()=>{
 assert.equal(vehicleLedgerStatus('PUBLISHED'),'已激活');assert.equal(vehicleLedgerStatus('UNPUBLISHED'),'已停用');
 for(const [state,label]of [['DRAFT','草稿'],['RESERVED','已预留'],['IN_USE','用车中']])assert.equal(vehicleLedgerStatus(state),label);
 assert.equal(vehicleLedgerStatus('UNKNOWN'),undefined);assert.equal(statusLabel('PUBLISHED'),'已发布','product versions keep their publication label');
});
test('vehicle action labels change meaning without changing endpoint paths or action state gates',()=>{
 const vehicle=resources.find(r=>r.key==='vehicles')!,activate=vehicle.actions!.find(a=>a.path==='publish')!,deactivate=vehicle.actions!.find(a=>a.path==='unpublish')!;
 assert.equal(activate.label,'激活车辆');assert.equal(deactivate.label,'停用车辆');assert.match(activate.warning!,/不会自动发布商品/);assert.match(deactivate.warning!,/商品上下架/);
 assert.equal(actionAllowed('vehicles',activate,{id:'v',status:'DRAFT'}),true);assert.equal(actionAllowed('vehicles',activate,{id:'v',status:'PUBLISHED'}),false);assert.equal(actionAllowed('vehicles',deactivate,{id:'v',status:'PUBLISHED'}),true);assert.equal(actionAllowed('vehicles',deactivate,{id:'v',status:'PUBLISHED',reservedOrderId:'held'}),false);
});
test('the actual shared status component uses vehicle labels only in vehicle context',async()=>{
 const server=await createServer({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'error',server:{middlewareMode:true},appType:'custom'});
 try{
 const{Status}=await server.ssrLoadModule('/src/ui.tsx');
 const vehicle=renderToStaticMarkup(createElement(Status,{value:'PUBLISHED',resource:'vehicles'})),stopped=renderToStaticMarkup(createElement(Status,{value:'UNPUBLISHED',resource:'vehicles'})),product=renderToStaticMarkup(createElement(Status,{value:'PUBLISHED',resource:'products'}));
 assert.match(vehicle,/已激活/);assert.doesNotMatch(vehicle,/已发布|已上架/);assert.match(stopped,/已停用/);assert.match(product,/已发布/);
 }finally{await server.close();}
});
