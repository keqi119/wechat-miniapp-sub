import {EntitlementService} from '../src/entitlements/service';
import {creditView} from '../src/vehicle-changes/credits';
import {resolveV31Sources} from '../src/contract-terms/sources';
import {freezeV31Preparation,resolveV31RenderSnapshot} from '../src/contract-terms/preparation';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {readElectronicSubscriptionReady,activateElectronicSubscription} from '../src/electronic-documents/subscription';
import {finalizeElectronicArchive} from '../src/electronic-documents/archive';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {prepareFixture,syntheticArchive} from './v31-initial-fixture';
import {seedV31Subscription} from './v31-cooperation-fixture';
import {prepareElectronicDocument} from '../src/electronic-documents/prepare';
import {signingParties} from './electronic-fixtures';
import {snapshotUsagePolicy} from '../src/usage/policy';
import {WorkflowsController} from '../src/operations/workflows';
import {BillingService} from '../src/billing/billing';
import {publishBillAutomatically} from '../src/billing/auto-publication';
import {readDeliveryBusinessReady} from '../src/orders/business-gates';
import {canonicalHash} from '../src/customers/types';
import {publishHandoverRecord} from '../src/operations/handover-records';
import {saveFile} from '../src/files/storage';
import {FilesController} from '../src/files/files';
const code=(s:string)=>(e:any)=>e.getResponse?.().error?.code===s;

import {LocalVerifiedPayment} from './seven-module-journey-fixtures';
import {SimpleAgreementService} from '../src/partners/simple-agreements';
import {versionSnapshot} from '../src/products/snapshot';
import {productVersionInclude} from '../src/products/types';
export async function activeSwapFixture(db:any,options:{configureTerms?:(terms:any,customer:any)=>void;preserveFailedOriginalRequest?:boolean;includedCount?:number;targetFee?:number;initialMonths?:number;actualDeliveryAt?:string;configureSources?:(db:any,f:any,target:any)=>Promise<void>}={}){
 process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';const f=await prepareFixture(db);
 if(options.actualDeliveryAt){const original=f.options.resolveParties;f.options.resolveParties=async()=> (await original()).map(p=>({...p,certificate:{...p.certificate,validUntil:'2028-01-01T00:00:00Z'}}));}
 if(options.initialMonths)await db.productVersion.update({where:{id:f.v31Sources.productVersionIds[0]},data:{months:options.initialMonths}});
 if(options.includedCount!==undefined){const p=await db.productVersion.findUniqueOrThrow({where:{id:f.v31Sources.productVersionIds[0]}});await db.productVersion.update({where:{id:p.id},data:{swapPolicy:{...p.swapPolicy as any,includedCount:options.includedCount}}});}
 const model=await db.modelDefinition.create({data:{brand:'合成'+randomUUID(),name:'合成实际换车车型'}});await db.vehicle.update({where:{id:f.vehicle.id},data:{modelDefinitionId:model.id}});
 const target=await db.vehicle.create({data:{brand:'测试',model:'EV',title:'合成换入车',year:2026,city:'上海',mileageKm:10,vin:'SYN'+randomUUID().replaceAll('-','').slice(0,14).toUpperCase(),plateNumber:'合成测试002',status:'PUBLISHED'}});
 await db.vehicle.update({where:{id:target.id},data:{modelDefinitionId:model.id}});
 await db.vehicleAssetProfile.create({data:{vehicleId:target.id,registeredOwnerName:f.owner.name,batteryOwnership:'OWNED',createdBy:f.actor.id,updatedBy:f.actor.id}});
 await db.vehicleConditionAssessment.create({data:{vehicleId:target.id,fireDamage:false,floodDamage:false,structuralDamage:false,assessedBy:f.actor.id,createdBy:f.actor.id}});
 await db.productVersion.update({where:{id:f.v31Sources.productVersionIds[0]},data:{vehicleIds:[f.vehicle.id,target.id]}});
 let targetProductId=f.v31Sources.productVersionIds[0];
 if(options.targetFee){
  const original=await db.productVersion.findUniqueOrThrow({where:{id:targetProductId},include:{items:true}});
  const definition=await db.product.create({data:{name:'合成升级车型产品'+randomUUID(),createdBy:f.actor.id}});
  const upgraded=await db.productVersion.create({data:{productId:definition.id,version:1,status:'PUBLISHED',name:'合成升级产品',months:6,minimumTermMonths:3,configurationVersion:2,baseFeeAmount:options.targetFee-2000,mileageMonthlyFeeAmount:2000,swapPolicy:{version:2,period:'TERM',includedCount:4,extraFeeAmount:50000},monthlyFeeAmount:options.targetFee,mileagePerMonthKm:5000,excessMileagePriceAmount:999,energyDescription:original.energyDescription,conditions:original.conditions,vehicleIds:[target.id],modelDefinitionIds:[],customerBaas:{disposition:'INCLUDED'},createdBy:f.actor.id,items:{create:original.items.map((i:any)=>({kind:i.kind,position:i.position,benefitVersionId:i.benefitVersionId}))}}});
  targetProductId=upgraded.id;f.v31Sources.productVersionIds.push(upgraded.id);f.v31Sources.productDepositRules.push({...f.v31Sources.productDepositRules[0],productVersionId:upgraded.id});
 }
 f.v31Sources.vehicleScopes.push({...f.v31Sources.vehicleScopes[0],vehicleId:target.id});
 if(options.configureSources)await options.configureSources(db,f,target);
 f.draft=await db.serial((tx:any)=>new SimpleAgreementService().save(tx,f.actor,f.owner.id,{agreementId:f.draft.id,status:'DRAFT',title:'合成双车电子合作协议',partnerRateBps:7500,validFrom:'2026-11-01',validUntil:'2027-12-31',revision:f.draft.revision,idempotencyKey:randomUUID(),vehicleIds:[f.vehicle.id,target.id],v31Sources:f.v31Sources}));
 f.input.resourceId=f.draft.latestVersion.id;f.input.revision=f.draft.revision;
 const productRow=await db.productVersion.findUniqueOrThrow({where:{id:targetProductId},include:productVersionInclude});
 const targetPlan=await db.subscriptionPlan.create({data:{vehicleId:target.id,productVersionId:productRow.id,name:productRow.name,months:productRow.months,monthlyFeeAmount:productRow.monthlyFeeAmount,mileagePerMonthKm:productRow.mileagePerMonthKm,excessMileagePriceAmount:productRow.excessMileagePriceAmount,energyDescription:productRow.energyDescription,conditions:productRow.conditions,benefits:[]}});
 const productSnapshot=versionSnapshot(productRow);
 const listing=await db.vehicleListing.create({data:{vehicleId:target.id,subscriptionPlanId:targetPlan.id,productVersionId:productRow.id,status:'PUBLISHED',visible:true,source:'EXPLICIT',snapshot:productSnapshot,productSourceHash:canonicalHash(productSnapshot),createdBy:f.actor.id}});

 await db.legalDocument.update({where:{id:f.template.id},data:{status:'PUBLISHED',confirmedBy:'synthetic',confirmedAt:new Date()}});
 const cooperation=await db.serial(tx=>prepareElectronicDocument(tx,f.input,f.actor.id,f.writer,f.options));await syntheticArchive(db,f,cooperation);
 const sub=await seedV31Subscription(db,f),q=await db.customerQualificationVersion.findFirstOrThrow({where:{customerId:sub.customer.id},orderBy:{revision:'desc'}});
 const risk=await db.applicationRiskReview.create({data:{applicationId:sub.order.applicationId,customerId:sub.customer.id,revision:1,applicationRevision:0,profileHash:q.profileHash,applicationProfileHash:canonicalHash({}),qualificationId:q.id,qualificationRevision:q.revision,finalPlanId:'synthetic-final-plan',planRevision:1,commercialHash:'a'.repeat(64),planInputHash:'a'.repeat(64),vehicleId:f.vehicle.id,vehicleInputHash:'a'.repeat(64),creditConsentId:'synthetic-consent',creditConsentRevision:1,creditConsentVersion:1,creditVerificationId:'synthetic-credit',creditVerificationRevision:1,creditRevision:0,decision:'APPROVED',identityChecked:true,drivingQualificationChecked:true,reviewedBy:f.actor.id,idempotencyKey:randomUUID(),requestHash:'a'.repeat(64)}});
 const usage=await snapshotUsagePolicy(db as any,(sub.order.finalPlanSnapshot as any).productSnapshot);
 const parties=signingParties().map(p=>({...p,subjectId:p.role==='CUSTOMER'?sub.customer.id:p.role==='OWNER'?f.owner.id:f.platform.id,autoAuthority:null,certificate:{...p.certificate,...(options.actualDeliveryAt?{validUntil:'2028-01-01T00:00:00Z'}:{}),checkedAt:new Date().toISOString()}}));
 let terms:any={...sub.order.finalPlanSnapshot as any,months:(sub.order.finalPlanSnapshot as any).productSnapshot.months,startDate:'2026-11-10',firstDueDate:'2026-11-10',depositAmount:10000,usagePolicy:usage,usagePolicyVersion:usage.policyVersion,commercialTerms:{vehicleIdentification:'合成 VIN',customerAddress:'合成联系地址',handoverArrangement:'计划2026-11-10合成测试交付中心'},riskSnapshot:{reviewId:risk.id,applicationId:sub.order.applicationId,customerId:sub.customer.id,qualificationId:q.id,qualificationRevision:q.revision,planId:risk.finalPlanId,planRevision:risk.planRevision,commercialHash:risk.commercialHash},partiesSnapshot:parties.map(p=>({role:p.role,partyId:p.subjectId,subjectType:p.subjectType}))};
 if(options.configureTerms)options.configureTerms(terms,sub.customer);
 terms.commercialHash=canonicalHash(terms);await db.order.update({where:{id:sub.order.id},data:{finalPlanSnapshot:terms}});await db.contract.updateMany({where:{orderId:sub.order.id},data:{documentHash:terms.commercialHash}});
 const prepared=await db.serial(tx=>prepareElectronicDocument(tx,{kind:'SUBSCRIPTION',resourceId:sub.order.id,revision:0,idempotencyKey:randomUUID()},f.actor.id,f.writer,{...f.options,resolveParties:async()=>parties}));await syntheticArchive(db,f,{...prepared,deferArchive:true});const waiting=await readElectronicSubscriptionReady(db,sub.order.id);assert.equal(waiting.ready,false);assert.equal(waiting.legalSigningStatus,'SIGNED');assert.equal((await db.order.findUniqueOrThrow({where:{id:sub.order.id}})).status,'AWAITING_SIGNATURE');await db.serial(async tx=>{await finalizeElectronicArchive(tx,prepared.taskId);await activateElectronicSubscription(tx,await tx.electronicSigningTask.findUnique({where:{id:prepared.taskId}}));});
 await db.serial(tx=>new EntitlementService().freeze(tx,sub.order.id));const pendingRights=await db.entitlement.findMany({where:{orderId:sub.order.id}});assert.equal(pendingRights.length,1);assert.equal(pendingRights[0].status,'PENDING');assert.equal(pendingRights[0].totalQuantity,2);
 const bills=[];for(const type of ['SUBSCRIPTION','DEPOSIT'] as const)bills.push(await db.bill.create({data:{orderId:sub.order.id,customerId:sub.customer.id,type,sequence:type==='DEPOSIT'?0:1,amount:10000,dueDate:new Date('2026-11-10')}}));
 for(const b of bills)assert.equal((await publishBillAutomatically(db,b.id,new Date())).published,true);const future=await db.bill.create({data:{orderId:sub.order.id,customerId:sub.customer.id,type:'SUBSCRIPTION',sequence:2,amount:10000,dueDate:new Date('2026-12-10')}});await assert.rejects(publishBillAutomatically(db,future.id,new Date()),code('ACTUAL_DELIVERY_REQUIRED'));assert.equal(await db.usageAccount.count({where:{orderId:sub.order.id}}),0);
 const payingCustomer=await db.customer.update({where:{id:sub.customer.id},data:{openId:'SYNTHETIC-'+sub.customer.id}}),gateway=new LocalVerifiedPayment(),billing=new BillingService(db,gateway);const payments=[];
 let lateFailedPayment:any=null;if(options.preserveFailedOriginalRequest){const requested=await billing.pay(payingCustomer,bills.find(b=>b.type==='SUBSCRIPTION')!.id,randomUUID());const original=await db.payment.findUniqueOrThrow({where:{id:requested.paymentId}});lateFailedPayment=await billing.settle(original.id,{status:'FAILED',amount:original.amount});}
 for(const b of bills){const paymentKey=randomUUID(),requested=await billing.pay(payingCustomer,b.id,paymentKey);assert.equal((await billing.pay(payingCustomer,b.id,paymentKey)).paymentId,requested.paymentId);const p=await db.payment.findUniqueOrThrow({where:{id:requested.paymentId}});payments.push(p);await billing.settle(p.id,{status:'FAILED',amount:p.amount});await billing.settle(p.id,{status:'SUCCEEDED',amount:p.amount,transactionId:'SYN-'+p.id,succeededAt:new Date().toISOString()});}
 assert.equal((await db.order.findUniqueOrThrow({where:{id:sub.order.id}})).status,'AWAITING_PAYMENT');
 const gate=await readDeliveryBusinessReady(db,sub.order.id);assert.ok(gate.blockers.some(b=>b.code==='INSURANCE_POLICY_MISSING'));
 const photoBytes=Buffer.from('89504e470d0a1a0a0000000049454e44ae426082','hex'),stored=await saveFile({buffer:photoBytes,mimetype:'image/png',originalname:'synthetic.png',size:photoBytes.length} as any),photo=await db.storedFile.create({data:{...stored,purpose:'handover',adminId:f.actor.id}});
 const policy=await db.insurancePolicy.create({data:{insurer:'合成保险',policyNumber:randomUUID(),createdBy:f.actor.id}});
 await db.insurancePolicyVersion.create({data:{policyId:policy.id,version:1,status:'APPROVED',effectiveAt:new Date('2026-11-01'),startAt:new Date('2026-11-01'),endAt:new Date('2027-11-01'),policyholder:'合成',insuredParty:'合成',vehicleIds:[f.vehicle.id],coverageItems:[{code:'THIRD_PARTY',label:'三者',amount:100000000,deductible:'无',terms:'合成保险'}],terms:'合成保险',fileIds:[photo.id],requirementVersionIds:[],reviewChecks:[{vehicleId:f.vehicle.id,fileId:photo.id,confirmed:true,note:'已核对合成原件'}],createdBy:f.actor.id,reviewedBy:f.actor.id,reviewedAt:new Date()}});
 await db.vehicle.update({where:{id:f.vehicle.id},data:{status:'RESERVED',reservedOrderId:sub.order.id}});
 const {OrderProcessController}=await import('../src/orders/order-process.controller');const op=new OrderProcessController(db);let order=await db.order.findUniqueOrThrow({where:{id:sub.order.id}});await op.recheck(order.id,{revision:order.revision,idempotencyKey:randomUUID()},{admin:f.actor});
 const legal=await db.legalDocument.create({data:{type:'ONLINE_HANDOVER_TERMS',version:Math.floor(Math.random()*1000000000)+1,title:'合成线上交接约定',content:'合成线上交接约定',status:'PUBLISHED',confirmedBy:f.actor.id,confirmedAt:new Date(),publishedAt:new Date()}});
 const controller=new WorkflowsController(db,{} as any,{} as any);order=await db.order.findUniqueOrThrow({where:{id:order.id}});
 const handover:any=await controller.handover({orderId:order.id,type:'DELIVERY',actualAt:options.actualDeliveryAt??'2026-11-12T01:00:00Z',readingKm:200,fileIds:[photo.id],checklist:[{label:'conditionChecklist',value:'合成正常'}],revision:order.revision,idempotencyKey:randomUUID()},{admin:f.actor});
 assert.equal(handover.confirmationMode,'ONLINE_RECORD');const pub:any=await controller.publishHandover(handover.id,{admin:f.actor},{revision:handover.revision,idempotencyKey:randomUUID()});
 await new FilesController(db).customerRead(photo.id,{customer:{id:sub.customer.id}},{setHeader:()=>{},send:()=>{}});
 const input={revision:pub.revision,manifestHash:pub.manifestHash,readFileIds:[photo.id],fileIds:[],idempotencyKey:randomUUID(),documentId:pub.onlineRecordSnapshot.documentId,termsVersion:pub.onlineRecordSnapshot.termsVersion,termsHash:pub.onlineRecordSnapshot.termsHash,termsAccepted:true};
 const confirmationAccount=await db.eSignAccount.findUniqueOrThrow({where:{customerId:sub.customer.id}});await db.eSignAccount.update({where:{customerId:sub.customer.id},data:{checkedAt:new Date('2026-01-01')}});await assert.rejects(controller.confirmHandover(pub.id,input,{customer:{id:sub.customer.id}}),code('ELECTRONIC_IDENTITY_REQUIRED'));await db.eSignAccount.update({where:{customerId:sub.customer.id},data:{checkedAt:confirmationAccount.checkedAt}});await controller.confirmHandover(pub.id,input,{customer:{id:sub.customer.id}});await assert.rejects(controller.signHandover(pub.id,{customer:sub.customer}),code('ELECTRONIC_WORKSPACE_REQUIRED'));
 await assert.rejects(controller.complete(pub.id,{admin:f.actor},{revision:pub.revision+1,idempotencyKey:randomUUID()}),code('REVISION_CONFLICT'));
 await db.adminUser.update({where:{id:f.actor.id},data:{active:false}});await assert.rejects(controller.complete(pub.id,{admin:f.actor},{revision:pub.revision,idempotencyKey:randomUUID()}));await db.adminUser.update({where:{id:f.actor.id},data:{active:true}});
 const account=await db.eSignAccount.findUniqueOrThrow({where:{customerId:sub.customer.id}});await db.eSignAccount.update({where:{customerId:sub.customer.id},data:{checkedAt:new Date('2026-01-01')}});await assert.rejects(controller.complete(pub.id,{admin:f.actor},{revision:pub.revision,idempotencyKey:randomUUID()}),code('ELECTRONIC_IDENTITY_REQUIRED'));await db.eSignAccount.update({where:{customerId:sub.customer.id},data:{checkedAt:account.checkedAt}});
 await db.vehicleOwner.update({where:{id:f.owner.id},data:{status:'SUSPENDED'}});await assert.rejects(controller.complete(pub.id,{admin:f.actor},{revision:pub.revision,idempotencyKey:randomUUID()}),code('HANDOVER_NOT_READY'));await db.vehicleOwner.update({where:{id:f.owner.id},data:{status:'VERIFIED'}});
 const command={revision:pub.revision,idempotencyKey:randomUUID()},completed=await controller.complete(pub.id,{admin:f.actor},command);assert.equal(completed.status,'COMPLETED');

 await db.vehicle.update({where:{id:target.id},data:{status:'PUBLISHED'}});
 await db.vehicleListing.update({where:{id:listing.id},data:{status:'PUBLISHED',visible:true}});
 await db.subscriptionPlan.update({where:{id:targetPlan.id},data:{active:true}});
 return{f,sub,target,targetPlan,listing,parties,terms,controller,photo,prepared,completed,model,billing,gateway,payingCustomer,lateFailedPayment};
}

