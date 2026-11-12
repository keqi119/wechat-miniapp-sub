import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness} from './seven-module-journey-fixtures';
import {persistedStageSwap} from './stage-swap-db-fixture';
import {canonicalHash} from '../src/customers/types';
import {hash} from '../src/common/data';
import {readSwapStageScope} from '../src/vehicle-changes/stage-source';
import {AdminController} from '../src/operations/admin';


async function delivery(h:JourneyHarness,a:any,type='DELIVERY'){
 return h.db.handover.create({data:{orderId:a.orderId,customerId:a.customerId,vehicleId:a.vehicleId,assignmentId:a.id,changeId:a.changeId,type,status:'COMPLETED',readingKm:a.startReadingKm,actualAt:a.startAt,completedAt:new Date(a.startAt.getTime()+3600000),fileIds:[],checklist:{synthetic:true},manifestHash:'a'.repeat(64)}});
}

test('guarded order list searches actual car/customer/order before pagination and projects frozen terms',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();try{
 await h.start();const tag='List'+h.prefix;
 const customer=await h.db.customer.create({data:{name:tag+' Alice',mobile:randomUUID(),profile:{secret:'identity'}}});
 const cars=await Promise.all(['Original','Current','Pending'].map(model=>h.db.vehicle.create({data:{title:tag+model,brand:'宁达',model,year:2026,city:'上海',mileageKm:0,vin:tag+model+'VIN',plateNumber:tag+model+'Plate'}})));
 const plan=await h.db.subscriptionPlan.create({data:{vehicleId:cars[0].id,name:'Mutable price',months:12,monthlyFeeAmount:999999,mileagePerMonthKm:1000,excessMileagePriceAmount:10,energyDescription:'自付',benefits:[],conditions:''}});
 const orders=[];for(let i=0;i<3;i++){
 const app=await h.db.application.create({data:{customerId:customer.id,vehicleId:cars[0].id,subscriptionPlanId:plan.id,profile:{},consents:[],idempotencyKey:randomUUID(),requestHash:'synthetic'}});
 orders.push(await h.db.order.create({data:{id:tag+'Order'+i,applicationId:app.id,customerId:customer.id,vehicleId:cars[0].id,confirmedMileageKm:0,status:i===2?'COMPLETED':'ACTIVE',createdAt:new Date('2026-10-01'),finalPlanSnapshot:{productSnapshot:{name:'Frozen product'},months:6,monthlyFeeAmount:123456,profile:{secret:true}}}}));
 }
 const first=orders[0],ended=orders[2];
 for(const order of [first,ended]){
 const assignment=await h.db.vehicleAssignment.create({data:{orderId:order.id,customerId:customer.id,vehicleId:cars[1].id,startAt:new Date('2026-10-01'),startReadingKm:0,...(order===ended?{status:'CLOSED',endAt:new Date('2026-10-30')}: {})}});
 const delivered=await delivery(h,assignment);
 await h.db.vehicleAssignment.update({where:{id:assignment.id},data:{deliveryHandoverId:delivered.id}});
 if(order===first)await h.db.order.update({where:{id:order.id},data:{currentAssignmentId:assignment.id,vehicleId:assignment.vehicleId}});
 // Newer unrelated/pending evidence must never win the vehicle selection.
 await h.db.vehicleAssignment.create({data:{orderId:order.id,customerId:customer.id,vehicleId:cars[2].id,startAt:new Date('2026-11-01'),endAt:new Date('2026-11-02'),status:'CLOSED',startReadingKm:0}});
 }
 const path=(keyword:string,page=1)=>'/admin/orders?'+new URLSearchParams({keyword,page:String(page),pageSize:'1'});
 const result=await h.get(path(tag.toLowerCase()+'currentvin'));assert.equal(result.total,2);assert.equal(result.items[0].id,ended.id);assert.equal(result.items[0].vehicle.vin,cars[1].vin);
 assert.equal((await h.get(path(tag+'CurrentPlate'))).total,2);
 assert.equal((await h.get(path(tag+'Pending'))).total,0);
 const names=await h.get(path(tag.toLowerCase()+' alice'));assert.equal(names.total,3);assert.equal(names.items[0].id,ended.id);assert.equal((await h.get(path(tag+' alice',2))).items[0].id,orders[1].id);
 const row=(await h.get(path(first.id.toUpperCase()))).items[0];assert.equal(row.productName,'Frozen product');assert.equal(row.months,6);assert.equal(row.monthlyFeeAmount,123456);assert.equal(row.vehicle.model,'Current');assert.deepEqual(Object.keys(row.customer).sort(),['id','name']);assert.equal('finalPlanSnapshot' in row,false);
 assert.equal((await h.get(path(tag+'Order1'))).items[0].vehicle,null,'active missing assignment is pending verification');
 // Effective swap freezes the replacement product; a newer future renewal cannot replace it.
 const change=await h.db.orderChange.create({data:{orderId:first.id,customerId:customer.id,kind:'VEHICLE_CHANGE',priorTermsHash:'synthetic',priorTerms:{},originalContractId:randomUUID(),reason:'fixture',createdBy:h.maker.id,idempotencyKey:randomUUID(),requestHash:'synthetic'}});
 const quote=await h.db.delayQuote.create({data:{changeId:change.id,revision:1,commercialHash:'synthetic',snapshot:{},fundsSnapshot:{},createdBy:h.maker.id}});
 const terms=await h.db.orderTermsVersion.create({data:{orderId:first.id,quoteId:quote.id,version:1,hash:'synthetic',effectiveAt:new Date('2026-10-02'),snapshot:{productSnapshot:{name:'Original frozen'},currentVehicleProductSnapshot:{name:'Current frozen'},months:3,monthlyFeeAmount:234567}}});
 await h.db.order.update({where:{id:first.id},data:{effectiveTermsVersionId:terms.id}});
 const active=await h.db.vehicleAssignment.findFirstOrThrow({where:{orderId:first.id,status:'ACTIVE'}}),proof=await h.db.handover.findUniqueOrThrow({where:{id:active.deliveryHandoverId!}});
 for(const skew of [60000,300000,300001,600001]){
  const completedAt=new Date(active.startAt.getTime()-skew);await h.db.handover.update({where:{id:proof.id},data:{completedAt}});
  const actual=(await h.get(path(first.id))).items[0],accepted=skew<=300000;
  assert.equal(actual.vehicle?.id??null,accepted?active.vehicleId:null,'delivery clock skew '+skew);
  assert.equal((await h.get(path(tag+'CurrentVIN'))).total,accepted?2:1,'search shares bounded delivery skew '+skew);
  const retained=await h.db.handover.findUniqueOrThrow({where:{id:proof.id}});assert.equal(retained.completedAt?.getTime(),completedAt.getTime());assert.equal(retained.actualAt?.getTime(),active.startAt.getTime());
 }
 await h.db.handover.update({where:{id:proof.id},data:{completedAt:proof.completedAt}});
 for(const patch of [{status:'DRAFT'},{status:'SUPERSEDED'},{customerId:randomUUID()},{vehicleId:cars[0].id},{assignmentId:randomUUID()},{orderId:ended.id},{actualAt:new Date('2026-10-02')},{completedAt:null}]){
  await h.db.handover.update({where:{id:proof.id},data:patch as any});assert.equal((await h.get(path(first.id))).items[0].vehicle,null,'invalid current delivery '+JSON.stringify(patch));
  assert.equal((await h.get(path(tag+'CurrentVIN'))).total,1,'corrupt car excluded from search');
  await h.db.handover.update({where:{id:proof.id},data:{status:proof.status,customerId:proof.customerId,vehicleId:proof.vehicleId,assignmentId:proof.assignmentId,orderId:proof.orderId,actualAt:proof.actualAt,completedAt:proof.completedAt}});
 }
 await h.db.vehicleAssignment.update({where:{id:active.id},data:{deliveryHandoverId:randomUUID()}});assert.equal((await h.get(path(first.id))).items[0].vehicle,null,'nonexistent current proof');
 await h.db.vehicleAssignment.update({where:{id:active.id},data:{deliveryHandoverId:proof.id}});
 const invalid=await h.db.vehicleAssignment.findFirstOrThrow({where:{orderId:ended.id,vehicleId:cars[2].id}});
 const invalidProof=await delivery(h,invalid),foreignProof=await delivery(h,{...invalid,orderId:first.id});
 for(const patch of [{deliveryHandoverId:randomUUID()},{deliveryHandoverId:foreignProof.id},{deliveryHandoverId:invalidProof.id}]){
  if(patch.deliveryHandoverId===invalidProof.id)await h.db.handover.update({where:{id:invalidProof.id},data:{status:'DRAFT'}});
  await h.db.vehicleAssignment.update({where:{id:invalid.id},data:patch});assert.equal((await h.get(path(ended.id))).items[0].vehicle.id,cars[1].id,'invalid newer ended proof ignored');
 }
 await h.db.handover.update({where:{id:invalidProof.id},data:{status:'SUPERSEDED'}});assert.equal((await h.get(path(ended.id))).items[0].vehicle.id,cars[1].id);
 await h.db.order.update({where:{id:first.id},data:{currentAssignmentId:randomUUID()}});
 assert.equal((await h.get(path(first.id))).items[0].vehicle,null);
 assert.equal((await h.get(path(tag+'CurrentVIN'))).total,1,'search shares corrupt-binding pending projection');
 for(const role of [h.finance,h.support]){const safe=(await h.get(path(first.id),role)).items[0];assert.equal('finalPlanSnapshot' in safe,false);assert.equal('mobile' in safe.customer,false);}
 for(const keyword of ["' OR true --",'%','_'])assert.equal((await h.get(path(keyword))).total,0,'literal parameterized search');
 for(const q of ['page=1.5','page=0','pageSize=101','status=BOGUS','keyword=a%00b','page=10001'])await h.reject('/admin/orders?'+q,undefined,h.maker,'VALIDATION');
 await h.reject('/admin/orders',undefined,h.field,'FORBIDDEN');
 await h.db.adminUser.update({where:{id:h.maker.id},data:{authVersion:{increment:1}}});
 await assert.rejects(()=>new AdminController(h.db).list('orders',{}, {admin:{id:h.maker.id,role:'OPERATIONS',authVersion:0}}));
 assert.equal(h.externalCalls+h.esignCalls+h.payment.providerCalls,0);
 }finally{await h.close();}
});





test('active renewal keeps completed swap terms through applied lineage and ignores future scheduled renewal',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();try{
 await h.start();const f=await persistedStageSwap(h.db,h.maker.id);
 // Move the existing fully validated synthetic renewal calendar one year back, into the current service year.
 const shift=(v:any):any=>typeof v==='string'?v.replace(/^202([678])-/,(_,n)=>'202'+(Number(n)-1)+'-'):Array.isArray(v)?v.map(shift):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,shift(x)])):v;
 const oldOrder=await h.db.order.findUniqueOrThrow({where:{id:f.order.id}}),original=shift(oldOrder.finalPlanSnapshot);
 await h.db.order.update({where:{id:f.order.id},data:{contractMode:'OFFLINE',finalPlanSnapshot:original,effectiveTermsVersionId:f.ids['renewal-terms']}});
 for(const stage of await h.db.orderServiceStage.findMany({where:{orderId:f.order.id}})){
  const snapshot=shift(stage.snapshot);snapshot.source.originalTermsHash=canonicalHash(original);if(stage.kind==='INITIAL')snapshot.source.agreement.priorTermsHash=canonicalHash(original);
  await h.db.orderServiceStage.update({where:{id:stage.id},data:{snapshot,snapshotHash:canonicalHash(snapshot),startDate:new Date(snapshot.period.startDate),endDate:new Date(snapshot.period.endDate)}});
  if(stage.kind==='RENEWAL')await h.db.orderTermsVersion.update({where:{id:stage.termsVersionId!},data:{snapshot:snapshot.termsSnapshot,effectiveAt:new Date(snapshot.period.startDate)}});
 }
 const old=await h.db.vehicleAssignment.update({where:{id:f.ids['current-assignment']},data:{startAt:new Date('2026-01-01')}}),oldProof=await delivery(h,old);
 await h.db.vehicleAssignment.update({where:{id:old.id},data:{deliveryHandoverId:oldProof.id}});
 const renewal=await h.db.orderTermsVersion.findUniqueOrThrow({where:{id:f.ids['renewal-terms']}}),renewalSnapshot=renewal.snapshot as any;
 const path='/admin/orders?'+new URLSearchParams({keyword:f.order.id});
 assert.equal((await h.get(path)).items[0].monthlyFeeAmount,250000);
 const order=await h.db.order.findUniqueOrThrow({where:{id:f.order.id}}),scope=await readSwapStageScope(h.db,order,renewalSnapshot,{historical:true});
 const car=await h.db.vehicle.create({data:{title:'换入实际车',brand:'合成',model:'SWAP',year:2026,city:'上海',mileageKm:20,vin:'SWAPVIN'+h.prefix,plateNumber:'沪换'+h.prefix}});
 const frozenProduct={...renewalSnapshot.productSnapshot,name:'换入冻结产品'},stamp=new Date('2026-06-01T03:00:00Z');
 const change=await h.db.orderChange.create({data:{orderId:order.id,customerId:order.customerId,kind:'VEHICLE_CHANGE',status:'APPLIED',originalArchiveVersionId:f.ids['rental-version'],priorTermsVersionId:renewal.id,priorTerms:renewalSnapshot,priorTermsHash:hash(renewalSnapshot),targetVehicleId:car.id,originalContractId:'synthetic',reason:'合成已完成换车',createdBy:h.maker.id,idempotencyKey:randomUUID(),requestHash:'a'.repeat(64),actualCompletedAt:stamp,appliedAt:stamp}});
 const quote=await h.db.delayQuote.create({data:{changeId:change.id,status:'CONFIRMED',revision:1,commercialHash:'c'.repeat(64),snapshot:{targetSource:{product:frozenProduct},newMonthlyFeeAmount:275000,serviceStageScope:scope},fundsSnapshot:{},createdBy:h.maker.id}});
 await h.db.vehicleAssignment.update({where:{id:old.id},data:{status:'CLOSED',endAt:stamp}});
 const assigned=await h.db.vehicleAssignment.create({data:{orderId:order.id,customerId:order.customerId,vehicleId:car.id,changeId:change.id,startAt:stamp,startReadingKm:20}}),handover=await delivery(h,assigned,'SWAP_DELIVERY');
 await h.db.vehicleAssignment.update({where:{id:assigned.id},data:{deliveryHandoverId:handover.id}});await h.db.orderChange.update({where:{id:change.id},data:{activeQuoteId:quote.id,deliveryHandoverId:handover.id}});
 const snapshot={...renewalSnapshot,vehicleId:car.id,currentVehicleProductSnapshot:frozenProduct,monthlyFeeAmount:275000,commercialHash:quote.commercialHash};
 const swap=await h.db.orderTermsVersion.create({data:{orderId:order.id,quoteId:quote.id,version:3,snapshot,hash:quote.commercialHash,effectiveAt:stamp}});
 await h.db.order.update({where:{id:order.id},data:{effectiveTermsVersionId:swap.id,currentAssignmentId:assigned.id,vehicleId:car.id}});
 const row=(await h.get(path)).items[0];assert.equal(row.vehicle.id,car.id);assert.equal(row.productName,'换入冻结产品');assert.equal(row.months,12);assert.equal(row.monthlyFeeAmount,275000,'valid later swap version must not equal original activation version');
 // Preserve a separately scheduled next renewal, with its own quote and immutable source, after the swap.
 const active=await h.db.orderServiceStage.findUniqueOrThrow({where:{id:f.ids['stage-2']}});
 const futureChange=await h.db.orderChange.create({data:{orderId:order.id,customerId:order.customerId,kind:'SUBSCRIPTION_EXTENSION',priorTerms:snapshot,priorTermsHash:hash(snapshot),priorTermsVersionId:swap.id,originalArchiveVersionId:f.ids['rental-version'],originalContractId:'synthetic',reason:'future',createdBy:h.maker.id,idempotencyKey:randomUUID(),requestHash:'synthetic'}});
 const futureQuote=await h.db.delayQuote.create({data:{changeId:futureChange.id,revision:1,commercialHash:'d'.repeat(64),snapshot:{},fundsSnapshot:{},createdBy:h.maker.id}});
 const futureArchive=await h.db.documentArchive.create({data:{kind:'ORDER_AMENDMENT',subjectType:'ORDER_CHANGE_QUOTE',subjectId:futureQuote.id,quoteId:futureQuote.id,orderId:order.id,ownerId:active.ownerId,createdBy:h.maker.id}}),paper=await h.db.archiveVersion.create({data:{archiveId:futureArchive.id,version:1,templateId:'synthetic',templateVersion:1,businessSnapshotHash:futureQuote.commercialHash,partiesSnapshot:[],requiredSigners:[],scopeSnapshot:{}}});
 await h.db.orderServiceStage.create({data:{orderId:order.id,customerId:order.customerId,sequence:3,kind:'RENEWAL',status:'SCHEDULED',previousStageId:active.id,changeId:futureChange.id,quoteId:futureQuote.id,approvedArchiveVersionId:paper.id,ownerId:active.ownerId,listingId:active.listingId,productVersionId:active.productVersionId,subscriptionPlanId:active.subscriptionPlanId,vehicleId:car.id,assignmentId:assigned.id,startDate:new Date('2027-01-31'),endDate:new Date('2028-01-31'),months:12,firstPeriodSequence:25,lastPeriodSequence:36,snapshot:{termsSnapshot:{monthlyFeeAmount:999999,name:'future'}},snapshotHash:'d'.repeat(64),createdBy:h.maker.id,scheduledAt:new Date(),scheduledBy:h.maker.id}});
 assert.equal((await h.get(path)).items[0].monthlyFeeAmount,275000);
 for(const skew of [60000,300000,300001,600001]){
  const completedAt=new Date(stamp.getTime()-skew);await h.db.handover.update({where:{id:handover.id},data:{completedAt}});
  const actual=(await h.get(path)).items[0],accepted=skew<=300000;
  assert.equal(actual.vehicle?.id??null,accepted?car.id:null,'swap display clock skew '+skew);
  assert.equal(actual.productName,accepted?'换入冻结产品':null,'renewal swap product clock skew '+skew);
  assert.equal(actual.monthlyFeeAmount,accepted?275000:null,'renewal swap fee clock skew '+skew);
  assert.equal((await h.get('/admin/orders?'+new URLSearchParams({keyword:car.vin!}))).total,accepted?1:0,'swap search clock skew '+skew);
  const retained=await h.db.handover.findUniqueOrThrow({where:{id:handover.id}});assert.equal(retained.completedAt?.getTime(),completedAt.getTime());assert.equal(retained.actualAt?.getTime(),stamp.getTime());
 }
 await h.db.handover.update({where:{id:handover.id},data:{completedAt:handover.completedAt}});
 // Historical display uses immutable ended-stage sources, without current signer/partner readiness.
 await h.db.orderServiceStage.update({where:{id:active.id},data:{status:'ENDED',endedAt:new Date('2026-10-01')}});
 await h.db.vehicleAssignment.update({where:{id:assigned.id},data:{status:'CLOSED',endAt:new Date('2026-10-01')}});
 await h.db.order.update({where:{id:order.id},data:{status:'COMPLETED',currentAssignmentId:null}});
 const ended=(await h.get(path)).items[0];assert.equal(ended.productName,'换入冻结产品');assert.equal(ended.monthlyFeeAmount,275000);assert.equal(ended.months,12);assert.equal(ended.vehicle.id,car.id);
 await h.db.orderServiceStage.update({where:{id:active.id},data:{status:'ACTIVE',endedAt:null}});
 await h.db.vehicleAssignment.update({where:{id:assigned.id},data:{status:'ACTIVE',endAt:null}});
 await h.db.order.update({where:{id:order.id},data:{status:'ACTIVE',currentAssignmentId:assigned.id}});
 for(const patch of [{status:'CANCELLED'},{priorTermsVersionId:f.ids['swap-terms']},{activeQuoteId:futureQuote.id},{deliveryHandoverId:oldProof.id}]){
  await h.db.orderChange.update({where:{id:change.id},data:patch as any});assert.equal((await h.get(path)).items[0].monthlyFeeAmount,null,'unrelated/unapplied lineage is pending '+JSON.stringify(patch));
  await h.db.orderChange.update({where:{id:change.id},data:{status:'APPLIED',priorTermsVersionId:renewal.id,activeQuoteId:quote.id,deliveryHandoverId:handover.id}});
 }
 const unrelated=await h.db.orderTermsVersion.create({data:{orderId:order.id,quoteId:futureQuote.id,version:4,snapshot,hash:futureQuote.commercialHash,effectiveAt:stamp}});
 await h.db.order.update({where:{id:order.id},data:{effectiveTermsVersionId:unrelated.id}});assert.equal((await h.get(path)).items[0].monthlyFeeAmount,null,'unrelated version cannot inherit current stage id');
 const {serviceStageId,...unscoped}=snapshot;
 await h.db.orderTermsVersion.update({where:{id:unrelated.id},data:{snapshot:unscoped}});assert.equal((await h.get(path)).items[0].monthlyFeeAmount,null,'missing stage id cannot bypass active renewal validation');
 await h.db.order.update({where:{id:order.id},data:{effectiveTermsVersionId:swap.id}});
 await h.db.delayQuote.update({where:{id:quote.id},data:{snapshot:{}}});assert.equal((await h.get(path)).items[0].monthlyFeeAmount,null,'missing frozen quote source is pending, not a request error');
 assert.equal(h.externalCalls+h.esignCalls+h.payment.providerCalls,0);
 }finally{await h.close();}
});
