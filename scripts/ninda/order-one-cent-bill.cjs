/* Scoped maintenance command, not a general fee/review override. No provider calls. */
'use strict';
const TYPE='PAYMENT_TEST';
const DESCRIPTION='支付链路测试账单（0.01元）：由客户本人发起付款，仅验证本订单支付链路，不冲抵租金或押金。';

async function createOneCentBill(db,actor,scope,now,deps){
 const {ensure,hash,requireCurrentStaff,lockOrder,requireContractReady,readDelayPaymentGuard,audit,notify}=deps;
 ensure(actor?.role==='ADMIN',403,'FORBIDDEN','测试账单仅由平台管理员按明确授权登记');
 ensure(scope?.orderId&&scope.customerId&&Number.isInteger(scope.revision)&&/^[a-f0-9]{64}$/.test(scope.orderHash||'')&&scope.idempotencyKey&&scope.authorizationReference,400,'TEST_SCOPE_REQUIRED','须绑定订单、客户、当前版本和用户授权');
 const dueDate=new Date(new Date(now.getTime()+8*3600000).toISOString().slice(0,10)+'T00:00:00.000Z');
 return db.serial(async tx=>{
  await requireCurrentStaff(tx,actor,'bills');
  await lockOrder(tx,scope.orderId);
  const order=await tx.order.findUniqueOrThrow({where:{id:scope.orderId}});
  ensure(order.customerId===scope.customerId,409,'TEST_CUSTOMER_CHANGED','订单客户已变化');
  const existing=await tx.bill.findUnique({where:{orderId_idempotencyKey:{orderId:scope.orderId,idempotencyKey:scope.idempotencyKey}}});
  if(existing){ensure(existing.type===TYPE&&existing.amount===1&&existing.customerId===scope.customerId&&existing.description===DESCRIPTION,409,'IDEMPOTENCY_CONFLICT','原测试记录不匹配');return{bill:existing,created:false};}
  ensure(order.revision===scope.revision&&hash(order)===scope.orderHash,409,'ORDER_CHANGED','订单已变化，请重新核对');
  ensure(order.status==='AWAITING_PAYMENT'&&order.contractMode==='OFFLINE',409,'TEST_ORDER_STATE','仅本次已线下归档的待支付订单可登记测试账单');
  ensure(!(await tx.bill.count({where:{orderId:order.id,type:TYPE}})),409,'TEST_BILL_EXISTS','本订单已登记支付测试账单');
  ensure(!(await tx.payment.count({where:{bill:{orderId:order.id},status:{in:['CREATING','PENDING']}}})),409,'PAYMENT_IN_FLIGHT','本订单有处理中付款，请先核对');
  ensure(!(await tx.vehicleReceiptEvent.count({where:{orderId:order.id,isCurrent:true}})),409,'VEHICLE_RETURNED','车辆已收回，不添加付款测试');
  const first=await tx.bill.findFirst({where:{orderId:order.id,type:'SUBSCRIPTION',sequence:1}});
  ensure(first&&first.status==='PENDING'&&first.paidAmount===0,409,'TEST_FIRST_BILL_STATE','首期款状态已变化，请重新核对测试范围');
  await requireContractReady(tx,order.id,'PAYMENT');
  await readDelayPaymentGuard(tx,{orderId:order.id,type:TYPE});
  const bill=await tx.bill.create({data:{orderId:order.id,customerId:order.customerId,type:TYPE,sequence:1,amount:1,paidAmount:0,dueDate,status:'PENDING',description:DESCRIPTION,evidenceFileIds:[],createdBy:actor.id,idempotencyKey:scope.idempotencyKey}});
  await audit(tx,actor.id,'CREATE_AUTHORIZED_PAYMENT_TEST','bills',bill.id,{orderId:order.id,amount:1,type:TYPE,authorizationReference:scope.authorizationReference,originalOrderRevision:scope.revision,originalOrderHash:scope.orderHash,doesNotOffsetRentOrDeposit:true,providerCalls:0});
  await notify(tx,order.customerId,'0.01元支付测试账单','本订单新增一笔0.01元支付链路测试账单，请本人核对金额后主动支付。','bills',bill.id);
  return{bill,created:true};
 });
}
module.exports={createOneCentBill,TYPE,DESCRIPTION};
