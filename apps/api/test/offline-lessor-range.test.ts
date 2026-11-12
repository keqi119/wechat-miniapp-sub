import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildOfflineLessorSnapshot,confirmOfflineLessor,lessorIdentityHash} from '../src/owner-signing/lessor';
import {hash} from '../src/common/data';
function fixture(){
 const owner={id:'owner',name:'合成合作商',status:'ACTIVE',subjectType:'ENTERPRISE',creditCode:'synthetic',address:'合成地址',contactPhone:'13800000000',revision:1};
 const agreement={id:'agreement',ownerId:owner.id,status:'ACTIVE',currentVersionId:'version'},version={id:'version',agreementId:agreement.id,ownerId:owner.id,status:'ACTIVE',vehicleIds:['original-car','target-car'],fileIds:['evidence'],partnerRateBps:6000,contentHash:hash('真实合成合作登记'),validFrom:'2026-01-01',validUntil:'2028-12-31'};
 const legal=[{id:'rental-template',type:'OFFLINE_RENTAL',version:1,content:'已审定合成租赁正文',confirmedBy:'reviewer'},{id:'sharing-notice',type:'owner-data-sharing',version:1,title:'资料告知',content:'向{{lessorName}}提供本单必要资料',confirmedBy:'reviewer'}];
 let reads=0;const tx:any={$queryRaw:async()=>{reads++;return[];},partnerAgreementVehicle:{findUnique:async({where}:any)=>version.vehicleIds.includes(where.vehicleId)?{vehicleId:where.vehicleId,ownerId:owner.id,agreementId:agreement.id,agreementVersionId:version.id,revision:1}:null},partnerAgreement:{findUnique:async()=>agreement},partnerAgreementVersion:{findUnique:async()=>version},vehicleOwner:{findUnique:async()=>owner},vehicle:{findUnique:async({where}:any)=>({id:where.id,title:'合成车辆'})},storedFile:{findMany:async()=>[{id:'evidence',adminId:'operator',customerId:null,purpose:'contract',mimeType:'application/pdf',sha256:hash('原合作文件')}]},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},legalDocument:{findFirst:async({where}:any)=>legal.find(d=>d.type===where.type)}};
 return{tx,owner,agreement,version,legal,reads:()=>reads};
}
test('the actual last inclusive service day supports both vehicles under the same genuine cooperation owner',async()=>{
 const f=fixture();f.version.validUntil='2026-10-31';const range={startDate:'2026-10-31',endDate:'2026-10-31'},before=JSON.stringify({version:f.version,legal:f.legal});
 const original=await buildOfflineLessorSnapshot(f.tx,'original-car',range),target=await buildOfflineLessorSnapshot(f.tx,'target-car',range);
 assert.equal(target.ownerId,original.ownerId);assert.equal(target.ownerId,f.owner.id);assert.equal(target.agreementVersionId,f.version.id);assert.deepEqual(target.leaseRange,range);assert.equal(target.vehicleId,'target-car');assert.equal(JSON.stringify({version:f.version,legal:f.legal}),before);
 const confirmed=await confirmOfflineLessor(f.tx,'customer','target-car',target,{accepted:true,lessorHash:lessorIdentityHash(target),noticeHash:target.sharingNotice.contentHash});assert.equal(confirmed.ownerId,f.owner.id);assert.equal(confirmed.customerId,'customer');
});
test('invalid calendar days and reversed ranges are rejected before reading cooperation data',async()=>{
 for(const range of [{startDate:'2026-11-01',endDate:'2026-10-31'},{startDate:'2026-02-30',endDate:'2026-03-01'},{startDate:'2026-02-28',endDate:'2026-02-30'},{startDate:'2026-02-29',endDate:'2026-03-01'},{startDate:'0000-01-01',endDate:'2026-03-01'},{startDate:'2026-2-01',endDate:'2026-03-01'}]){
  const f=fixture();await assert.rejects(buildOfflineLessorSnapshot(f.tx,'target-car',range),(e:any)=>e.name==='ZodError',JSON.stringify(range));assert.equal(f.reads(),0);
 }
});
test('real leap-day equality and ordinary multi-day dates retain exact lease boundaries',async()=>{
 for(const range of [{startDate:'2028-02-29',endDate:'2028-02-29'},{startDate:'2026-10-30',endDate:'2026-10-31'}]){const f=fixture(),result=await buildOfflineLessorSnapshot(f.tx,'target-car',range);assert.deepEqual(result.leaseRange,range);assert.equal(result.partnerRateBps,6000);}
});
test('a single day still requires genuine same-owner active cooperation that covers that day',async()=>{
 for(const mutate of [(f:any)=>f.version.ownerId='foreign',(f:any)=>f.version.validUntil='2026-10-30',(f:any)=>f.version.validFrom='2026-11-01',(f:any)=>f.version.status='VOIDED']){const f=fixture();mutate(f);await assert.rejects(buildOfflineLessorSnapshot(f.tx,'target-car',{startDate:'2026-10-31',endDate:'2026-10-31'}),(e:any)=>e.getResponse?.().error?.code==='SIMPLE_AGREEMENT_REQUIRED');}
});
