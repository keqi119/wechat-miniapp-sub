import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AdminController} from '../src/operations/admin';
test('support sees handover progress without original checklist, attachments or signature payloads',async()=>{
 const row={id:'h',orderId:'o',type:'DELIVERY',status:'CUSTOMER_CONFIRMED',revision:1,customerResponse:'CONFIRM',fileIds:['private-photo'],responseFileIds:['private-response'],checklist:[{note:'PRIVATE-NOTE'}],sourceFileId:'private-paper',signedFileId:'private-signature',signaturePayload:{secret:'PRIVATE'}};
 const controller=new AdminController({handover:{findUnique:async()=>row,findMany:async()=>[row],count:async()=>1}} as any);
 for(const result of [await controller.detail('handovers','h',{admin:{role:'SUPPORT'}}),(await controller.list('handovers',{}, {admin:{role:'SUPPORT'}})).items[0]]){
  assert.equal(result.id,'h');assert.equal(result.status,'CUSTOMER_CONFIRMED');assert.equal(result.customerResponse,'CONFIRM');
  for(const key of ['fileIds','responseFileIds','checklist','sourceFileId','signedFileId','signaturePayload'])assert.equal(result[key],undefined);
 }
 assert.deepEqual(await controller.detail('handovers','h',{admin:{role:'OPERATIONS'}}),row);
});
