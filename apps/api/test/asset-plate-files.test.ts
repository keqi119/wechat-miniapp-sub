import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requireAssetFiles} from '../src/files/asset-files';

const actor={id:'operator',role:'OPERATIONS',authVersion:1};
const denied=(error:any)=>error.getStatus?.()===403;
test('plate evidence uses its own parent even before it is bound to a vehicle',async()=>{
 const file={id:'file',name:'牌照备案.pdf',mimeType:'application/pdf',size:32,sha256:'a'.repeat(64),purpose:'asset-plate',adminId:actor.id,customerId:null,fieldTaskId:null};
 const binding={fileId:file.id,kind:'PLATE',licensePlateId:'plate',baasContractId:null,depreciationPolicyId:null,costEntryId:null,observationId:null,valuationReviewId:null,workOrderId:null,workOrderCostId:null,uploadedBy:actor.id,sha256:file.sha256,file};
 const tx:any={adminUser:{findUnique:async()=>({...actor,active:true})},licensePlate:{findUnique:async()=>({id:'plate',revision:1,status:'ACTIVE'})},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{findMany:async()=>[binding]}};
 const result=await requireAssetFiles(tx,actor,{kind:'PLATE' as any,resourceId:'plate',required:true});
 assert.deepEqual(result,[{id:file.id,name:file.name,mimeType:file.mimeType,size:file.size,sha256:file.sha256}]);
 for(const role of ['FINANCE','SUPPORT','FIELD']){
  const staff={...actor,role};tx.adminUser.findUnique=async()=>({...staff,active:true});
  await assert.rejects(requireAssetFiles(tx,staff,{kind:'PLATE' as any,resourceId:'plate'}),denied);
 }
 tx.adminUser.findUnique=async()=>({...actor,active:true});binding.licensePlateId='other';
 await assert.rejects(requireAssetFiles(tx,actor,{kind:'PLATE' as any,resourceId:'plate'}),(error:any)=>error.getResponse?.().error?.code==='ASSET_FILE_INVALID');
});
