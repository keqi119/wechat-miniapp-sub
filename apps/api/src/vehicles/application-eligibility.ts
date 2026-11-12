import {validTermMonths} from '../service-calendar/rules';
import {HttpException} from '@nestjs/common';
import {ZodError} from 'zod';
import {ensure} from '../common/errors';
import {newOrderContractMode} from '../offline-documents/mode';
import {readOwnerCooperationReady} from '../offline-documents/readiness';
import {approvedPartner} from '../partners/types';
import {readRevenueRuleSnapshot} from '../partners/revenue-rules';
import {leaseRange} from '../orders/business-gates';
import {shanghaiDay} from '../usage/rules';
import {hasSimpleAgreementScope,readSimpleAgreementSnapshot} from '../partners/simple-agreements';
import {hasVehicleRestriction} from './operational-restrictions';

export const applicationUnavailableMessage='车辆暂不可申请，请稍后再试或联系客服。';

/**
 * Preflight a product's term from today's Shanghai date, without persisting a
 * customer lease date. Quoting/confirmation still check the actual full lease.
 * The caller checks vehicle/product status; submission calls this in its serial
 * transaction after the idempotency lookup and before any new customer writes.
 */
export async function applicationCooperationEligible(db:any,vehicleId:string,months:number,at:Date=new Date()):Promise<boolean>{
 if(await hasVehicleRestriction(db,vehicleId,'ALLOCATION'))return false;
 if(!['OFFLINE','ELECTRONIC'].includes(newOrderContractMode()))return true;
 try{
  ensure(validTermMonths(months),409,'PRODUCT_UNAVAILABLE','产品租期无效');
  const range=leaseRange(shanghaiDay(at),months);
  if(await readSimpleAgreementSnapshot(db,vehicleId,range))return true;ensure(newOrderContractMode()!=='ELECTRONIC',409,'ELECTRONIC_COOPERATION_REQUIRED','须有覆盖本车租期的电子合作授权');
  ensure(!await hasSimpleAgreementScope(db,vehicleId),409,'SIMPLE_AGREEMENT_REQUIRED','车辆尚未登记覆盖产品租期的有效合作协议');
  const binding=await db.ownerVehicle.findUnique({where:{vehicleId}});
  ensure(binding?.status==='APPROVED'&&binding.reviewedBy&&binding.reviewedAt,409,'OWNER_VEHICLE_REQUIRED','车辆归属须独立审核');
  const owner=await db.vehicleOwner.findUnique({where:{id:binding.ownerId}});
  ensure(owner,409,'OWNER_BUSINESS_UNVERIFIED','合作商档案不可用');
  await approvedPartner(db,owner);
  const cooperation=await readOwnerCooperationReady(db,owner.id,vehicleId,range.startDate,range.endDate);
  ensure(cooperation.ready,409,'OWNER_COOPERATION_REQUIRED','合作范围未覆盖产品租期');
  await readRevenueRuleSnapshot(db,owner.id,vehicleId,range.startDate,range.endDate);
  return true;
 }catch(error){
  // Only known business validation failures become a safe unavailable display.
  // Database/programming failures propagate; none can enable an application.
  if(error instanceof ZodError||error instanceof HttpException&&[400,403,404,409].includes(error.getStatus()))return false;
  throw error;
 }
}
