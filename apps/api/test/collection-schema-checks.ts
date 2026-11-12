import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

/** Only the guarded fresh migration test calls this in its new isolated schema. */
export async function verifyCollectionSchema(db:any,vehicle:{id:string}){
 const names=['CollectionCase','CollectionCaseBill','CollectionAction'];
 const tables=await db.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema()`;
 for(const name of names){assert.ok(tables.some((r:any)=>r.table_name===name),'missing collection table '+name);const [row]=await db.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "${name}"`);assert.equal(row.count,0);}
 const date=new Date('2026-10-31'),due=new Date('2026-10-30'),hash='e'.repeat(64),actor='synthetic-collection-finance',jsonNull=Symbol('json-null');
 const customer=await db.customer.create({data:{mobile:'synthetic-collection-'+randomUUID()}}),otherCustomer=await db.customer.create({data:{mobile:'synthetic-collection-'+randomUUID()}});
 const plan=await db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'合成催收约束',months:12,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付',benefits:[],conditions:'测试'}});
 const orderFor=async(customerId:string)=>{const app=await db.application.create({data:{customerId,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:{},idempotencyKey:randomUUID(),requestHash:hash}});return db.order.create({data:{applicationId:app.id,customerId,vehicleId:vehicle.id,finalPlanSnapshot:{},confirmedMileageKm:0}});};
 const order=await orderFor(customer.id),otherOrder=await orderFor(customer.id),foreignOrder=await orderFor(otherCustomer.id);
 const billFor=(o:any)=>db.bill.create({data:{orderId:o.id,customerId:o.customerId,type:'SUBSCRIPTION',sequence:1,amount:10000,dueDate:due,status:'PENDING'}});
 const bill=await billFor(order),otherBill=await billFor(otherOrder),foreignBill=await billFor(foreignOrder);
 const serial=(key:string,value:any)=>key==='sourceSnapshot'?(value===jsonNull?'null':value===null?null:JSON.stringify(value)):value;
 const expr=(key:string,index:number)=>`$${index}${key==='sourceSnapshot'?'::jsonb':''}`;
 const insert=async(table:string,values:Record<string,any>)=>{const row={id:randomUUID(),...values},keys=Object.keys(row);await db.$executeRawUnsafe(`INSERT INTO "${table}" (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map((k,i)=>expr(k,i+1)).join(',')})`,...keys.map(k=>serial(k,row[k])));return row;};
 const patch=(table:string,id:string,values:Record<string,any>)=>{const keys=Object.keys(values);return db.$executeRawUnsafe(`UPDATE "${table}" SET ${keys.map((k,i)=>`"${k}"=${expr(k,i+1)}`).join(',')} WHERE id=$${keys.length+1}`,...keys.map(k=>serial(k,values[k])),id);};
 const code=(value:string)=>(e:any)=>e?.meta?.code===value||e?.code===({'23503':'P2003','23505':'P2002'} as Record<string,string>)[value];
 const check=(name:string)=>(e:any)=>String(e?.message||'').includes(name)&&(e?.meta?.code==='23514'||e?.code==='P2004');
 const invalid=async(table:string,id:string,items:Record<string,any>[],constraint:string)=>{for(const item of items)await assert.rejects(patch(table,id,item),check(constraint),constraint+':'+Object.keys(item).join(','));};
 const base={orderId:order.id,customerId:customer.id,asOfDate:date,totalOverdueAmount:10000,maxOverdueDays:1,level:'D1',sourceSnapshot:{version:1},sourceHash:hash,createdBy:actor,updatedBy:actor,updatedAt:date};
 const current=await insert('CollectionCase',base);
 await invalid('CollectionCase',current.id,[{revision:0},{totalOverdueAmount:-1},{maxOverdueDays:-1},{level:'D5'},{totalOverdueAmount:0},{sourceHash:'bad'},{sourceSnapshot:{}},{sourceSnapshot:[]},{sourceSnapshot:jsonNull},{createdBy:' '},{updatedBy:' '}],'CollectionCase_values');
 await invalid('CollectionCase',current.id,[{status:'PAUSED'},{status:'CLOSED'},{closedAt:date},{closedBy:actor},{closeReason:'结案'},{status:'CLOSED',closedAt:date,closedBy:actor,closeReason:' '}],'CollectionCase_close');
 await assert.rejects(insert('CollectionCase',base),code('23505'));
 await assert.rejects(insert('CollectionCase',{...base,orderId:otherOrder.id,customerId:otherCustomer.id}),code('23503'));
 const second=await insert('CollectionCase',{...base,orderId:otherOrder.id});
 const link={caseId:current.id,orderId:order.id,customerId:customer.id,billId:bill.id,initialDueDate:due,initialAmount:10000,initialOverdueAmount:10000,initialAsOfDate:date,sourceSnapshot:{billId:bill.id},sourceHash:hash,linkedBy:actor};
 const linked=await insert('CollectionCaseBill',link);
 await assert.rejects(insert('CollectionCaseBill',link),code('23505'));
 for(const fields of [{billId:otherBill.id},{billId:foreignBill.id},{caseId:second.id},{orderId:otherOrder.id},{customerId:otherCustomer.id}])await assert.rejects(patch('CollectionCaseBill',linked.id,fields),code('23503'));
 await invalid('CollectionCaseBill',linked.id,[{initialAmount:0},{initialOverdueAmount:0},{initialOverdueAmount:10001},{initialAsOfDate:due},{sourceSnapshot:jsonNull},{sourceSnapshot:{}},{sourceHash:'bad'},{linkedBy:' '}],'CollectionCaseBill_values');
 const action={caseId:current.id,orderId:order.id,customerId:customer.id,sequence:1,beforeRevision:0,afterRevision:1,kind:'CREATE',reason:'人工建立案件',sourceSnapshot:{version:1},sourceHash:hash,actorId:actor};
 const created=await insert('CollectionAction',action);
 await assert.rejects(insert('CollectionAction',action),code('23505'));
 await assert.rejects(insert('CollectionAction',{...action,kind:'REFRESH',sequence:2,afterRevision:2,beforeRevision:1,orderId:otherOrder.id}),code('23503'));
 await invalid('CollectionAction',created.id,[{sequence:0},{beforeRevision:-1},{afterRevision:0},{afterRevision:2},{kind:'DELETE'},{reason:' '},{sourceSnapshot:jsonNull},{sourceSnapshot:{}},{sourceHash:'bad'},{actorId:' '}],'CollectionAction_values');
 await invalid('CollectionAction',created.id,[{method:'PHONE'},{content:'未发生的联系'},{promiseDate:date},{promiseAmount:10000},{nextFollowUpDate:date}],'CollectionAction_contact');
 const contact=await insert('CollectionAction',{...action,sequence:2,beforeRevision:1,afterRevision:2,kind:'CONTACT',method:'PHONE',actionType:'PROMISE_TO_PAY',result:'CUSTOMER_PROMISED',content:'客户承诺付款',promiseDate:date,promiseAmount:10000,nextFollowUpDate:date});
 await invalid('CollectionAction',contact.id,[{method:'SYSTEM'},{actionType:'CLOSE'},{result:'UNKNOWN'},{content:' '},{promiseAmount:0},{promiseAmount:null},{promiseDate:null}],'CollectionAction_contact');
 // Use SQL dates directly to verify database bounds independently from Date parameter serialization.
 for(const [table,id,column,constraint] of [['CollectionCase',current.id,'asOfDate','CollectionCase_values'],['CollectionCaseBill',linked.id,'initialAsOfDate','CollectionCaseBill_values'],['CollectionAction',contact.id,'promiseDate','CollectionAction_contact'],['CollectionAction',contact.id,'nextFollowUpDate','CollectionAction_contact']])await assert.rejects(db.$executeRawUnsafe(`UPDATE "${table}" SET "${column}"=DATE '10000-01-01' WHERE id=$1`,id),check(constraint));
 // SQL NULL must not slip through CHECK's three-valued logic.
 for(const [table,id,column] of [['CollectionCase',current.id,'sourceSnapshot'],['CollectionCaseBill',linked.id,'sourceSnapshot'],['CollectionAction',created.id,'sourceSnapshot']])await assert.rejects(patch(table,id,{[column]:null}),code('23502'));
 await patch('CollectionCase',current.id,{status:'CLOSED',closedAt:date,closedBy:actor,closeReason:'已确认结清',totalOverdueAmount:0,maxOverdueDays:0,level:null});
 await insert('CollectionCase',base); // future delinquency can create a new case, never overwrite history.
}
