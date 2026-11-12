import test from 'node:test';import assert from 'node:assert/strict';
import {receiptPayload,factSettlementPayload} from './electronic-swap-execution-model.ts';
const h={id:'h',type:'SWAP_RETURN',revision:3,manifestHash:'a'.repeat(64),actualAt:'2026-11-10T02:00:00.000Z',readingKm:100,taskVersion:5};
test('receipt command binds published facts and task version; existing receipt is not overwritten',()=>{
 const d:any={id:'c',revision:7,returnHandover:h,actualReceipt:null};assert.deepEqual(receiptPayload(d,{storageLocation:'门店',evidenceFileIds:['f']}),{receivedAt:h.actualAt,readingKm:100,storageLocation:'门店',evidenceFileIds:['f'],revision:0,handoverRevision:3,manifestHash:h.manifestHash,taskVersion:5});
 assert.throws(()=>receiptPayload({...d,actualReceipt:{id:'r'}},{}));assert.throws(()=>receiptPayload({...d,returnHandover:{...h,manifestHash:null}},{}));
});
test('settlement command uses exact receipt and delivery versions, never a browser amount',()=>{
 const d:any={revision:9,actualReceipt:{id:'r'},deliveryHandover:{id:'d'},canPrepareFactSettlement:true};assert.deepEqual(factSettlementPayload(d),{revision:9,receiptEventId:'r',deliveryHandoverId:'d'});assert.throws(()=>factSettlementPayload({...d,canPrepareFactSettlement:false}));
});
