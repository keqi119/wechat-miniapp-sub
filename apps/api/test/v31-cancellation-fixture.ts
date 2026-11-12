import {randomUUID} from 'node:crypto';
import {prepareFixture,syntheticArchive} from './v31-initial-fixture';
import {seedV31Subscription,v31FixtureContent} from './v31-cooperation-fixture';
import {prepareElectronicDocument} from '../src/electronic-documents/prepare';
import {signingParties} from './electronic-fixtures';
import {Cancellation04Service} from '../src/orders/cancellation04';
export async function cancellationFixture(db:any,pendingOriginal=false){
 const f=await prepareFixture(db);await db.adminUser.update({where:{id:f.actor.id},data:{role:'ADMIN'}});f.actor.role='ADMIN';
 await db.legalDocument.update({where:{id:f.template.id},data:{status:'PUBLISHED',confirmedBy:f.actor.id,confirmedAt:new Date()}});
 await syntheticArchive(db,f,await db.serial(tx=>prepareElectronicDocument(tx,f.input,f.actor.id,f.writer,f.options)));
 const sub=await seedV31Subscription(db,f),parties=signingParties().map(p=>({...p,subjectId:p.role==='CUSTOMER'?sub.customer.id:p.role==='OWNER'?f.owner.id:f.platform.id,autoAuthority:null,certificate:{...p.certificate,checkedAt:new Date().toISOString()}}));
 await db.vehicle.update({where:{id:f.vehicle.id},data:{status:'RESERVED',reservedOrderId:sub.order.id}});
 const original=await db.serial(tx=>prepareElectronicDocument(tx,{kind:'SUBSCRIPTION',resourceId:sub.order.id,revision:0,idempotencyKey:randomUUID()},f.actor.id,f.writer,{...f.options,resolveParties:async()=>parties}));await syntheticArchive(db,f,{...original,deferArchive:pendingOriginal});
 await db.legalDocument.create({data:{type:'ELECTRONIC_V31_PRE_DELIVERY_CANCELLATION',version:Math.floor(Math.random()*1000000000)+1,title:'合成04',content:v31FixtureContent('04'),status:'PUBLISHED',confirmedBy:f.actor.id,confirmedAt:new Date()}});
 const evidence=await db.storedFile.create({data:{name:'真实调运及独立约定合成证据.pdf',storagePath:'synthetic',mimeType:'application/pdf',size:50,sha256:'b'.repeat(64),purpose:'evidence',adminId:f.actor.id}});
 const bill=await db.bill.create({data:{orderId:sub.order.id,customerId:sub.customer.id,type:'DEPOSIT',sequence:0,amount:10000,paidAmount:10000,status:'PAID',dueDate:new Date()}});
 const payment=await db.payment.create({data:{billId:bill.id,customerId:sub.customer.id,amount:10000,status:'SUCCEEDED',idempotencyKey:randomUUID(),providerTransactionId:'SYNTHETIC-RECEIPT-'+randomUUID(),succeededAt:new Date(Date.now()-120000)}});
 const service=new Cancellation04Service(db),view:any=await service.read(sub.order.id,f.actor);
 const input={revision:view.orderRevision,sourceHash:view.sourceHash,idempotencyKey:randomUUID(),reason:'客户取消，未交付',responsibility:'CUSTOMER',neverDeliveredEvidenceFileIds:[evidence.id],costs:[]};
return{f,sub,parties,original,evidence,bill,payment,service,input};
}
