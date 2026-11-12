import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stageSwapSourceFixture} from './stage-swap-source-fixture';
import {financialContext,serviceFundsRows} from '../src/order-changes/context';

test('current renewal funds select only real active stage obligations and retain global/local period numbers',async()=>{
 const f=await stageSwapSourceFixture();f.order.contractMode='OFFLINE';f.order.effectiveTermsVersionId='renewal-terms';
 const obligations:any[]=f.snap.billingSchedule.map((p:any)=>({id:'current-'+p.sequence,orderId:f.order.id,quoteId:'renewal-quote',serviceStageId:'stage-2',...p,startDate:new Date(p.startDate),endDate:new Date(p.endDate),dueDate:new Date(p.dueDate),amount:p.amount+100,chargeBillId:'current-bill-'+p.sequence,sourceBillIds:[],active:true}));
 const old={...obligations[0],id:'old',serviceStageId:null,sequence:1,stageSequence:null,amount:999,chargeBillId:'old-bill'};const all=[old,...obligations];
 const bills=all.map(o=>({id:o.chargeBillId,orderId:f.order.id,customerId:f.order.customerId,serviceStageId:o.serviceStageId,type:'SUBSCRIPTION',sequence:o.sequence,amount:o.amount,dueDate:o.dueDate,status:'PAID',payments:[{id:'paid-'+o.id,status:'SUCCEEDED',amount:o.amount,refunds:[]}]}));
 let query:any;f.tx.serviceObligation={findMany:async({where}:any)=>{query=where;return all.filter(o=>Object.entries(where).every(([k,v])=>(o as any)[k]===v));}};f.tx.bill={findMany:async()=>bills};
 const result=await financialContext(f.tx,f.order);
 assert.equal(query.serviceStageId,'stage-2');assert.deepEqual(result.rows.map((r:any)=>r.sequence),Array.from({length:12},(_,i)=>i+13));assert.deepEqual(result.rows.map((r:any)=>r.stageSequence),Array.from({length:12},(_,i)=>i+1));assert(result.rows.every((r:any)=>r.amount===250100&&r.netPaidAmount===250100&&!r.sourceBillIds.includes('old-bill')));assert.equal((result as any).serviceStageScope.stageSourceHash,f.stages[1].snapshotHash);assert.equal(f.writes,0);
 all[2].stageSequence=1;await assert.rejects(financialContext(f.tx,f.order),(e:any)=>e.getResponse?.().error?.code==='SWAP_STAGE_SOURCE');
 all[2].stageSequence=2;obligations[0].sourceBillIds=['old-bill'];await assert.rejects(financialContext(f.tx,f.order),(e:any)=>e.getResponse?.().error?.code==='SWAP_STAGE_SOURCE');
});

test('unmarked original service funds retain their exact legacy row shape',()=>{
 const result=serviceFundsRows({startDate:'2026-01-31',months:2,monthlyFeeAmount:100},[],[]);
 assert.deepEqual(result.rows.map(r=>r.sequence),[1,2]);assert(!Object.hasOwn(result,'serviceStageScope'));assert(result.rows.every(r=>!Object.hasOwn(r,'stageSequence')));
});
