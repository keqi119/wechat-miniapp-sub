/** Explicit historical-mode fixture. Import only from legacy ESIGN test files.
 * Node's test runner isolates each file; offline and MVP tests keep fail-closed defaults.
 * All signing providers used by these tests are synthetic fixtures.
 */
process.env.ESIGN_NEW_REQUESTS_ENABLED = 'true';
process.env.NEW_ORDER_CONTRACT_MODE = 'ESIGN';
process.env.MVP_V2_ENABLED = 'false';

/** A public plan still needs a real published product even in historical mode. */
export async function publishLegacyPlanFixture(db:any,plan:any){
 const product=await db.product.create({data:{name:plan.name,createdBy:'synthetic-legacy-fixture'}});
 const version=await db.productVersion.create({data:{productId:product.id,version:1,status:'PUBLISHED',name:plan.name,months:plan.months,monthlyFeeAmount:plan.monthlyFeeAmount,mileagePerMonthKm:plan.mileagePerMonthKm,excessMileagePriceAmount:plan.excessMileagePriceAmount,energyDescription:plan.energyDescription,conditions:plan.conditions,vehicleIds:[plan.vehicleId],modelDefinitionIds:[],createdBy:'synthetic-legacy-fixture',publishedBy:'synthetic-legacy-reviewer',publishedAt:new Date(),items:{create:{kind:'BASE_SUBSCRIPTION',position:0}}}});
 for(const [index,name] of (plan.benefits||[]).entries()){
  const definition=await db.benefitDefinition.create({data:{name,createdBy:'synthetic-legacy-fixture'}});
  const benefit=await db.benefitDefinitionVersion.create({data:{definitionId:definition.id,version:1,name,description:name,provider:'合成服务商',conditions:'合成历史条款',kind:'DESCRIPTION',validity:'ORDER',createdBy:'synthetic-legacy-fixture'}});
  await db.productCombinationItem.create({data:{productVersionId:version.id,position:index+1,kind:'BENEFIT',benefitVersionId:benefit.id}});
 }
 const current=await db.subscriptionPlan.update({where:{id:plan.id},data:{productVersionId:version.id}});
 await db.vehicleListing.create({data:{vehicleId:plan.vehicleId,productVersionId:version.id,subscriptionPlanId:plan.id,status:current.active?'PUBLISHED':'DRAFT',visible:!!current.active,source:'LEGACY_MIGRATED',createdBy:'synthetic-legacy-fixture',...(current.active?{publishedBy:'synthetic-legacy-reviewer',publishedAt:new Date()}:{})}});
 return version;
}

/** Persist the business row that signing now rechecks inside its transaction. */
export async function persistLegacySigningResource(db:any,input:{id:string;customerId?:string;vehicleId?:string;kind?:'SUBSCRIPTION'|'HANDOVER';documentHash:string}){
 const {id,documentHash,kind='SUBSCRIPTION'}=input,vehicleId=input.vehicleId||input.id;
 const customerId=input.customerId||(await db.customer.create({data:{id,mobile:'synthetic-'+id,name:'合成签署客户'}})).id;
 if(!input.vehicleId)await db.vehicle.create({data:{id:vehicleId,brand:'Synthetic',model:'EV',title:'合成历史签署车辆',year:2026,city:'上海',mileageKm:100,status:'RESERVED'}});
 await db.subscriptionPlan.create({data:{id,vehicleId,name:'合成历史方案',months:1,monthlyFeeAmount:100,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自行充电',benefits:[],conditions:'合成条款'}});
 await db.application.create({data:{id,customerId,vehicleId,subscriptionPlanId:id,profile:{},consents:[],idempotencyKey:id,requestHash:id,status:'FINAL_PLAN_CONFIRMED'}});
 await db.order.create({data:{id,applicationId:id,customerId,vehicleId,contractMode:'ESIGN',status:kind==='HANDOVER'?'AWAITING_HANDOVER':'AWAITING_SIGNATURE',confirmedMileageKm:100,finalPlanSnapshot:{}}});
 if(kind==='HANDOVER')return db.handover.create({data:{id,orderId:id,customerId,vehicleId,type:'DELIVERY',executionMode:'ESIGN',status:'CUSTOMER_CONFIRMED',signatureStatus:'DRAFT',actualAt:new Date(),readingKm:100,fileIds:[],checklist:[],manifestHash:documentHash,confirmedAt:new Date(),customerResponse:'CONFIRM'}});
 return db.contract.create({data:{id,orderId:id,customerId,executionMode:'ESIGN',status:'PENDING',documentHash,body:'甲方：上海宁达信息科技有限公司'}});
}
