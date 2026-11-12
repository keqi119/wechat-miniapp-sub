import './legacy-esign-mode';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AdminController} from '../src/operations/admin';
import {SignaturePolicyService} from '../src/esign/enterprise-seal/signature-policy.service';

const code=(expected:string)=>(error:any)=>error.getResponse?.()?.error?.code===expected;
const ownerSnapshot={lessorSnapshot:{ownerId:'synthetic-owner',name:'上海晓浪网络科技有限公司',certificateSerialNo:'SECRET_CERT'},creditBand:'SECRET_CREDIT',ownerDataConsent:{private:'SECRET_CONSENT'}};

test('owner contracts fail at the platform-flow boundary before body, PDF, identity or approval work',async()=>{
 const previous=process.env.PLATFORM_LEGAL_ENTITY_NAME;process.env.PLATFORM_LEGAL_ENTITY_NAME='上海宁达信息科技有限公司';
 let downstream=0;
 try{
  for(const kind of ['SUBSCRIPTION','AMENDMENT'] as const)for(const body of ['', '甲方上海晓浪网络科技有限公司，平台上海宁达信息科技有限公司']){
   const resource={id:'contract',kind,body,status:'DRAFT',order:{finalPlanSnapshot:ownerSnapshot}};
   const db:any={signaturePolicy:{findUnique:async()=>null},adminUser:{findUnique:async()=>null},eSignApproval:{findFirst:async()=>{downstream++;throw Error('APPROVAL_READ_FORBIDDEN');}}};
   const writer:any={resource:async()=>resource,prepare:async()=>{downstream++;throw Error('PDF_FORBIDDEN');}},accounts:any={readiness:async()=>{downstream++;throw Error('IDENTITY_FORBIDDEN');}};
   await assert.rejects(new SignaturePolicyService(db,writer,accounts,{} as any).prepare(kind,'contract','policy','actor'),code('OWNER_CONTRACT_FLOW'));
  }
  assert.equal(downstream,0);
 }finally{if(previous===undefined)delete process.env.PLATFORM_LEGAL_ENTITY_NAME;else process.env.PLATFORM_LEGAL_ENTITY_NAME=previous;}
});

test('platform body validation and owner handover platform workflow keep their existing boundaries',async()=>{
 const previous=process.env.PLATFORM_LEGAL_ENTITY_NAME;process.env.PLATFORM_LEGAL_ENTITY_NAME='上海宁达信息科技有限公司';
 try{
  const db:any={signaturePolicy:{findUnique:async()=>null},adminUser:{findUnique:async()=>null}};
  const check=(kind:any,resource:any)=>new SignaturePolicyService(db,{resource:async()=>resource} as any,{} as any,{} as any).prepare(kind,'contract','policy','actor');
  await assert.rejects(check('SUBSCRIPTION',{body:'甲方上海晓浪网络科技有限公司',order:{finalPlanSnapshot:{}}}),code('LEGAL_ENTITY_MISMATCH'));
  await assert.rejects(check('SUBSCRIPTION',{body:'甲方上海宁达信息科技有限公司',order:{finalPlanSnapshot:{}}}),code('SEAL_REQUESTER_INACTIVE'));
  await assert.rejects(check('HANDOVER',{body:'',order:{finalPlanSnapshot:ownerSnapshot}}),code('SEAL_REQUESTER_INACTIVE'));
 }finally{if(previous===undefined)delete process.env.PLATFORM_LEGAL_ENTITY_NAME;else process.env.PLATFORM_LEGAL_ENTITY_NAME=previous;}
});

function fixture(snapshot:any,hasOrder=true){
 const value:any={id:'contract',kind:'SUBSCRIPTION',status:'DRAFT',body:'SECRET_BODY',sourceFileId:'private-source',signedFileId:'private-archive',...(hasOrder?{order:{finalPlanSnapshot:snapshot}}:{})},calls:any[]=[];
 const db:any={contract:{findUnique:async(args:any)=>{calls.push(args);return value;},findMany:async(args:any)=>{calls.push(args);return[value];},count:async()=>1}};
 return{controller:new AdminController(db),calls};
}

test('admin contract detail and list expose safe explicit owner flow without spreading the order snapshot',async()=>{
 const f=fixture(ownerSnapshot),request={admin:{role:'ADMIN'}};
 const detail:any=await f.controller.detail('contracts','contract',request),list=await f.controller.list('contracts',{},request);
 for(const result of [detail,list.items[0]]){assert.equal(result.signingFlow,'OWNER');assert.equal(result.ownerId,'synthetic-owner');assert.equal(result.ownerName,'上海晓浪网络科技有限公司');assert.doesNotMatch(JSON.stringify(result),/SECRET_CERT|SECRET_CREDIT|SECRET_CONSENT|finalPlanSnapshot|"order"/);}
 assert.equal(detail.body,'SECRET_BODY','existing authorized contract body access remains');
 for(const call of f.calls)assert.deepEqual(call.include,{order:{select:{finalPlanSnapshot:true}}});
 const support:any=await f.controller.detail('contracts','contract',{admin:{role:'SUPPORT'}});assert.equal(support.signingFlow,'OWNER');assert.doesNotMatch(JSON.stringify(support),/SECRET_BODY|private-source|private-archive|SECRET_CERT/);
});

test('contract flow is UNKNOWN on missing or malformed evidence and PLATFORM only on a valid non-owner snapshot',async()=>{
 for(const [snapshot,hasOrder]of [[null,true],[[],true],['bad',true],[{},false],[{},true],[{monthlyFeeAmount:1},true],[{lessorSnapshot:null},true],[{lessorSnapshot:{}},true],[{lessorSnapshot:{ownerId:'synthetic-owner',name:''}},true]] as Array<[any,boolean]>){
  const result:any=await fixture(snapshot,hasOrder).controller.detail('contracts','contract',{admin:{role:'ADMIN'}});assert.equal(result.signingFlow,'UNKNOWN');assert.equal(result.ownerId,null);assert.equal(result.ownerName,null);
 }
 const platform:any=await fixture({monthlyFeeAmount:1,depositAmount:0,months:12,commercialHash:'a'.repeat(64)}).controller.detail('contracts','contract',{admin:{role:'ADMIN'}});assert.equal(platform.signingFlow,'PLATFORM');assert.equal(platform.ownerId,null);assert.equal(platform.ownerName,null);
});
