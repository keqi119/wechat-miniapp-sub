import {recoverSwapQuote} from './recovery';
import {z} from 'zod';
import {key,text,money,hash} from '../common/data';
import {ensure} from '../common/errors';
import {financialContext} from '../order-changes/context';
import {dateOnly} from '../billing/rules';
import {day,shanghaiDay} from '../usage/rules';
import {currentAssignment} from './assignments';
import {reserveCredit,releaseCredits} from './credits';
const date=z.string().refine(v=>{try{dateOnly(v);return true;}catch{return false;}});
export const swapQuoteDto=z.object({revision:z.number().int().nonnegative(),idempotencyKey:key,targetVehicleId:text,plannedReturnAt:z.string().datetime({offset:true}),plannedDeliveryAt:z.string().datetime({offset:true}),newMonthlyFeeAmount:money.positive(),depositAmount:money,periods:z.array(z.object({sequence:z.number().int().positive(),amount:money,dueDate:date,calculationBasis:text}).strict()).min(1).max(120),handoverFeeAmount:money,handoverFeeBasis:text,depositBasis:text,insuranceResponsibility:text,downtimeArrangement:text,settlementExplanation:text,handoverArrangement:text,cancellationTerms:text,reason:text,expiresAt:z.string().datetime({offset:true}),externalCompensationRequired:z.boolean()}).strict();
export const vehicleIdentity=(v:any)=>`${v.title}；VIN：${v.vin||'未登记'}；车牌：${v.plateNumber||'未登记'}；车况：${v.conditionDisclosure||'未披露'}`;
export async function releaseHold(tx:any,changeId:string){const holds=await tx.vehicleHold.findMany({where:{changeId,status:'HELD'}});for(const h of holds){await tx.vehicle.updateMany({where:{id:h.vehicleId,holdId:h.id},data:{holdId:null}});await tx.vehicleHold.update({where:{id:h.id},data:{status:'RELEASED',releasedAt:new Date()}});}await releaseCredits(tx,changeId);}
export async function swapQuote(tx:any,change:any,input:any,actor:any){
 ensure(!input.externalCompensationRequired,409,'MANUAL_FINANCE_REQUIRED','额外赔付须人工财务处理，不能记作已核清');
 const active=change.activeQuoteId?await tx.delayQuote.findUnique({where:{id:change.activeQuoteId},include:{contract:true}}):null;
 if((['AWAITING_FINANCE','SWAP_RETURNED'].includes(change.status)&&active?.contract?.status==='SIGNED')||(active?.snapshot.financeSourceQuoteId&&['DRAFT','REVIEW_PENDING','REVIEWED'].includes(change.status)))return recoverSwapQuote(tx,change,active,input,actor);
 const reopen=change.status==='AWAITING_SIGNATURE'&&(['REJECTED','EXPIRED'].includes(active?.contract?.status)||(active?.contract?.status==='DRAFT'&&!active.contract.providerTaskId&&!active.contract.signingLeaseUntil));
 ensure(['DRAFT','REVIEW_PENDING','REVIEWED'].includes(change.status)||(change.status==='AWAITING_CONFIRMATION'&&new Date(active?.snapshot.expiresAt)<=new Date())||reopen,409,'CHANGE_STATE','当前换车报价不可重出');
 ensure(!/待确认|待补齐|待填写|另行通知|\{\{|\}\}/.test(JSON.stringify(input)),400,'COMMERCIAL_INCOMPLETE','请逐单明确真实条款');
 const order=await tx.order.findUniqueOrThrow({where:{id:change.orderId}}),account=await tx.usageAccount.findUniqueOrThrow({where:{orderId:order.id}}),old=await currentAssignment(tx,order),funds=await financialContext(tx,order);
 ensure(order.status==='ACTIVE'&&!account.returnedOn&&old,409,'SWAP_STATE','须有当前实际用车分配');ensure(!funds.blockers.length,409,'FUNDS_UNCONFIRMED',funds.blockers.join('；'));
 const returned=new Date(input.plannedReturnAt),delivered=new Date(input.plannedDeliveryAt),expires=new Date(input.expiresAt);
 ensure(returned>=old.startAt&&delivered>=returned&&expires>new Date(),400,'SWAP_DATES','计划日期顺序或有效期不正确');
 const affected=funds.rows.find((r:any)=>r.startDate<=shanghaiDay(delivered)&&shanghaiDay(delivered)<r.endDate);ensure(affected,409,'SWAP_OUTSIDE_TERM','新车交付须在原服务期限内');
 ensure(await tx.usagePeriod.count({where:{orderId:order.id,status:'SETTLED',effectiveEndDate:{gt:new Date(shanghaiDay(returned))}}})===0,409,'SETTLED_USAGE_IMMUTABLE','换车不可回溯已结算月份');
 ensure(input.periods.length===funds.rows.length&&new Set(input.periods.map((r:any)=>r.sequence)).size===funds.rows.length,400,'PERIODS_REQUIRED','须列明全部原服务期');
 const rows=funds.rows.map((r:any)=>{const x=input.periods.find((i:any)=>i.sequence===r.sequence);ensure(x,400,'PERIODS_REQUIRED','期数不完整');if(r.sequence<affected.sequence)ensure(x.amount===r.amount&&x.dueDate===r.dueDate,409,'HISTORICAL_MONEY_IMMUTABLE','已经履行的更早服务月份不可改价');return{...x,startDate:r.startDate,endDate:r.endDate,originalAmount:r.amount,netPaidAmount:r.netPaidAmount,carryAmount:Math.min(x.amount,r.netPaidAmount),chargeAmount:Math.max(0,x.amount-r.netPaidAmount),refundAmount:Math.max(0,r.netPaidAmount-x.amount)};});
 const target=await tx.vehicle.findUnique({where:{id:input.targetVehicleId}});ensure(target&&target.id!==old.vehicleId&&target.status==='PUBLISHED'&&!target.reservedOrderId,409,'VEHICLE_UNAVAILABLE','目标车辆不可用');const held=target.holdId?await tx.vehicleHold.findUnique({where:{id:target.holdId}}):null;ensure(!held||held.changeId===change.id,409,'VEHICLE_UNAVAILABLE','目标车辆已被其他换车预留');
 // Serialize every stock consumer through the physical vehicle row.
 await tx.vehicle.update({where:{id:target.id},data:{updatedAt:new Date()}});
 const deposits=await tx.payment.findMany({where:{customerId:order.customerId,status:'SUCCEEDED',bill:{orderId:order.id,type:{in:['DEPOSIT','DEPOSIT_ADJUSTMENT']}}},include:{refunds:true},orderBy:{id:'asc'}});
 const depositFunds=deposits.map((p:any)=>({id:p.id,amount:p.amount,net:p.amount-p.refunds.filter((r:any)=>r.status==='SUCCEEDED').reduce((n:number,r:any)=>n+r.amount,0)})),net=depositFunds.reduce((n:number,p:any)=>n+p.net,0);
 const {revision:_,idempotencyKey:__,periods:___,...fields}=input;
 const snapshot={...fields,financialGate:'BEFORE_RETURN',newStartDate:String(change.priorTerms.startDate).slice(0,10),newEndDate:day(new Date(new Date(funds.rows.at(-1)!.endDate).getTime()-86400000)),months:change.priorTerms.months,periods:rows,originalAssignmentId:old.id,oldVehicleIdentification:vehicleIdentity(old.vehicle),targetVehicleIdentification:vehicleIdentity(target),targetVehicleTitle:target.title,affectedSequence:affected.sequence,depositNetPaidAmount:net,depositChargeAmount:Math.max(0,input.depositAmount-net),depositRefundAmount:Math.max(0,net-input.depositAmount),depositFunds,document:null};
 const revision=((await tx.delayQuote.aggregate({where:{changeId:change.id},_max:{revision:true}}))._max.revision||0)+1;
 await releaseHold(tx,change.id);if(active)await tx.delayQuote.update({where:{id:active.id},data:{status:'SUPERSEDED'}});
 const quote=await tx.delayQuote.create({data:{changeId:change.id,revision,commercialHash:hash({priorTermsHash:change.priorTermsHash,snapshot}),snapshot,fundsSnapshot:funds.rows,createdBy:actor.id}});
 const hold=await tx.vehicleHold.create({data:{vehicleId:target.id,orderId:order.id,changeId:change.id,quoteId:quote.id,expiresAt:expires}});await tx.vehicle.update({where:{id:target.id},data:{holdId:hold.id}});await reserveCredit(tx,order,account,change.id,delivered);
 await tx.orderChange.update({where:{id:change.id},data:{activeQuoteId:quote.id,targetVehicleId:target.id,status:'REVIEW_PENDING'}});
}
