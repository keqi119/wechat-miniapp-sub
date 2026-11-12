import {test} from 'node:test';
import assert from 'node:assert/strict';
import {termSwapFixture} from './term-swap-fixture';
import {grantSwapCredit} from '../src/swap-purchases/ledger';
import {purchaseAccount} from '../src/swap-purchases/view';
import {SwapPurchasesController} from '../src/swap-purchases/controller';
async function fixture(){const f=termSwapFixture(0),{p,bill,payment}=f.purchase();await grantSwapCredit(f.tx,bill,payment.id,f.now);f.tx.legalDocument={findFirst:async()=>null};const actor={id:'finance',role:'FINANCE',authVersion:1};f.tx.adminUser={findUnique:async()=>({...actor,active:true})};return{...f,p,actor};}
test('only unstaged ESIGN preserves old GET expiry, including first response ledger and EXPIRED filter',async()=>{
 const f=await fixture(),activeBefore=f.writes();await purchaseAccount(f.tx,f.order,f.account,f.now);assert.equal(f.writes(),activeBefore);
 const api=new SwapPurchasesController({serial:f.serial} as any,{} as any,()=>new Date('2029-01-01'));const list=await api.list({status:'EXPIRED',page:1,pageSize:12},{admin:f.actor});assert.equal(list.total,1);assert.equal(list.items[0].status,'EXPIRED');assert.equal(f.p.status,'EXPIRED');assert.equal(f.ledger.filter(l=>l.type==='EXPIRE').length,1);
 const replay=f.writes();assert.equal((await api.list({status:'ACTIVE',page:1,pageSize:12},{admin:f.actor})).total,0);assert.equal(f.writes(),replay);
});
test('OFFLINE and any existing stage, including ENDED or VOIDED, never take the legacy expiry write path',async()=>{
 for(const mode of ['OFFLINE','ENDED','VOIDED']){const f=await fixture();if(mode==='OFFLINE')f.order.contractMode='OFFLINE';else f.tx.orderServiceStage.findMany=async()=>[{id:'history',orderId:f.order.id,status:mode}];const before=f.writes(),api=new SwapPurchasesController({serial:f.serial} as any,{} as any,()=>new Date('2029-01-01'));const view=await api.admin(f.p.id,{admin:f.actor});assert.equal(view.status,'ACTIVE');assert.equal(view.usable,false);assert.equal(f.writes(),before);}
});
