import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OwnerH5Service} from '../src/owner-h5/service';
import {setOwnerLegalRepresentative} from '../src/owner-h5/legal-representative';
import {buildLessorSnapshot} from '../src/owner-signing/lessor';
import {verifySwapOwner} from '../src/owner-signing/followup';

const denied=(error:any)=>error.getStatus?.()===403&&error.getResponse?.().error?.code==='ASSET_FILE_ROUTE_REQUIRED';
function portalStore(mapped:boolean){
 const session:any={id:'session',mode:'PARTNER_READONLY',mobileHash:'synthetic-mobile',scopeSnapshot:[{accessId:'access',ownerId:'owner',accessVersion:1}],expiresAt:new Date(Date.now()+60000)};
 const file={id:'asset-file',name:'内部成本.pdf',mimeType:'application/pdf',size:100},reads:string[]=[];
 const tx:any={
  partnerPortalSession:{findUnique:async()=>session},
  partnerPortalAccess:{findMany:async()=>[{id:'access',ownerId:'owner',accessVersion:1,mobileHash:session.mobileHash,status:'ENABLED',bindingMethod:'REVIEWED',reviewedBy:'reviewer',reviewedAt:new Date()}]},
  partnerAgreement:{findMany:async()=>[{id:'agreement',ownerId:'owner',status:'STOPPED',currentVersionId:'version'}]},
  partnerAgreementVersion:{findUnique:async()=>({id:'version',agreementId:'agreement',ownerId:'owner',status:'ACTIVE',version:1,fileIds:[file.id],vehicleIds:[],title:'历史合作协议'})},
  partnerAgreementVehicle:{findMany:async()=>[]},
  storedFile:{findMany:async()=>{reads.push('metadata');return[file];}},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>mapped?1:0},
  serial:async(fn:any)=>fn(tx),
 };
 return{tx,session,file,reads};
}
test('stopped cooperation agreements cannot expose mapped asset filenames without any current vehicle binding',async()=>{
 const {tx,session,reads}=portalStore(true);
 await assert.rejects(new OwnerH5Service(tx,{}as any,{}as any,{}as any,{}as any).portalAgreements(session,'owner'),denied);
 assert.deepEqual(reads,[]);
});
test('ordinary stopped agreement files remain available to the explicitly authorized portal session',async()=>{
 const {tx,session,file}=portalStore(false);
 const result=await new OwnerH5Service(tx,{}as any,{}as any,{}as any,{}as any).portalAgreements(session,'owner');
 assert.deepEqual(result.items[0].files,[file]);assert.equal(result.items[0].vehicleCount,0);
});
test('legal representative registration cannot adopt an asset file even with a corrupted evidence purpose',async()=>{
 const reads:string[]=[],tx:any={
  adminUser:{findUnique:async()=>({id:'operator',role:'OPERATIONS',active:true})},
  vehicleOwner:{findUnique:async()=>({id:'owner',subjectType:'COMPANY',status:'DRAFT',revision:0}),updateMany:async()=>{reads.push('mutation');return{count:1};}},
  vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>1},storedFile:{findUnique:async()=>{reads.push('metadata');return{id:'asset-file',adminId:'operator',customerId:null,purpose:'evidence',mimeType:'application/pdf',sha256:'a'.repeat(64)};}},
  ownerLegalRepresentative:{create:async()=>({})},ownerESignAccount:{updateMany:async()=>({count:0})},ownerAutoAuthority:{updateMany:async()=>({count:0})},auditLog:{create:async()=>({})},
  serial:async(fn:any)=>fn(tx),
 };
 await assert.rejects(setOwnerLegalRepresentative(tx,'operator','owner',{name:'合成法人',mobile:'13800000000',evidenceFileId:'asset-file',revision:0,accepted:true}),denied);
 assert.deepEqual(reads,[]);
});
test('legacy lessor snapshots reject an approved binding whose evidence is a mapped asset',async()=>{
 const prior=process.env.OWNER_CONTRACTS_ENABLED;process.env.OWNER_CONTRACTS_ENABLED='true';
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>1},ownerVehicle:{findUnique:async()=>({id:'binding',status:'APPROVED',reviewedAt:new Date(),reviewedBy:'reviewer',evidenceFileId:'asset-file',owner:{status:'VERIFIED',address:'合成地址',contactPhone:'13800000000',esignAccount:{realNameStatus:'VERIFIED',certStatus:'BOUND',certSerialNo:'synthetic',checkedAt:new Date(),providerCustomerId:'provider'},seals:[{providerCustomerId:'provider'}]}})},storedFile:{findUnique:async()=>({sha256:'a'.repeat(64)})},legalDocument:{findFirst:async()=>({id:'doc',version:1,confirmedBy:'reviewer',content:'合成已批准文案'})}};
 try{await assert.rejects(buildLessorSnapshot(tx,'vehicle'),denied);}finally{if(prior===undefined)delete process.env.OWNER_CONTRACTS_ENABLED;else process.env.OWNER_CONTRACTS_ENABLED=prior;}
});
test('legacy replacement vehicle evidence cannot use a mapped asset even with an evidence purpose',async()=>{
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>1},ownerVehicle:{findUnique:async()=>({id:'binding',ownerId:'owner',status:'APPROVED',reviewedAt:new Date(),reviewedBy:'reviewer',evidenceFileId:'asset-file',revision:1})},storedFile:{findUnique:async()=>({purpose:'evidence',sha256:'a'.repeat(64)})}};
 await assert.rejects(verifySwapOwner(tx,{finalPlanSnapshot:{lessorSnapshot:{ownerId:'owner'}}},'vehicle'),denied);
});
