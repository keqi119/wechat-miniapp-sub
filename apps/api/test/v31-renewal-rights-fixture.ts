import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {AddonProductsController} from '../src/addon-products/controller';
import {SwapPurchasesController} from '../src/swap-purchases/controller';
import {UsageService} from '../src/usage/usage.service';
import {acceptConsents,currentDocuments} from '../src/auth/consents';

export async function purchaseOriginalRenewalRights(db:any,fixture:any){
 const {f,sub,model,billing,gateway,payingCustomer}=fixture;
 process.env.SWAP_CREDIT_PURCHASE_ENABLED='true';
 await db.serial(async(tx:any)=>acceptConsents(tx,sub.customer.id,(await currentDocuments(tx,['terms','privacy'])).map((d:any)=>({documentId:d.id,version:d.version})),['terms','privacy'],'SYNTHETIC_TEST'));
 const session=await db.customerSession.create({data:{id:randomUUID(),customerId:sub.customer.id,expiresAt:new Date(Date.now()+86400000)}}),request={customer:{id:sub.customer.id},session:{id:session.id}},addons=new AddonProductsController(db,()=>new Date());
 let swap:any=await addons.catalog(sub.order.id,{kind:'SWAP_CREDIT',targetModelDefinitionId:model.id},request);
 if(!swap.products.length){const saved=await addons.create({kind:'SWAP_CREDIT',name:'原期单次付费换车',scopePrices:[{id:'target',scopes:[{brand:model.brand,allModels:false,modelDefinitionIds:[model.id]}],prices:[{quantity:1,amount:50000}]}],revision:0,idempotencyKey:randomUUID()},{admin:f.actor});await addons.publish(saved.productId,{versionId:saved.id,revision:saved.revision,idempotencyKey:randomUUID()},{admin:f.actor});swap=await addons.catalog(sub.order.id,{kind:'SWAP_CREDIT',targetModelDefinitionId:model.id},request);}
 assert.equal(swap.eligible,true);const p=swap.products[0];
 const purchased=await new SwapPurchasesController(db,billing,()=>new Date()).purchase(sub.order.id,{sku:'SWAP_CREDIT_ADDON_1',productId:p.productId,versionId:p.versionId,quoteId:p.quotes[0].quoteId,sourceHash:p.sourceHash,targetModelDefinitionId:model.id,termsVersion:swap.terms.version,termsHash:swap.terms.hash,accepted:true,idempotencyKey:randomUUID()},request);
 const mileage=await addons.create({kind:'MILEAGE_PACK',name:'原服务月另购里程',scopePrices:[{id:'mile',scopes:[{brand:model.brand,allModels:false,modelDefinitionIds:[model.id]}],prices:[{km:1000,amount:10000},{km:1500,amount:14000},{km:2000,amount:18000}]}],revision:0,idempotencyKey:randomUUID()},{admin:f.actor});await addons.publish(mileage.productId,{versionId:mileage.id,revision:mileage.revision,idempotencyKey:randomUUID()},{admin:f.actor});
 const catalog:any=await addons.catalog(sub.order.id,{kind:'MILEAGE_PACK'},request);assert.equal(catalog.eligible,true);const m=catalog.products[0];
 const pack=await new UsageService(db,()=>new Date()).purchase(sub.order.id,sub.customer.id,{productId:m.productId,versionId:m.versionId,quoteId:m.quotes[0].quoteId,sourceHash:m.sourceHash,periodId:catalog.context.periodId,termsVersion:catalog.terms.version,termsHash:catalog.terms.hash,accepted:true,idempotencyKey:randomUUID()},session.id);
 for(const billId of [purchased.bill.id,pack.bill.id]){const paid=await billing.pay(payingCustomer,billId,randomUUID());gateway.capture(paid.paymentId);gateway.payments.set(paid.paymentId,{...gateway.payments.get(paid.paymentId),succeededAt:new Date().toISOString()});await billing.sync(paid.paymentId);}
 const purchase=await db.swapCreditPurchase.findUniqueOrThrow({where:{id:purchased.purchase.id}}),credit=await db.swapCredit.findUniqueOrThrow({where:{id:purchase.creditId}}),mileagePurchase=await db.mileagePurchase.findUniqueOrThrow({where:{id:pack.purchase.id}});
 assert.equal(purchase.status,'ACTIVE');assert.equal(mileagePurchase.status,'ACTIVE',JSON.stringify((await db.payment.findFirst({where:{billId:pack.bill.id}}))?.reconciliationReason));return{purchase,credit,mileagePurchase};
}
