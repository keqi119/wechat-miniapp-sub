import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OwnerContractController} from '../src/owner-signing/contract-controller';
import {SignaturesController} from '../src/orders/signatures';
import {DelaySigning} from '../src/order-changes/signing';

test('all owner-facing and operations status queries disable automatic dispatch',async()=>{
 const calls:any[]=[],gateway:any={query:async(id:string,advanceAuto=false)=>{calls.push({id,advanceAuto});return{status:'PENDING'};}};
 const contract={id:'contract',kind:'SUBSCRIPTION',customerId:'customer',orderId:'order',providerTaskId:'task',order:{finalPlanSnapshot:{lessorSnapshot:{ownerId:'owner'}}}};
 const db:any={ownerSigningTask:{count:async()=>1},contract:{findFirst:async()=>contract,findUnique:async()=>contract},order:{findUniqueOrThrow:async()=>contract.order}};
 const owner=new OwnerContractController(db,{} as any,{} as any,{detail:async()=>({id:'task'})} as any,gateway);
 const customer=new SignaturesController(db,{} as any,{} as any,gateway);
 await owner.adminSync('owner','task');await owner.sync({customer:{id:'legal'}},'owner','task');
 await customer.customerSync('contract',{customer:{id:'customer'}});await customer.status('contract',{customer:{id:'customer'}});await customer.sync('contract');
 assert.equal(calls.length,5);assert.ok(calls.every(call=>call.id==='task'&&call.advanceAuto===false),'status queries must never authorize dispatch');
});
test('amendment status queries also explicitly disable dispatch',async()=>{
 let dispatch:any;
 const db:any={orderChange:{findFirst:async()=>({revision:1,activeQuoteId:'quote'})},contract:{findUnique:async()=>({kind:'AMENDMENT',providerTaskId:'task',order:{finalPlanSnapshot:{lessorSnapshot:{ownerId:'owner'}}}})}};
 const service=new DelaySigning(db,{} as any,{} as any,{} as any,undefined,{query:async(_id:string,advanceAuto:boolean)=>{dispatch=advanceAuto;return{status:'PENDING'};}} as any);
 await service.sync('change',{revision:1},'customer');assert.equal(dispatch,false);
});
