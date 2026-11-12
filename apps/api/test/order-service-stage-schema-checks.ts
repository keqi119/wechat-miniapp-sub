import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function verifyServiceStageDateDomain(db:any,stageId:string){
 for(const dates of [ ['2026-10-01','infinity'],['-infinity','2027-10-01'],['infinity','infinity'],['-infinity','-infinity'],['2026-10-01','-infinity'],['10000-01-01','10001-01-01'],['0001-01-01 BC','2027-10-01'] ]){
  let accepted=false;const rollback=new Error('synthetic date probe rollback');
  await assert.rejects(db.$transaction(async(tx:any)=>{try{await tx.$executeRaw`UPDATE "OrderServiceStage" SET "startDate"=${dates[0]}::date,"endDate"=${dates[1]}::date WHERE id=${stageId}`;accepted=true;}catch(error:any){assert.equal(error.meta?.code,'23514');}throw rollback;}),(error:any)=>error===rollback);
  assert.equal(accepted,false,'unsafe stage date accepted: '+dates.join(' / '));
 }
}

/** Structural DB assertions only. Synthetic stages do not substitute for a signed renewal workflow. */
export async function verifyOrderServiceStageSchema(db:any,vehicle:{id:string}){
 const columns=await db.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='OrderServiceStage'`;
 assert.ok(columns.some((v:any)=>v.column_name==='snapshotHash'),'missing OrderServiceStage table');
 const actor=await db.adminUser.create({data:{username:'stage-schema-'+randomUUID(),name:'合成运营',role:'OPERATIONS',passwordHash:'synthetic-not-login'}}),customer=await db.customer.create({data:{mobile:'stage-schema-'+randomUUID()}}),otherCustomer=await db.customer.create({data:{mobile:'stage-other-'+randomUUID()}}),stamp=new Date('2026-10-01T00:00:00Z');
 const product=await db.product.create({data:{name:'合成续期产品',createdBy:actor.id}});
 const version=await db.productVersion.create({data:{productId:product.id,version:1,name:'合成十二个月',months:12,monthlyFeeAmount:20000,mileagePerMonthKm:2000,excessMileagePriceAmount:100,energyDescription:'自付',conditions:'仅结构测试',vehicleIds:[vehicle.id],modelDefinitionIds:[],createdBy:actor.id}});
 const plan=await db.subscriptionPlan.create({data:{vehicleId:vehicle.id,productVersionId:version.id,name:'合成十二个月',months:12,monthlyFeeAmount:20000,mileagePerMonthKm:2000,excessMileagePriceAmount:100,energyDescription:'自付',benefits:[],conditions:'测试'}});
 const listing=await db.vehicleListing.create({data:{vehicleId:vehicle.id,productVersionId:version.id,subscriptionPlanId:plan.id,productSourceHash:'a'.repeat(64),snapshot:{version:1,scope:'synthetic-schema'},createdBy:actor.id}});
 const owner=await db.vehicleOwner.create({data:{name:'合成出租方',address:'合成地址',createdBy:actor.id}});
 const orderFor=async()=>{const application=await db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:{},idempotencyKey:randomUUID(),requestHash:'a'.repeat(64)}});return db.order.create({data:{applicationId:application.id,customerId:customer.id,vehicleId:vehicle.id,finalPlanSnapshot:{original:'unchanged'},confirmedMileageKm:0}});};
 const order=await orderFor(),other=await orderFor();
 const assignmentFor=(orderId:string,closed=false)=>db.vehicleAssignment.create({data:{orderId,customerId:customer.id,vehicleId:vehicle.id,startAt:stamp,startReadingKm:0,...(closed?{status:'CLOSED',endAt:new Date('2026-10-02')}: {})}}),assignment=await assignmentFor(order.id),foreignAssignment=await assignmentFor(other.id,true);
 const initialBase={orderId:order.id,customerId:customer.id,sequence:1,kind:'INITIAL',status:'ACTIVE',vehicleId:vehicle.id,assignmentId:assignment.id,startDate:stamp,endDate:new Date('2027-10-01'),months:12,firstPeriodSequence:1,lastPeriodSequence:12,snapshot:{version:1,original:'unchanged'},snapshotHash:'a'.repeat(64),activatedAt:stamp};
 const initial=await db.orderServiceStage.create({data:initialBase}),foreign=await db.orderServiceStage.create({data:{...initialBase,orderId:other.id,assignmentId:foreignAssignment.id}});
 await verifyServiceStageDateDomain(db,initial.id);
 const changeFor=(orderId:string,status='DRAFT')=>db.orderChange.create({data:{orderId,customerId:customer.id,kind:'SUBSCRIPTION_EXTENSION',status,originalContractId:'synthetic',priorTermsHash:'a'.repeat(64),priorTerms:{},reason:'结构测试',createdBy:actor.id,idempotencyKey:randomUUID(),requestHash:'a'.repeat(64)}});
 const change=await changeFor(order.id),foreignChange=await changeFor(other.id);
 const quoteFor=(changeId:string)=>db.delayQuote.create({data:{changeId,revision:1,commercialHash:'b'.repeat(64),snapshot:{},fundsSnapshot:[],createdBy:actor.id}}),quote=await quoteFor(change.id),foreignQuote=await quoteFor(foreignChange.id);
 const archive=await db.documentArchive.create({data:{kind:'ORDER_AMENDMENT',subjectType:'ORDER_CHANGE_QUOTE',subjectId:quote.id,quoteId:quote.id,orderId:order.id,ownerId:owner.id,createdBy:actor.id}});
 const paper=await db.archiveVersion.create({data:{archiveId:archive.id,version:1,templateId:'synthetic',templateVersion:1,businessSnapshotHash:'b'.repeat(64),partiesSnapshot:[],requiredSigners:[],scopeSnapshot:{}}});
 const renewalBase={...initialBase,sequence:2,kind:'RENEWAL',status:'PREPARED',previousStageId:initial.id,changeId:change.id,quoteId:quote.id,approvedArchiveVersionId:paper.id,ownerId:owner.id,listingId:listing.id,productVersionId:version.id,subscriptionPlanId:plan.id,startDate:new Date('2027-10-01'),endDate:new Date('2028-10-01'),firstPeriodSequence:13,lastPeriodSequence:24,createdBy:actor.id,activatedAt:null};
 const check=(e:any)=>e.code==='P2004'||e.meta?.code==='23514'||/23514/.test(String(e.message));
 for(const patch of [{months:0},{endDate:renewalBase.startDate},{firstPeriodSequence:0},{lastPeriodSequence:23},{snapshotHash:'wrong'},{snapshot:[]},{revision:-1},{ownerId:null},{quoteId:null},{approvedArchiveVersionId:null},{createdBy:null},{status:'ACTIVE'},{status:'SCHEDULED'},{status:'VOIDED'}])await assert.rejects(db.orderServiceStage.create({data:{...renewalBase,...patch}}),check);
 for(const patch of [{customerId:otherCustomer.id},{previousStageId:foreign.id},{assignmentId:foreignAssignment.id},{changeId:foreignChange.id},{quoteId:foreignQuote.id}])await assert.rejects(db.orderServiceStage.create({data:{...renewalBase,...patch}}),(e:any)=>e.code==='P2003');
 const renewal=await db.orderServiceStage.create({data:renewalBase});
 await assert.rejects(db.orderServiceStage.update({where:{id:renewal.id},data:{previousStageId:renewal.id}}),check);
 // A historical source avoids the independent one-active-change index, exercising the stage index itself.
 const secondChange=await changeFor(order.id,'CANCELLED'),secondQuote=await quoteFor(secondChange.id);
 await assert.rejects(db.orderServiceStage.create({data:{...renewalBase,sequence:3,changeId:secondChange.id,quoteId:secondQuote.id}}),(e:any)=>e.code==='P2002');
 await db.orderServiceStage.update({where:{id:renewal.id},data:{status:'SCHEDULED',scheduledAt:stamp,scheduledBy:actor.id}});
 const terms=await db.orderTermsVersion.create({data:{orderId:order.id,quoteId:quote.id,version:1,snapshot:{},hash:'b'.repeat(64),effectiveAt:renewalBase.startDate}});
 const activate={status:'ACTIVE',termsVersionId:terms.id,activatedAt:renewalBase.startDate,activatedBy:actor.id};
 await assert.rejects(db.orderServiceStage.update({where:{id:renewal.id},data:activate}),(e:any)=>e.code==='P2002');
 await db.orderServiceStage.update({where:{id:initial.id},data:{status:'ENDED',endedAt:renewalBase.startDate}});
 await db.orderServiceStage.update({where:{id:renewal.id},data:activate});
 const policy={policyVersion:'SWAP_TERM_V2',sourceHash:'a'.repeat(64),includedCount:2,extraFeeAmount:5000};
 const oldCredit=await db.swapCredit.create({data:{orderId:order.id,source:'FREE',termSequence:1,policySnapshot:policy}});
 await db.swapCredit.create({data:{orderId:order.id,serviceStageId:renewal.id,source:'FREE',termSequence:1,policySnapshot:policy}});
 await assert.rejects(db.swapCredit.create({data:{orderId:order.id,source:'FREE',termSequence:1,policySnapshot:policy}}),(e:any)=>e.code==='P2002');
 await assert.rejects(db.swapCredit.create({data:{orderId:other.id,serviceStageId:renewal.id,source:'FREE',termSequence:2,policySnapshot:policy}}),(e:any)=>e.code==='P2003');
 const account=await db.usageAccount.create({data:{orderId:order.id,customerId:customer.id,policyVersion:'USAGE_V2',startedOn:stamp,pricingSnapshot:{original:1}}});
 const oldPeriod=await db.usagePeriod.create({data:{orderId:order.id,accountId:account.id,sequence:1,startDate:stamp,endDate:new Date('2026-11-01'),effectiveEndDate:new Date('2026-11-01'),status:'SETTLED',pricingSnapshot:{original:1},usedKm:7,excessAmount:9}});
 const period={orderId:order.id,accountId:account.id,sequence:13,serviceStageId:renewal.id,stageSequence:1,startDate:renewalBase.startDate,endDate:new Date('2027-11-01'),effectiveEndDate:new Date('2027-11-01'),pricingSnapshot:{new:1}};
 await db.usagePeriod.create({data:period});await assert.rejects(db.usagePeriod.create({data:{...period,sequence:14,stageSequence:null}}),check);await assert.rejects(db.usagePeriod.create({data:{...period,sequence:14,serviceStageId:foreign.id,stageSequence:2}}),(e:any)=>e.code==='P2003');
 await assert.rejects(db.bill.create({data:{orderId:order.id,customerId:otherCustomer.id,serviceStageId:renewal.id,type:'SUBSCRIPTION',sequence:13,amount:20000,dueDate:renewalBase.startDate}}),(e:any)=>e.code==='P2003');
 assert.deepEqual((await db.order.findUnique({where:{id:order.id}})).finalPlanSnapshot,{original:'unchanged'});
 const preserved=await db.usagePeriod.findUnique({where:{id:oldPeriod.id}});assert.equal(preserved.status,'SETTLED');assert.equal(preserved.usedKm,7);assert.equal(preserved.excessAmount,9);assert.deepEqual(preserved.pricingSnapshot,{original:1});assert.equal(preserved.serviceStageId,null);
 assert.deepEqual((await db.swapCredit.findUnique({where:{id:oldCredit.id}})).policySnapshot,policy);
}
