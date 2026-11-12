import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {claimSigning,recoverSigning} from '../src/orders/signature-preparation';
import {SignatureService} from '../src/orders/signature.service';
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
test('offline records cannot acquire a signing lease even when a provider is injected',async()=>{
 let reads=0,writes=0;const tx:any={fadadaTask:{findUnique:async()=>{reads++;return null;}},contract:{updateMany:async()=>{writes++;return{count:1};}}};
 await assert.rejects(claimSigning(tx,'SUBSCRIPTION',{id:'c',executionMode:'OFFLINE',status:'DRAFT'}),code('ESIGN_INITIATION_DISABLED'));
 assert.equal(writes,0);assert.equal(reads,0);
});
test('recovery cannot attach an old signature task to an offline contract',async()=>{
 let reads=0;const tx:any={contract:{findFirst:async()=>({id:'c',executionMode:'OFFLINE'})},fadadaTask:{findUnique:async()=>{reads++;return null;}}};
 await assert.rejects(recoverSigning({serial:async(fn:any)=>fn(tx)} as any,'SUBSCRIPTION','c'),code('ESIGN_MODE_MISMATCH'));assert.equal(reads,0);
});
test('a verified electronic signature cannot mutate an offline contract or handover',async()=>{
 for(const handover of [false,true]){let writes=0;const item={id:'i',executionMode:'OFFLINE',documentHash:'h',manifestHash:'h',providerTaskId:'t',status:handover?'CUSTOMER_CONFIRMED':'PENDING',signatureStatus:'PENDING',orderId:'o',customerId:'c'};
 const tx:any={contract:{findUnique:async()=>item,update:async()=>{writes++;}},handover:{findUnique:async()=>item,update:async()=>{writes++;}},order:{findUniqueOrThrow:async()=>({contractMode:'OFFLINE',finalPlanSnapshot:{}})},storedFile:{count:async()=>1},auditLog:{create:async()=>({})}};
 const service=new SignatureService({serial:async(fn:any)=>fn(tx)} as any);await assert.rejects(handover?service.settleHandover('i',{status:'SIGNED',documentHash:'h',signedFileId:'f',taskId:'t'}):service.settleContract('i',{status:'SIGNED',documentHash:'h',signedFileId:'f',taskId:'t'}),code('ESIGN_MODE_MISMATCH'));assert.equal(writes,0);
 }
});
