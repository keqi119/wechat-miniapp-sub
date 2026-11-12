import {swapPurchaseEnabled,requireSwapPurchaseEligibility} from './availability';
import {swapYuan,freezeAddonSwapPricing,ADDON_SWAP_SKU} from './policy';
import {resolveAddonQuote} from '../addon-products/catalog';
import {Body,Controller,Get,Inject,Param,Post,Query,Req} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {key,hash,pagination,audit} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentConsents} from '../auth/consents';
import {BillingService} from '../billing/billing';
import {USAGE_CLOCK,shanghaiDay} from '../usage/rules';
import {SWAP_PRODUCT,SWAP_TERMS} from './rules';
import {purchaseView} from './view';
import {refreshLegacySwapExpiry} from './ledger';
import {requireCurrentStaff} from '../auth/staff-session';
import {restorePurchase} from './restore';
import {readSwapSourceAt,requireNoConfirmedFutureSwap,withinSwapSource} from '../order-service-stages/swap-source';
async function currentCustomer(tx:any,r:any){ensure(r?.customer?.id&&r?.session?.id,401,'SESSION_EXPIRED','请重新登录');const session=await tx.customerSession.findUnique({where:{id:r.session.id}});ensure(session?.customerId===r.customer.id&&session.expiresAt>new Date(),401,'SESSION_EXPIRED','登录已过期');}
async function purchaseLocks(tx:any,orderId:string){await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "UsageAccount" WHERE "orderId" = ${orderId} FOR UPDATE`;const account=await tx.usageAccount.findUnique({where:{orderId}});ensure(account,409,'USAGE_NOT_ACTIVE','请先完成交车');return account;}
const statuses=['PENDING_PAYMENT','ACTIVE','CONSUMED','EXPIRED','PAYMENT_REVIEW','REFUND_PENDING','REFUNDED','VOID'] as const;
@Controller()
export class SwapPurchasesController {
 constructor(@Inject(Db)private db:Db,@Inject(BillingService)private billing:BillingService,@Inject(USAGE_CLOCK)private clock:()=>Date){}
 @Post('customer/orders/:id/swap-credits')async purchase(@Param('id')orderId:string,@Body()body:any,@Req()r:any){
  const consent={termsDocumentId:z.string().min(1),termsDocumentVersion:z.number().int().positive(),termsHash:z.string().regex(/^[a-f0-9]{64}$/i),accepted:z.literal(true),idempotencyKey:key};
  const addon=z.object({sku:z.literal(ADDON_SWAP_SKU),productId:z.string().min(1),versionId:z.string().min(1),quoteId:z.string().min(1),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),targetModelDefinitionId:z.string().min(1),termsVersion:z.literal('SWAP_CREDIT_ADDON_V1'),termsHash:z.string().regex(/^[a-f0-9]{64}$/),accepted:z.literal(true),idempotencyKey:key}).strict();
  const legacy=z.discriminatedUnion('productId',[z.object({...consent,productId:z.literal(SWAP_PRODUCT.id),termsVersion:z.literal(SWAP_TERMS)}).strict(),z.object({...consent,productId:z.literal('SWAP_CREDIT_TERM_1'),termsVersion:z.literal('SWAP_CREDIT_V2'),pricingHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict()]);
  const input=z.union([addon,legacy]).parse(body);
  return this.db.serial(async tx=>{
   await currentCustomer(tx,r);await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;const order=await tx.order.findFirst({where:{id:orderId,customerId:r.customer.id}});ensure(order,404,'NOT_FOUND','本人的订单不存在');const account=await purchaseLocks(tx,orderId),requestHash=hash(input),old=await tx.swapCreditPurchase.findUnique({where:{orderId_idempotencyKey:{orderId,idempotencyKey:input.idempotencyKey}}});
   if(old){ensure(old.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','购买请求编号与内容冲突');const purchase=await purchaseView(tx,old,this.clock());return{purchase,bill:purchase.bill};}
   ensure('sku' in input,409,'SWAP_ADDON_CATALOG_REQUIRED','请从目标换车权益目录重新选择；原已购权益与账单继续保留');
   ensure(swapPurchaseEnabled(order),503,'SWAP_PURCHASE_DISABLED','付费换车次数购买暂未开放');await requireSwapPurchaseEligibility(tx,order,this.clock());await requireCurrentConsents(tx,r.customer.id,['terms','privacy']);await requireNoConfirmedFutureSwap(tx,order);const source=await readSwapSourceAt(tx,order,account,this.clock());ensure(withinSwapSource(order,account,source,this.clock()),409,'SWAP_PURCHASE_UNAVAILABLE','仅当前服务租期已生效且尚未归还时可购买');
   const resolved=await resolveAddonQuote(tx,order,'SWAP_CREDIT',input,this.clock()),target=await tx.modelDefinition.findUnique({where:{id:input.targetModelDefinitionId}});
   ensure(target&&resolved.context.targetModelDefinitionId===target.id&&(resolved.context.serviceStageId??null)===source.serviceStageId,409,'SWAP_PURCHASE_SOURCE','目标车型或当前服务租期已变化，请重新读取报价');
   const product={id:resolved.product.productId,amount:resolved.quote.amount},pricingSnapshot=freezeAddonSwapPricing(resolved,target,source),terms=resolved.terms;
   // First application retains the original version writes. A waiter with an older
   // Serializable snapshot retries on this Order write; a successful old key never writes.
   await tx.order.update({where:{id:orderId},data:{revision:{increment:1}}});await tx.usageAccount.update({where:{id:account.id},data:{revision:{increment:1}}});
   const seq=await tx.bill.aggregate({where:{orderId,type:'SWAP_CREDIT'},_max:{sequence:true}}),bill=await tx.bill.create({data:{orderId,customerId:r.customer.id,type:'SWAP_CREDIT',sequence:(seq._max.sequence||0)+1,amount:product.amount,dueDate:new Date(shanghaiDay(this.clock())),status:'PENDING',description:`选定目标车型换车一次；${swapYuan(product.amount)}元；不含车辆升级差价；当前服务租期或实际退订到期失效`}});
   const row=await tx.swapCreditPurchase.create({data:{orderId,customerId:r.customer.id,billId:bill.id,quantity:1,amount:product.amount,currency:'CNY',...(pricingSnapshot?{pricingSnapshot}:{}),termsSnapshot:{...terms,accepted:true},acceptedAt:this.clock(),expiresAt:source.endAt,...(source.serviceStageId?{serviceStageId:source.serviceStageId}:{}),idempotencyKey:input.idempotencyKey,requestHash}});
   await audit(tx,r.customer.id,'PURCHASE_SWAP_CREDIT','orders',orderId,{purchaseId:row.id,billId:bill.id,amount:product.amount,termsVersion:terms.version,termsHash:terms.hash,targetModelDefinitionId:target.id,sourceHash:resolved.version.sourceHash},'CUSTOMER');const purchase=await purchaseView(tx,row,this.clock());return{purchase,bill:purchase.bill};
  });
 }
 private async read(id:string,customerId?:string,financial=false,actor?:any,request?:any){return this.db.serial(async tx=>{if(actor)await requireCurrentStaff(tx,actor,'swap-credit-purchases',false);else await currentCustomer(tx,request);const p=await tx.swapCreditPurchase.findFirst({where:{id,...(customerId?{customerId}:{})}});ensure(p,404,'NOT_FOUND','购买记录不存在');await refreshLegacySwapExpiry(tx,await tx.order.findUniqueOrThrow({where:{id:p.orderId}}),this.clock());return purchaseView(tx,await tx.swapCreditPurchase.findUniqueOrThrow({where:{id}}),this.clock(),!customerId,financial);});}
 @Get('customer/swap-credit-purchases/:id')customer(@Param('id')id:string,@Req()r:any){return this.read(id,r.customer.id,false,undefined,r);}
 @Get('admin/swap-credit-purchases/:id')admin(@Param('id')id:string,@Req()r:any){return this.read(id,undefined,['ADMIN','FINANCE'].includes(r.admin.role),r.admin);}
 @Get('admin/swap-credit-purchases')async list(@Query()q:any,@Req()r:any){const p=pagination(q),status=q.status?z.enum(statuses).parse(q.status):undefined,where:any={...(status?{status}:{}),...(q.keyword?{OR:[{id:{contains:String(q.keyword).slice(0,200)}},{orderId:{contains:String(q.keyword).slice(0,200)}}]}:{})};return this.db.serial(async tx=>{const actor=await requireCurrentStaff(tx,r.admin,'swap-credit-purchases',false);const due=await tx.swapCreditPurchase.findMany({where:{expiresAt:{lte:this.clock()},status:{in:['ACTIVE','PENDING_PAYMENT']}},select:{orderId:true},distinct:['orderId']});for(const orderId of [...new Set(due.map(row=>row.orderId))].sort())await refreshLegacySwapExpiry(tx,await tx.order.findUniqueOrThrow({where:{id:orderId}}),this.clock());const [rows,total]=await Promise.all([tx.swapCreditPurchase.findMany({where,skip:p.skip,take:p.take,orderBy:{createdAt:'desc'}}),tx.swapCreditPurchase.count({where})]);return{items:await Promise.all(rows.map(row=>purchaseView(tx,row,this.clock(),true,['ADMIN','FINANCE'].includes(actor.role)))),total,page:p.page,pageSize:p.pageSize};});}
 @Post('customer/swap-credit-purchases/:id/close')customerClose(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.close(id,body,r,true);}
 @Post('admin/swap-credit-purchases/:id/close')adminClose(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.close(id,body,r,false);}
 @Post('admin/swap-credit-purchases/:id/restore')restore(@Param('id')id:string,@Body()body:any,@Req()r:any){const input=z.object({refundId:z.string().min(1),reason:z.string().trim().min(1).max(1000),idempotencyKey:key}).strict().parse(body);return this.db.serial(async tx=>{const actor=await requireCurrentStaff(tx,r.admin,'swap-credit-purchases',true);ensure(['ADMIN','FINANCE'].includes(actor.role),403,'FORBIDDEN','仅财务可恢复原次数');return purchaseView(tx,await restorePurchase(tx,id,input,actor.id,this.clock()),this.clock(),true,true);});}
 private async close(id:string,body:any,r:any,customer:boolean){
  const input=z.object({idempotencyKey:key}).strict().parse(body),customerId=customer?r.customer.id:undefined;
  const permission=async(tx:any)=>{if(customer){await currentCustomer(tx,r);return r.customer.id;}const actor=await requireCurrentStaff(tx,r.admin,'swap-credit-purchases',true);ensure(['ADMIN','FINANCE'].includes(actor.role),403,'FORBIDDEN','仅财务可关闭购买');return actor.id;};
  const p=await this.db.serial(async tx=>{await permission(tx);const row=await tx.swapCreditPurchase.findFirst({where:{id,...(customerId?{customerId}:{})}});ensure(row,404,'NOT_FOUND','购买记录不存在');return row;});
  const payments=await this.db.payment.findMany({where:{billId:p.billId,status:{in:['CREATING','PENDING']}}});for(const payment of payments)await this.billing.close(payment.id,customerId);
  return this.db.serial(async tx=>{const actorId=await permission(tx);await purchaseLocks(tx,p.orderId);const current=await tx.swapCreditPurchase.findUniqueOrThrow({where:{id}});ensure(!customerId||current.customerId===customerId,404,'NOT_FOUND','购买记录不存在');if(current.status==='VOID')return purchaseView(tx,current,this.clock(),!customerId);ensure(current.status==='PENDING_PAYMENT'&&!await tx.payment.count({where:{billId:p.billId,status:{in:['CREATING','PENDING','SUCCEEDED']}}}),409,'SWAP_PAYMENT_UNRESOLVED','原支付仍未确认关闭或已到账，请查询并核账');await tx.bill.update({where:{id:p.billId},data:{status:'VOID'}});const closed=await tx.swapCreditPurchase.update({where:{id},data:{status:'VOID'}});await audit(tx,actorId,'CLOSE_SWAP_PURCHASE','swap-credit-purchases',id,input,customerId?'CUSTOMER':'ADMIN');return purchaseView(tx,closed,this.clock(),!customerId);});
 }
}
