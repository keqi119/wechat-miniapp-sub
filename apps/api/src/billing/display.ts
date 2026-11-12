/** Read-only bill labels. Payment eligibility and money calculations remain elsewhere. */
type Period={sequence:number;startDate:string|null;endDate:string|null;basis:'ACTUAL'|'AGREED'|'PENDING_HANDOVER'|'UNVERIFIED'};
const day=(value:any)=>{const d=value instanceof Date?value:new Date(value);return value&&Number.isFinite(d.getTime())?d.toISOString().slice(0,10):null;};
const sequence=(value:any)=>Number.isSafeInteger(value)&&value>0;
function interval(row:any,basis:Period['basis']):Period|null{
 const startDate=day(row?.startDate),endDate=day(row?.endDate);
 return sequence(row?.sequence)&&startDate&&endDate&&startDate<endDate?{sequence:row.sequence,startDate,endDate,basis}:null;
}
export async function withBillPeriods(tx:any,bills:any[],knownOrder?:any){
 if(!bills.length)return [];
 const orderIds=[...new Set(bills.map(b=>b.orderId))],ids=bills.map(b=>b.id);
 const [orders,periods,obligations]=await Promise.all([
  knownOrder&&orderIds.length===1&&knownOrder.id===orderIds[0]?[knownOrder]:tx.order.findMany({where:{id:{in:orderIds}},select:{id:true,customerId:true,status:true}}),
  tx.usagePeriod.findMany({where:{orderId:{in:orderIds}},select:{orderId:true,sequence:true,startDate:true,endDate:true,billId:true,serviceStageId:true}}),
  tx.serviceObligation.findMany({where:{chargeBillId:{in:ids}},select:{orderId:true,sequence:true,startDate:true,endDate:true,chargeBillId:true,serviceStageId:true}}),
 ]);
 return bills.map(b=>{
  const order=orders.find((o:any)=>o.id===b.orderId&&o.customerId===b.customerId);
  if(!order)return {...b,period:null};
  const actual=periods.filter((p:any)=>p.orderId===b.orderId&&(b.type==='SUBSCRIPTION'?p.sequence===b.sequence&&(!b.serviceStageId||p.serviceStageId===b.serviceStageId):p.billId===b.id));
  const agreed=obligations.filter((o:any)=>o.orderId===b.orderId&&o.chargeBillId===b.id&&(!b.serviceStageId||o.serviceStageId===b.serviceStageId));
  let period=actual.length===1?interval(actual[0],'ACTUAL'):null;
  if(!period&&agreed.length===1)period=interval(agreed[0],'AGREED');
  if(!period&&b.type==='SUBSCRIPTION'&&sequence(b.sequence))period={sequence:b.sequence,startDate:null,endDate:null,basis:['AWAITING_CONTRACT_REVIEW','AWAITING_SIGNATURE','AWAITING_PAYMENT','AWAITING_HANDOVER'].includes(order.status)?'PENDING_HANDOVER':'UNVERIFIED'};
  return {...b,period};
 });
}
export function billReason(b:any):string{
 if(b.type==='SUBSCRIPTION')return b.period?.sequence===1?'首期租金':sequence(b.period?.sequence)?`第${b.period.sequence}期租金`:'租金';
 return ({DEPOSIT:'押金',DEPOSIT_ADJUSTMENT:'押金调整',SWAP_ADJUSTMENT:'换车补差',DELAY_ADJUSTMENT:'延期费用',RETURN_SETTLEMENT:'还车结算费用',MILEAGE_EXCESS:'超里程费用',EXTRA_FEE:'附加费用',MILEAGE_PACK:'里程包费用',SWAP_CREDIT:'换车次数费用',PAYMENT_TEST:'测试支付'} as Record<string,string>)[b.type]||'其他费用';
}
