import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

/** Called only inside the guarded fresh-schema migration test. */
export async function verifyFieldBatchSchema(db:any,vehicle:{id:string}){
 const columns=await db.$queryRaw`SELECT column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='FieldHandoverTask'`;
 for(const name of ['batchKey','changeId','quoteId','termsVersionId'])assert.ok(columns.some((r:any)=>r.column_name===name),'missing field batch column '+name);
 const batchColumn=columns.find((r:any)=>r.column_name==='batchKey');assert.equal(batchColumn.is_nullable,'NO');assert.equal(batchColumn.column_default,null);
 const actor=await db.adminUser.create({data:{username:'field-schema-'+randomUUID(),name:'合成测试员工',role:'FIELD',passwordHash:'synthetic-not-a-login'}}),customer=await db.customer.create({data:{mobile:'field-schema-'+randomUUID()}}),stamp=new Date('2026-10-31T00:00:00Z');
 const plan=await db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'合成交接批次',months:2,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付',benefits:[],conditions:'测试'}});
 const orderFor=async()=>{const application=await db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:{},idempotencyKey:randomUUID(),requestHash:'a'.repeat(64)}});return db.order.create({data:{applicationId:application.id,customerId:customer.id,vehicleId:vehicle.id,finalPlanSnapshot:{},confirmedMileageKm:0}});};
 const order=await orderFor(),other=await orderFor();
 const changeFor=(orderId:string)=>db.orderChange.create({data:{orderId,customerId:customer.id,kind:'VEHICLE_CHANGE',originalContractId:'synthetic-contract',priorTermsHash:'a'.repeat(64),priorTerms:{},reason:'测试',createdBy:actor.id,idempotencyKey:randomUUID(),requestHash:'a'.repeat(64)}});
 const change=await changeFor(order.id),foreign=await changeFor(other.id);
 const quoteFor=(changeId:string)=>db.delayQuote.create({data:{changeId,revision:1,commercialHash:'a'.repeat(64),snapshot:{},fundsSnapshot:[],createdBy:actor.id}}),quote=await quoteFor(change.id),foreignQuote=await quoteFor(foreign.id);
 const termsFor=(orderId:string,quoteId:string)=>db.orderTermsVersion.create({data:{orderId,quoteId,version:1,snapshot:{},hash:'a'.repeat(64),effectiveAt:stamp}}),terms=await termsFor(order.id,quote.id),foreignTerms=await termsFor(other.id,foreignQuote.id);
 const base={orderId:order.id,vehicleId:vehicle.id,assigneeId:actor.id,createdBy:actor.id,updatedBy:actor.id};
 await db.fieldHandoverTask.create({data:{...base,type:'DELIVERY',batchKey:'DELIVERY:INITIAL'}});
 await db.fieldHandoverTask.create({data:{...base,type:'DELIVERY',termsVersionId:terms.id,batchKey:'DELIVERY:'+terms.id}});
 await assert.rejects(db.fieldHandoverTask.create({data:{...base,type:'DELIVERY',batchKey:'DELIVERY:INITIAL'}}),(e:any)=>e.code==='P2002');
 const swap={...base,type:'SWAP_RETURN',batchKey:`CHANGE:${change.id}:RETURN`,changeId:change.id,quoteId:quote.id,vehicleAssignmentId:'synthetic-assignment'};
 await db.fieldHandoverTask.create({data:swap});
 await db.fieldHandoverTask.create({data:{...swap,type:'SWAP_DELIVERY',batchKey:`CHANGE:${change.id}:DELIVERY`,vehicleAssignmentId:null}});
 const check=(e:any)=>/FieldHandoverTask_batch_scope/.test(String(e.message))&&(e.code==='P2004'||/23514/.test(String(e.message)));
 for(const patch of [
  {type:'DELIVERY',batchKey:''},{type:'UNKNOWN',batchKey:'DELIVERY:INITIAL'},
  {type:'DELIVERY',batchKey:'DELIVERY:wrong'},{type:'RETURN',batchKey:'FINAL_RETURN:no-assignment'},
  {...swap,batchKey:'CHANGE:wrong:RETURN'},
  {...swap,quoteId:null},{...swap,vehicleAssignmentId:null},
 ])await assert.rejects(db.fieldHandoverTask.create({data:{...base,...patch}}),check);
 await assert.rejects(db.fieldHandoverTask.create({data:{...swap,orderId:other.id}}),(e:any)=>e.code==='P2003');
 await assert.rejects(db.fieldHandoverTask.create({data:{...base,type:'DELIVERY',termsVersionId:foreignTerms.id,batchKey:'DELIVERY:'+foreignTerms.id}}),(e:any)=>e.code==='P2003');
 await assert.rejects(db.fieldHandoverTask.update({where:{orderId_batchKey:{orderId:order.id,batchKey:swap.batchKey}},data:{quoteId:foreignQuote.id}}),(e:any)=>e.code==='P2003');
 const legacyId=randomUUID();await db.fieldHandoverTask.create({data:{...base,id:legacyId,type:'RETURN',batchKey:'LEGACY:'+legacyId}});
 await assert.rejects(db.$executeRaw`INSERT INTO "FieldHandoverTask" (id,"orderId",type,"vehicleId","assigneeId","createdBy","updatedBy","updatedAt") VALUES (${randomUUID()},${order.id},'RETURN',${vehicle.id},${actor.id},${actor.id},${actor.id},${stamp})`,(e:any)=>e.meta?.code==='23502');
}
