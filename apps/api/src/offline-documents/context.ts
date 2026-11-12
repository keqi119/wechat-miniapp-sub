import {frozenPartyDetails} from './parties';
import {resolveRenewalCancellationContext} from './renewal-cancellation-context';
import {cooperationBusinessHash} from './snapshot';
import {Injectable} from '@nestjs/common';
import {hash} from '../common/data';
import {ensure} from '../common/errors';
import {platformLegalEntity} from '../common/platform-legal-entity';
import {orderBusinessHash} from './readiness';
import {readTerminationContext} from './termination';
import {resolveAmendmentContext} from './amendment-context';
export function archiveOwnerId(order:any){return order.finalPlanSnapshot?.partiesSnapshot?.find?.((p:any)=>p.role==='OWNER')?.partyId||order.finalPlanSnapshot?.lessorSnapshot?.ownerId||order.finalPlanSnapshot?.ownerId;}
@Injectable()
export class ArchiveContextService {
 async resolve(tx:any,archive:any,scope?:any){
  if(archive.kind==='RENEWAL_CANCELLATION'||archive.subjectType==='ORDER_RENEWAL_CANCELLATION')return resolveRenewalCancellationContext(tx,archive,scope);
  if(archive.subjectType==='ORDER_CHANGE_QUOTE'||archive.kind==='ORDER_AMENDMENT')return resolveAmendmentContext(tx,archive);
  if(archive.subjectType==='OWNER'){
   const owner=await tx.vehicleOwner.findUnique({where:{id:archive.subjectId}});ensure(owner,404,'NOT_FOUND','车主不存在');
   ensure(scope?.vehicleIds?.length,400,'VALIDATION','合作文件须声明车辆与有效期');
   ensure(new Set(scope.vehicleIds).size===scope.vehicleIds.length,409,'ARCHIVE_SNAPSHOT_MISMATCH','合作文件车辆范围重复');
   for(const vehicleId of scope.vehicleIds){const binding=await tx.ownerVehicle.findUnique({where:{vehicleId}});if(binding?.ownerId===owner.id&&binding.status==='APPROVED')continue;const proposal=await tx.partnerVehicleBindingProposal.findFirst({where:{ownerId:owner.id,vehicleId,status:'SUBMITTED'},orderBy:{createdAt:'desc'}});ensure(proposal&&proposal.bindingRevision===(binding?.revision||0),409,'ARCHIVE_SNAPSHOT_MISMATCH','合作文件车辆须有当前出租权限材料提案');}
   return{terminationContext:undefined,ownerId:owner.id,orderId:null,handoverId:null,businessSnapshotHash:cooperationBusinessHash(owner.id,owner.revision,scope),partiesSnapshot:[{role:'OWNER',partyId:owner.id,name:owner.name,subjectType:owner.subjectType,creditCode:owner.creditCode,phone:owner.subjectType==='INDIVIDUAL'?owner.contactPhone:undefined},{role:'PLATFORM',partyId:platformLegalEntity(),name:platformLegalEntity(),subjectType:'ENTERPRISE'}],requiredSigners:['OWNER','PLATFORM'],scopeSnapshot:scope};
  }
  const handover=archive.subjectType==='HANDOVER'?await tx.handover.findUnique({where:{id:archive.subjectId}}):null;
  if(archive.subjectType==='HANDOVER')ensure(handover,404,'NOT_FOUND','交接不存在');
  const orderId=handover?.orderId||archive.subjectId,order=await tx.order.findUnique({where:{id:orderId}});ensure(order,404,'NOT_FOUND','订单不存在');
  ensure(order.contractMode==='OFFLINE',409,'OFFLINE_ARCHIVE_REQUIRED','仅线下模式订单可建立线下档案');
  const ownerId=archiveOwnerId(order);ensure(ownerId,409,'ARCHIVE_SNAPSHOT_MISMATCH','订单缺少冻结出租方');
  let businessHash=order.finalPlanSnapshot?.commercialHash||'',businessSnapshot=order.finalPlanSnapshot;if(order.effectiveTermsVersionId&&archive.kind!=='RENTAL'){const terms=await tx.orderTermsVersion.findUnique({where:{id:order.effectiveTermsVersionId}});ensure(terms&&terms.orderId===order.id&&/^[a-f0-9]{64}$/.test(terms.hash)&&terms.snapshot,409,'TERMS_MISSING','当前有效商业条款缺失或归属不匹配');businessHash=terms.hash;businessSnapshot=terms.snapshot;}
  ensure(/^[a-f0-9]{64}$/.test(businessHash),409,'ARCHIVE_SNAPSHOT_MISMATCH','订单商业快照缺失');
  const parties=order.finalPlanSnapshot?.partiesSnapshot;
  const partiesSnapshot=frozenPartyDetails(Array.isArray(parties)?parties:[{role:'CUSTOMER',partyId:order.customerId},{role:'OWNER',partyId:ownerId,name:order.finalPlanSnapshot?.lessorSnapshot?.name},{role:'PLATFORM',partyId:platformLegalEntity(),name:platformLegalEntity(),subjectType:'ENTERPRISE'}],order.finalPlanSnapshot);
  const requiredSigners=handover?['CUSTOMER','PLATFORM']:['CUSTOMER','OWNER','PLATFORM'];
  const scopeVehicleId=archive.kind==='RENTAL'?(businessSnapshot?.lessorSnapshot?.vehicleId||businessSnapshot?.vehicleId||(!order.effectiveTermsVersionId?order.vehicleId:null)):order.vehicleId;ensure(scopeVehicleId,409,'ARCHIVE_SNAPSHOT_MISMATCH','原合同缺少可核对的冻结车辆，不能使用换入车辆补写');
  const terminationContext=archive.kind==='TERMINATION'?await readTerminationContext(tx,order):undefined;
  return{...(terminationContext?{terminationContext}:{}),ownerId,orderId:order.id,handoverId:handover?.id||null,customerId:order.customerId,businessSnapshotHash:handover?handover.manifestHash:businessHash,businessSnapshot:handover?{readingKm:handover.readingKm,actualAt:handover.actualAt,checklist:handover.checklist,fileIds:handover.fileIds,manifestHash:handover.manifestHash}:businessSnapshot,partiesSnapshot,requiredSigners,scopeSnapshot:handover?{handoverId:handover.id,manifestHash:handover.manifestHash,revision:handover.revision,vehicleId:handover.vehicleId||order.vehicleId}:{vehicleId:scopeVehicleId,...(archive.kind==='TERMINATION'&&scope?.terminationDetails?{terminationDetails:scope.terminationDetails}:{})}};
 }
}

