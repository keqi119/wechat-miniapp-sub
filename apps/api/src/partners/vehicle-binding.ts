import {z} from 'zod';
import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {PartnerActor,commandInput,lockPartner,partnerCommand,requirePartnerOperator,evidenceFiles,independentPartnerReview} from './types';
export async function assertVehicleUnoccupied(tx:any,vehicleId:string){const vehicle=await tx.vehicle.findUnique({where:{id:vehicleId}});ensure(vehicle,404,'NOT_FOUND','车辆不存在');const occupied=!!vehicle.reservedOrderId||!!vehicle.holdId||await tx.vehicleAssignment.count({where:{vehicleId,status:'ACTIVE'}})>0||await tx.vehicleHold.count({where:{vehicleId,status:'HELD'}})>0||await tx.order.count({where:{vehicleId,status:{notIn:['COMPLETED','CANCELLED']}}})>0||await tx.fieldHandoverTask.count({where:{vehicleId,status:{notIn:['COMPLETED','CANCELLED']}}})>0||await tx.handover.count({where:{order:{vehicleId},status:{notIn:['COMPLETED','SUPERSEDED']}}})>0;ensure(!occupied,409,'PARTNER_VEHICLE_OCCUPIED','车辆有占车、未结束订单或待处理交接，不能更换出租方');return vehicle;}
export class VehicleBindingService{
 async submit(tx:any,ctx:PartnerActor,ownerId:string,vehicleId:string,raw:unknown){
 const input=z.object({...commandInput,evidenceFileId:z.string().min(1)}).strict().parse(raw);await requirePartnerOperator(tx,ctx);await lockPartner(tx,ownerId);await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${vehicleId} FOR UPDATE`;
 return partnerCommand(tx,ctx,ownerId,`VEHICLE_SUBMIT:${vehicleId}`,input,async()=>{await assertVehicleUnoccupied(tx,vehicleId);await evidenceFiles(tx,[input.evidenceFileId]);const old=await tx.ownerVehicle.findUnique({where:{vehicleId}});ensure((old?.revision||0)===input.revision,409,'REVISION_CONFLICT','车辆归属版本已变化');
 const result=await tx.partnerVehicleBindingProposal.create({data:{ownerId,vehicleId,bindingRevision:input.revision,evidenceFileId:input.evidenceFileId,submittedBy:ctx.id}});await audit(tx,ctx.id,'PARTNER_VEHICLE_SUBMITTED','partners',ownerId,{vehicleId,proposalId:result.id});return result;});
 }
 async rebind(tx:any,ctx:PartnerActor,vehicleId:string,raw:unknown){
 const input=z.object({...commandInput,ownerId:z.string().min(1),proposalId:z.string().min(1)}).strict().parse(raw);await requirePartnerOperator(tx,ctx,'partner.cooperation.review');await lockPartner(tx,input.ownerId);await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${vehicleId} FOR UPDATE`;
 return partnerCommand(tx,ctx,input.ownerId,`VEHICLE_REVIEW:${vehicleId}`,input,async()=>{
 await assertVehicleUnoccupied(tx,vehicleId);const old=await tx.ownerVehicle.findUnique({where:{vehicleId}}),proposal=await tx.partnerVehicleBindingProposal.findUnique({where:{id:input.proposalId}});
 ensure((old?.revision||0)===input.revision&&proposal?.status==='SUBMITTED'&&proposal.vehicleId===vehicleId&&proposal.ownerId===input.ownerId&&proposal.bindingRevision===input.revision,409,'REVISION_CONFLICT','车辆归属或待审核材料已变化');
 const files=await evidenceFiles(tx,[proposal.evidenceFileId]);await independentPartnerReview(tx,ctx.id,proposal.submittedBy,files);const now=new Date(),revision=(old?.revision||0)+1;
 await tx.partnerVehicleBindingHistory.updateMany({where:{vehicleId,validUntil:null},data:{validUntil:now}});
 const data={ownerId:input.ownerId,evidenceFileId:proposal.evidenceFileId,createdBy:proposal.submittedBy,status:'APPROVED',reviewedBy:ctx.id,reviewedAt:now,revision};
 const result=await tx.ownerVehicle.upsert({where:{vehicleId},create:{...data,vehicleId},update:data});
 await tx.partnerVehicleBindingHistory.create({data:{ownerId:input.ownerId,vehicleId,bindingRevision:revision,evidenceFileId:proposal.evidenceFileId,submittedBy:proposal.submittedBy,reviewedBy:ctx.id,validFrom:now}});
 await tx.partnerVehicleBindingProposal.update({where:{id:proposal.id},data:{status:'APPROVED',reviewedBy:ctx.id,reviewedAt:now}});
 await audit(tx,ctx.id,'PARTNER_VEHICLE_REVIEWED','partners',input.ownerId,{vehicleId,previousOwnerId:old?.ownerId||null,bindingRevision:revision,proposalId:proposal.id});return result;});
 }
}
