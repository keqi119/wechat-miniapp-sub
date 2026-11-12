import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

/** Invoked only by the guarded fresh-schema migration test. */
export async function verifyOfflineChangeSchema(db:any,vehicle:{id:string}){
 const fields:Record<string,string[]>={DocumentArchive:['quoteId'],OrderChange:['originalArchiveVersionId','priorTermsVersionId'],DelayQuote:['approvedArchiveVersionId'],OrderTermsVersion:['offlineArchiveVersionId']};
 const columns=await db.$queryRaw`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema()`;
 for(const [table,names] of Object.entries(fields))for(const name of names)assert.ok(columns.some((r:any)=>r.table_name===table&&r.column_name===name),'missing offline change field '+table+'.'+name);
 const hash='a'.repeat(64),actor='synthetic-offline-change',now=new Date('2026-10-31T00:00:00Z');
 const customer=await db.customer.create({data:{mobile:'offline-change-schema-'+randomUUID()}});
 const plan=await db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'合成线下变更',months:2,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付',benefits:[],conditions:'测试'}});
 const orderFor=async()=>{const app=await db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:{},idempotencyKey:randomUUID(),requestHash:hash}});return db.order.create({data:{applicationId:app.id,customerId:customer.id,vehicleId:vehicle.id,contractMode:'OFFLINE',finalPlanSnapshot:{commercialHash:hash},confirmedMileageKm:0}});};
 const order=await orderFor(),other=await orderFor();
 const contract=await db.contract.create({data:{orderId:order.id,customerId:customer.id,executionMode:'OFFLINE',documentHash:hash}});
 const changeFor=(orderId:string)=>db.orderChange.create({data:{orderId,customerId:customer.id,priorTermsHash:hash,priorTerms:{synthetic:true},originalContractId:contract.id,reason:'合成变更',createdBy:actor,idempotencyKey:randomUUID(),requestHash:hash}});
 const change=await changeFor(order.id),foreignChange=await changeFor(other.id);
 const q=await db.delayQuote.create({data:{changeId:change.id,revision:1,commercialHash:hash,snapshot:{synthetic:true},fundsSnapshot:[],createdBy:actor}});
 const otherQuote=await db.delayQuote.create({data:{changeId:foreignChange.id,revision:1,commercialHash:hash,snapshot:{synthetic:true},fundsSnapshot:[],createdBy:actor}});
 const archive=await db.documentArchive.create({data:{kind:'RENTAL',subjectType:'ORDER',subjectId:order.id,orderId:order.id,ownerId:'synthetic-owner',createdBy:actor}});
 const version=await db.archiveVersion.create({data:{archiveId:archive.id,version:1,templateId:'synthetic-template',templateVersion:1,businessSnapshotHash:hash,partiesSnapshot:[],requiredSigners:[],scopeSnapshot:{}}});
 const terms=await db.orderTermsVersion.create({data:{orderId:order.id,quoteId:q.id,version:1,snapshot:{synthetic:true},hash,effectiveAt:now}});
 const foreignTerms=await db.orderTermsVersion.create({data:{orderId:other.id,quoteId:otherQuote.id,version:1,snapshot:{synthetic:true},hash,effectiveAt:now}});
 const patch=(table:string,id:string,values:Record<string,unknown>)=>{const keys=Object.keys(values);return db.$executeRawUnsafe(`UPDATE "${table}" SET ${keys.map((key,i)=>`"${key}"=$${i+1}${key==='status'&&['OrderChange','DelayQuote'].includes(table)?`::"${table}Status"`:''}`).join(',')} WHERE id=$${keys.length+1}`,...keys.map(key=>values[key]),id);};
 const fk=(e:any)=>e?.code==='P2003'||e?.meta?.code==='23503';
 const check=(name:string)=>(e:any)=>(e?.code==='P2004'||e?.meta?.code==='23514'||/23514/.test(String(e.message)))&&String(e.message).includes(name);
 const duplicate=(e:any)=>e?.code==='P2002'||e?.meta?.code==='23505';
 for(const [table,id,column] of [['OrderChange',change.id,'originalArchiveVersionId'],['DelayQuote',q.id,'approvedArchiveVersionId'],['OrderTermsVersion',terms.id,'offlineArchiveVersionId']])await assert.rejects(patch(table,id,{[column]:'missing-version',...(table==='DelayQuote'?{status:'CONFIRMED',confirmedAt:now}:{})}),fk);
 await assert.rejects(patch('OrderChange',change.id,{status:'AWAITING_ARCHIVE'}),check('OrderChange_offline_origin'));
 await patch('OrderChange',change.id,{originalArchiveVersionId:version.id,status:'AWAITING_ARCHIVE'});
 await assert.rejects(patch('OrderChange',change.id,{priorTermsVersionId:foreignTerms.id}),fk);
 await patch('OrderChange',change.id,{priorTermsVersionId:terms.id});
 await assert.rejects(patch('OrderChange',change.id,{originalArchiveVersionId:null}),check('OrderChange_offline_origin'));
 await assert.rejects(patch('DelayQuote',q.id,{approvedArchiveVersionId:version.id}),check('DelayQuote_offline_approval'));
 await patch('DelayQuote',q.id,{status:'CONFIRMED',confirmedAt:now,approvedArchiveVersionId:version.id});
 await patch('OrderTermsVersion',terms.id,{offlineArchiveVersionId:version.id});
 await assert.rejects(db.archiveVersion.delete({where:{id:version.id}}),fk);
 const amendment=()=>db.documentArchive.create({data:{kind:'ORDER_AMENDMENT',subjectType:'ORDER_CHANGE_QUOTE',subjectId:q.id,orderId:order.id,ownerId:'synthetic-owner',createdBy:actor}});
 await assert.rejects(amendment(),check('DocumentArchive_quote_scope'));
 // Raw insert exercises the new column even before Prisma generation.
 const id=randomUUID();await db.$executeRaw`INSERT INTO "DocumentArchive" (id,kind,"subjectType","subjectId","quoteId","orderId","ownerId","createdBy") VALUES (${id},'ORDER_AMENDMENT','ORDER_CHANGE_QUOTE',${q.id},${q.id},${order.id},'synthetic-owner',${actor})`;
 for(const values of [{kind:'RENTAL'},{subjectType:'ORDER'},{subjectId:'wrong-quote'},{quoteId:null},{orderId:null},{ownerId:null},{handoverId:'unexpected'}])await assert.rejects(patch('DocumentArchive',id,values),check('DocumentArchive_quote_scope'));
 await assert.rejects(db.$executeRaw`INSERT INTO "DocumentArchive" (id,kind,"subjectType","subjectId","quoteId","orderId","ownerId","createdBy") VALUES (${randomUUID()},'ORDER_AMENDMENT','ORDER_CHANGE_QUOTE',${q.id},${q.id},${order.id},'synthetic-owner',${actor})`,duplicate);
 await assert.rejects(patch('DocumentArchive',id,{quoteId:'missing-quote',subjectId:'missing-quote'}),fk);
 await assert.rejects(db.delayQuote.delete({where:{id:q.id}}),fk);
 // Historical nullable rows remain readable, without a fabricated signature.
 assert.equal((await db.contract.findUniqueOrThrow({where:{id:contract.id}})).status,'DRAFT');
 assert.equal((await db.documentArchive.findUniqueOrThrow({where:{id:archive.id}})).kind,'RENTAL');
}
