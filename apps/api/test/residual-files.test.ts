import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requireAssetFiles} from '../src/files/asset-files';
import {allowed} from '../src/auth/role-policy';
import {FilesController} from '../src/files/files';
import {fileReadStore} from './file-store-fixture';

const operator={id:'synthetic-operator',role:'OPERATIONS',authVersion:1};
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
function fixture(kind:'RESIDUAL_OBSERVATION'|'VALUATION'){
 const field=kind==='RESIDUAL_OBSERVATION'?'observationId':'valuationReviewId';
 const file={id:'evidence',name:'估值依据.pdf',mimeType:'application/pdf',size:20,sha256:'a'.repeat(64),purpose:kind==='RESIDUAL_OBSERVATION'?'asset-residual-observation':'asset-valuation',adminId:operator.id,customerId:null,fieldTaskId:null};
 const binding:any={kind,fileId:file.id,baasContractId:null,depreciationPolicyId:null,costEntryId:null,licensePlateId:null,observationId:null,valuationReviewId:null,workOrderId:null,workOrderCostId:null,[field]:'parent',uploadedBy:operator.id,sha256:file.sha256,file};
 let staff={...operator,active:true};const tx:any={adminUser:{findUnique:async()=>staff},marketPriceObservation:{findUnique:async()=>({id:'parent',status:'ACTIVE',revision:0})},vehicleValuationReview:{findUnique:async()=>({id:'parent',vehicleId:'vehicle',status:'PENDING',revision:0})},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{findMany:async()=>[binding]}};
 return{tx,binding,file,staff:(role:string)=>{staff={...staff,role};return{...staff};}};
}
test('residual resources expose operations writes and finance reads without FIELD or support access',()=>{
 for(const resource of ['residual-observations','residual-imports','residual-curves','residual-forecasts']){
  assert(allowed('ADMIN',resource,true));assert(allowed('OPERATIONS',resource,true));assert(allowed('FINANCE',resource,false));assert(!allowed('FINANCE',resource,true));
  for(const role of ['FIELD','SUPPORT'])for(const write of [false,true])assert(!allowed(role,resource,write));
 }
 for(const role of ['ADMIN','OPERATIONS','FINANCE'])assert(allowed(role,'vehicle-valuations',true));
 for(const role of ['FIELD','SUPPORT'])assert(!allowed(role,'vehicle-valuations',false));
});
test('sample evidence has no vehicle dependency; valuation evidence retains its exact parent and role',async()=>{
 for(const kind of ['RESIDUAL_OBSERVATION','VALUATION'] as const){
  const f=fixture(kind);const result=await requireAssetFiles(f.tx,operator,{kind:kind as any,resourceId:'parent',required:true});assert.equal(result[0].id,'evidence');assert(!JSON.stringify(result).includes('storagePath'));
  for(const role of ['FINANCE','ADMIN'])assert.equal((await requireAssetFiles(f.tx,f.staff(role),{kind:kind as any,resourceId:'parent'})).length,1);
  for(const role of ['SUPPORT','FIELD'])await assert.rejects(requireAssetFiles(f.tx,f.staff(role),{kind:kind as any,resourceId:'parent'}),code('FORBIDDEN'));
  f.staff('OPERATIONS');f.binding.licensePlateId='other';await assert.rejects(requireAssetFiles(f.tx,operator,{kind:kind as any,resourceId:'parent'}),code('ASSET_FILE_INVALID'));
 }
});
test('unmapped residual private purposes cannot fall back to generic file reads',async()=>{
 for(const purpose of ['asset-residual-observation','asset-valuation']){
  const tx:any=fileReadStore({storedFile:{findUnique:async()=>({id:'file',purpose,adminId:operator.id,customerId:null,mimeType:'application/pdf'})}});
  const controller=new FilesController(tx);(controller as any).stream=()=>({streamed:true});
  await assert.rejects(controller.adminRead('file',{admin:operator},{}),code('ASSET_FILE_ROUTE_REQUIRED'));
 }
});
