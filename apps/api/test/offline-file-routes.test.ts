import {fileReadStore} from './file-store-fixture';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { FilesController } from '../src/files/files';
import { projectRoot } from '../src/common/config';

test('generic file URLs cannot bypass the versioned offline archive authorization',async()=>{
 for(const purpose of ['offline-archive','offline-source','insurance','partner-settlement']){
  let streamed=false;
  const file={id:'private-file',name:'contract.pdf',purpose,customerId:'customer-1',mimeType:'application/pdf',storagePath:resolve(projectRoot,'var/uploads/synthetic-contract')};
  const service=new FilesController({storedFile:{findUnique:async()=>file}} as any);
  const response={setHeader(){},sendFile(){streamed=true;}};
  const denied=(e:any)=>e.getResponse?.().error?.code==='ARCHIVE_ROUTE_REQUIRED';
  await assert.rejects(service.adminRead(file.id,{admin:{id:'admin-1',role:'ADMIN'}},response),denied);
  await assert.rejects(service.customerRead(file.id,{customer:{id:'customer-1'}},response),denied);
  assert.equal(streamed,false);
 }
});

test('finance and support cannot download customer qualifications through generic evidence URLs',async()=>{
 for(const role of ['FINANCE','SUPPORT','FIELD'])for(const purpose of ['identity','profile','evidence']){
  const file={id:'identity-evidence',purpose,customerId:null};let streamed=false;
  const service=new FilesController(fileReadStore({storedFile:{findUnique:async()=>file},customerQualificationVersion:{count:async()=>1},paymentReconciliation:{count:async()=>0}}) as any);
  await assert.rejects(service.adminRead(file.id,{admin:{role}},{sendFile(){streamed=true;},setHeader(){}}),(e:any)=>e.getResponse?.().error?.code==='CUSTOMER_FILE_PERMISSION');assert.equal(streamed,false);
 }
});

test('finance and support cannot read partner identity evidence through generic files',async()=>{
 for(const role of ['FINANCE','SUPPORT'])for(const domain of ['partnerIdentityBinding','partnerVerification']){
  const file={id:'private-partner-proof',purpose:'evidence',customerId:null};let streamed=false;
  const zero={count:async()=>0},db:any={storedFile:{findUnique:async()=>file},paymentReconciliation:zero,customerQualificationVersion:zero,partnerIdentityBinding:zero,partnerVerification:zero,partnerVehicleBindingProposal:zero,ownerVehicle:zero,partnerVehicleBindingHistory:zero,offlineCancellationReview:zero,contract:zero,ownerSigningTask:zero};db[domain]={count:async()=>1};db.adminUser={findUnique:async()=>({id:'staff',active:true,role,partnerCapabilities:[]})};
  await assert.rejects(new FilesController(fileReadStore(db) as any).adminRead(file.id,{admin:{role}},{sendFile(){streamed=true;},setHeader(){}}),(e:any)=>e.getResponse?.().error?.code==='FORBIDDEN');assert.equal(streamed,false);
 }
});

test('finance and support cannot retrieve handover originals even under a generic evidence purpose',async()=>{
 for(const role of ['FINANCE','SUPPORT'])for(const source of ['purpose','fieldTask','handover','receipt']){
  let streamed=false;const zero={count:async()=>0};
  const file={id:'handover-original',purpose:source==='purpose'?'handover':'evidence',fieldTaskId:source==='fieldTask'?'field-task':null,customerId:null,name:'evidence.png',mimeType:'image/png',storagePath:resolve(projectRoot,'var/uploads/handover-original')};
  const db:any={storedFile:{findUnique:async()=>file},paymentReconciliation:zero,customerQualificationVersion:zero,partnerIdentityBinding:zero,partnerVerification:zero,partnerVehicleBindingProposal:zero,ownerVehicle:zero,partnerVehicleBindingHistory:zero,offlineCancellationReview:zero,contract:zero,ownerSigningTask:zero,handover:zero,vehicleReceiptEvent:zero};
  if(source==='handover')db.handover={count:async(args:any)=>{assert.deepEqual(args.where.OR,[{fileIds:{has:file.id}},{responseFileIds:{has:file.id}},{signedFileId:file.id}]);return 1;}};
  if(source==='receipt')db.vehicleReceiptEvent={count:async(args:any)=>{assert.deepEqual(args.where,{evidenceFileIds:{has:file.id}});return 1;}};
  await assert.rejects(new FilesController(fileReadStore(db) as any).adminRead(file.id,{admin:{role}},{sendFile(){streamed=true;},setHeader(){}}),(e:any)=>e.getResponse?.().error?.code==='HANDOVER_FILE_PERMISSION');assert.equal(streamed,false);
 }
});

test('authorized operations can read handover originals and finance can still read unrelated fee evidence',async()=>{
 for(const role of ['ADMIN','OPERATIONS','FINANCE']){
  let streamed=false;const zero={count:async()=>0};
  const file={id:'allowed-evidence',purpose:role==='FINANCE'?'evidence':'handover',customerId:null,name:'proof.pdf',mimeType:'application/pdf',storagePath:resolve(projectRoot,'var/uploads/allowed-evidence')};
  const db:any={storedFile:{findUnique:async()=>file},paymentReconciliation:zero,customerQualificationVersion:zero,partnerIdentityBinding:zero,partnerVerification:zero,partnerVehicleBindingProposal:zero,ownerVehicle:zero,partnerVehicleBindingHistory:zero,offlineCancellationReview:zero,contract:zero,ownerSigningTask:zero,handover:zero,vehicleReceiptEvent:zero};
  await new FilesController(fileReadStore(db) as any).adminRead(file.id,{admin:{role}},{sendFile(){streamed=true;},setHeader(){}});assert.equal(streamed,true);
 }
});
