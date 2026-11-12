import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {applicationView,ApplicationsController} from '../src/applications/applications';
import {CreditReviewController,CREDIT_RULE} from '../src/applications/credit-review';
import {snapshotUsagePolicy} from '../src/usage/policy';
import {hash} from '../src/common/data';

const sourceRoot=resolve(__dirname,'../../miniprogram/src');
const miniRequire=createRequire(resolve(sourceRoot,'services/api.js'));
const {createApi}=miniRequire('./api.js');
const config=miniRequire('../config.js');
const termKeys=['vehicleIdentification','permittedUse','conditionDisclosure','customerAddress','mileageCarryRule','excessMileageCalculation','usageCosts','insuranceDetails','maintenanceRule','serviceCoverage','handoverArrangement','earlyTerminationRule','depositRefundRule','otherFees'];
const wire=(value:any)=>JSON.parse(JSON.stringify(value));
type Options={contractMode?:string,final?:(value:any)=>void,verificationRevision?:number,consentStatus?:string,missingConsent?:boolean};

/** Raw persisted records only. The customer DTOs below are produced by real backend code. */
async function fixture(options:Options={}){
 const contractMode=options.contractMode||'OFFLINE',at=new Date('2026-10-27T04:00:00Z');
 const documents=Object.fromEntries(['terms','privacy','credit-verification','usage-policy'].map(type=>[type,{id:`doc-${type}`,type,version:1,title:`合成${type}说明`,content:`已审定的合成${type}正文`,status:'PUBLISHED',confirmedAt:at,confirmedBy:'staff'}]));
 const consent={id:'consent',documentId:documents['credit-verification'].id,version:1,status:options.consentStatus||'ACCEPTED',acceptedAt:at};
 const verification={id:'private-verification',consentId:consent.id,revision:options.verificationRevision??2,ruleVersion:CREDIT_RULE,band:'GE750',verifiedAt:at,verifiedBy:'private-staff'};
 const app:any={id:'application',customerId:'customer',vehicleId:'vehicle',subscriptionPlanId:'plan',revision:3,creditRevision:2,status:'AWAITING_CONFIRMATION',createdAt:at,profile:{name:'合成客户'},order:null,vehicle:{id:'vehicle',title:'合成车辆',brand:'合成',model:'纯电'},subscriptionPlan:{id:'plan',name:'合成套餐',months:12,monthlyFeeAmount:300000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'充电自理',benefits:[],conditions:'合成完整约定'}};
 const tx:any={
  $queryRaw:async()=>[],
  application:{findFirst:async({where}:any)=>where.id===app.id&&(!where.customerId||where.customerId===app.customerId)?app:null},
  legalDocument:{findFirst:async({where}:any)=>documents[where.type]},
  creditConsent:{findFirst:async()=>consent},creditVerification:{findFirst:async()=>verification},
  customerConsent:{count:async({where}:any)=>{assert.equal(where.customerId,app.customerId);return options.missingConsent?0:1;}},
 };
 const notice={id:'sharing',version:1,title:'合成资料提供说明',content:'仅向本单实际出租方提供履约必要资料',contentHash:hash('仅向本单实际出租方提供履约必要资料')};
 const final:any={id:'final-plan',revision:3,contractMode,reviewStatus:'APPROVED',commercialHash:'c'.repeat(64),monthlyFeeAmount:300000,depositAmount:0,months:12,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'充电自理',benefits:[],conditions:'合成完整约定',startDate:new Date('2026-11-01T00:00:00Z'),firstDueDate:new Date('2026-11-01T00:00:00Z'),commercialTerms:Object.fromEntries(termKeys.map(key=>[key,'已逐项明确的合成约定'])),usagePolicyVersion:'USAGE_V1',usagePolicy:await snapshotUsagePolicy(tx),creditVerificationId:verification.id,creditRevision:2,creditRuleVersion:CREDIT_RULE,creditBand:verification.band,priceAdjustmentReason:'仅限工作人员查看的定价依据',lessorSnapshot:{ownerId:'owner',executionMode:contractMode,platformLegalEntityName:'合成平台',subjectType:'INDIVIDUAL',name:'合成出租方',address:'合成联系地址',phone:'00000000000',vehicleId:app.vehicleId,sharingNotice:notice},productSnapshot:{name:'合成套餐',version:1,benefits:[]}};
 options.final?.(final);app.finalPlans=[final];
 const db:any={serial:(work:any)=>work(tx)};
 const creditController=new CreditReviewController(db);
 async function creditDto(){return creditController.customer(app.id,{customer:{id:app.customerId}});}
 return{app,final,tx,db,creditDto};
}

async function setup(options:Options={}){
 const f=await fixture(options),calls:any[]=[],dialogs:any[]=[],errors:any[]=[];
 const memory=new Map([[config.storageKey,{token:'synthetic-session',expiresAt:'2099-01-01T00:00:00Z',customer:{id:f.app.customerId}}]]);
 const wx={getStorageSync:(key:string)=>memory.get(key),setStorageSync:(key:string,value:any)=>memory.set(key,value),removeStorageSync:(key:string)=>memory.delete(key),showToast:()=>{},showModal:(value:any)=>{dialogs.push(value);value.success({confirm:true});}};
 const api=createApi(config,(request:any)=>{
  void Promise.resolve().then(async()=>{
   const route=new URL(request.url).pathname;calls.push({method:request.method,route,data:request.data});
   let value:any;
   if(request.method==='POST'){
    assert.equal(route,'/api/customer/applications/application/confirm');
    f.app.status='FINAL_PLAN_CONFIRMED';f.app.order={id:'order',applicationId:f.app.id,status:options.contractMode==='ESIGN'?'AWAITING_SIGNATURE':'AWAITING_CONTRACT_REVIEW',contractMode:f.final.contractMode};
    value={id:f.app.order.id,status:f.app.order.status};
   }else if(route.endsWith('/credit-review'))value=await f.creditDto();
   else if(route==='/api/customer/applications/application')value=applicationView(f.app);
   else if(route.endsWith('/qualifications')||route.endsWith('/risk-review'))value={status:'APPROVED'};
   else throw new Error(`Unexpected in-memory request: ${request.method} ${route}`);
   request.success({statusCode:request.method==='POST'?201:200,data:wire(value)});
  }).catch(error=>{errors.push(error);request.fail({});});
 },wx);
 // Real page helpers run against the same in-memory WeChat surface.
 const helperModule={exports:{}};
 runInNewContext(readFileSync(resolve(sourceRoot,'utils/page.js'),'utf8'),{module:helperModule,wx,require:(name:string)=>{if(name==='../config')return config;throw new Error(`Unexpected page helper dependency: ${name}`);}});
 let definition:any;
 runInNewContext(readFileSync(resolve(sourceRoot,'pages/application-detail/index.js'),'utf8'),{Page:(value:any)=>definition=value,wx,require:(name:string)=>{
  if(name==='../../services/index')return api;
  if(name==='../../config')return config;
  if(name==='../../utils/page')return helperModule.exports;
  throw new Error(`Unexpected page dependency: ${name}`);
 }});
 const page:any={...definition,data:wire(definition.data),setData(value:any,callback?:()=>void){Object.assign(this.data,value);callback?.();}};
 page.onLoad({id:f.app.id});await page.refresh();assert.deepEqual(errors,[]);assert.equal(page.data.error,'');
 return{...f,page,calls,dialogs,errors,posts:()=>calls.filter(value=>value.method==='POST')};
}

test('real customer application projection contains public confirmation versions and no private credit fields',async()=>{
 const f=await fixture(),dto=wire(applicationView(f.app)),credit=wire(await f.creditDto());
 assert.equal(dto.finalPlan.usagePolicyVersion,'USAGE_V1');assert.equal(dto.finalPlan.creditRevision,2);assert.equal(dto.finalPlan.creditRuleVersion,CREDIT_RULE);
 for(const key of ['creditVerificationId','creditBand','priceAdjustmentReason','reviewStatus'])assert.equal(Object.hasOwn(dto.finalPlan,key),false,key);
 assert.deepEqual(Object.keys(credit.verification).sort(),['current','verifiedAt']);assert.equal(credit.verificationCurrent,true);
 const staff=applicationView(f.app,true).finalPlan!;
 assert.equal(staff.creditVerificationId,f.final.creditVerificationId);assert.equal(staff.creditBand,f.final.creditBand);assert.equal(staff.priceAdjustmentReason,f.final.priceAdjustmentReason);
});

for(const contractMode of ['OFFLINE','ESIGN'])test(`${contractMode} real backend DTO reaches real miniapp confirmation only after both explicit consents`,async()=>{
 const env=await setup({contractMode});const final=env.page.data.application.finalPlan;
 assert.equal(final.usagePolicyComplete,true);assert.equal(final.complete,true);assert.equal(env.page.data.creditReview.canConfirmFinalPlan,true);
 assert.equal(env.page.data.planRead,false);assert.equal(env.page.data.ownerSharingAccepted,false);
 await env.page.confirmPlan();assert.equal(env.posts().length,0);assert.match(env.page.data.actionError,/实际出租方/);
 env.page.onOwnerSharing({detail:{value:['owner']}});await env.page.confirmPlan();assert.equal(env.posts().length,0);assert.match(env.page.data.actionError,/阅读.*最终方案/);
 env.page.onPlanRead({detail:{value:['read']}});await env.page.confirmPlan();assert.deepEqual(env.errors,[]);assert.equal(env.posts().length,1,env.page.data.actionError);
 const sent=env.posts()[0].data;assert.deepEqual(Object.keys(sent).sort(),['commercialHash','ownerSharing','revision']);assert.equal(sent.revision,env.final.revision);assert.equal(sent.commercialHash,env.final.commercialHash);assert.deepEqual(wire(sent.ownerSharing),{accepted:true,lessorHash:final.lessorHash,noticeHash:final.lessorSnapshot.sharingNotice.contentHash});
 assert.equal(env.page.data.application.status,'FINAL_PLAN_CONFIRMED');assert.equal(env.page.data.planRead,false);assert.equal(env.page.data.ownerSharingAccepted,false);
});

test('real customer DTO keeps missing or inconsistent usage snapshots blocked across layers',async()=>{
 for(const change of [(f:any)=>{delete f.usagePolicyVersion;},(f:any)=>{f.usagePolicyVersion='USAGE_V2';},(f:any)=>{f.usagePolicy.hash='';},(f:any)=>{f.usagePolicy.baseAllowanceKm=2000;}]){
  const env=await setup({final:change});assert.equal(env.page.data.application.finalPlan.complete,false);env.page.setData({planRead:true,ownerSharingAccepted:true});await env.page.confirmPlan();assert.equal(env.posts().length,0);assert.ok(env.page.data.actionError);
 }
});

test('real customer DTO rejects missing and changed public credit confirmation versions',async()=>{
 for(const change of [(f:any)=>{delete f.creditRevision;},(f:any)=>{f.creditRevision=1;},(f:any)=>{delete f.creditRuleVersion;},(f:any)=>{f.creditRuleVersion='OTHER_RULE';}]){
  const env=await setup({final:change});env.page.setData({planRead:true,ownerSharingAccepted:true});await env.page.confirmPlan();assert.equal(env.posts().length,0);assert.match(env.page.data.actionError,/信用核验/);
 }
});

test('real backend credit readback blocks withdrawn, stale or missing required consent',async()=>{
 for(const options of [{consentStatus:'WITHDRAWN'},{missingConsent:true},{verificationRevision:1}]){
  const env=await setup(options);assert.equal(env.page.data.creditReview.canConfirmFinalPlan,false);env.page.setData({planRead:true,ownerSharingAccepted:true});await env.page.confirmPlan();assert.equal(env.posts().length,0);assert.match(env.page.data.actionError,/信用核验/);
 }
});

test('unapproved OFFLINE final plans remain absent from the real customer projection and page',async()=>{
 for(const reviewStatus of ['DRAFT','REJECTED']){
  const env=await setup({final:f=>{f.reviewStatus=reviewStatus;}});assert.equal(env.page.data.application.finalPlan,null);assert.deepEqual(env.page.data.application.actions,[]);env.page.setData({planRead:true,ownerSharingAccepted:true});await env.page.confirmPlan();assert.equal(env.posts().length,0);
 }
});

test('actual confirm controller still rejects wrong ownership, stale versions and revoked credit before writes',async()=>{
 const code=(expected:string)=>(error:any)=>error?.getResponse?.()?.error?.code===expected;
 for(const scenario of ['owner','revision','hash','credit','consent']){
  const f=await fixture({contractMode:'ESIGN',...(scenario==='credit'?{consentStatus:'WITHDRAWN'}:{}),...(scenario==='consent'?{missingConsent:true}:{})});
  const controller=new ApplicationsController(f.db),body={revision:scenario==='revision'?1:f.app.revision,commercialHash:scenario==='hash'?'d'.repeat(64):f.final.commercialHash};
  await assert.rejects(controller.confirm(f.app.id,body,{customer:{id:scenario==='owner'?'other-customer':f.app.customerId}}),code(scenario==='owner'?'NOT_FOUND':scenario==='credit'?'CREDIT_REVIEW_REQUIRED':scenario==='consent'?'CONSENT_REQUIRED':'REVISION_CONFLICT'));
  assert.equal(f.app.status,'AWAITING_CONFIRMATION');assert.equal(f.app.order,null);
 }
});
