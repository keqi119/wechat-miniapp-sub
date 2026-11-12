import {randomUUID} from 'node:crypto';
import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {canonicalHash} from '../customers/types';
import {requireAssetFiles} from '../files/asset-files';
import {completeMaintenance,validateMaintenanceCompletion} from '../vehicle-maintenance/service';
import {workOrderCommand,lockWorkOrder,recordWorkOrderTransition} from './command';
import {financialWorkOrderState,assertFrozenEvidence,iso} from './facts';
import {readServiceSource,requireServiceSourceAccess} from './service-source-options';
import {workId,createWorkOrderInput,createWorkOrderCommandInput,patchWorkOrderInput,workOrderListInput,assigneeListInput,reasonWorkOrderInput,assignWorkOrderInput,submitAcceptanceInput,acceptWorkOrderInput,noteWorkOrderInput,claimWorkOrderInput,restrictWorkOrderInput,releaseWorkOrderInput} from './types';

const live=(row:any)=>ensure(!['CLOSED','CANCELLED'].includes(row.status),409,'WORK_ORDER_STATE','已关闭或取消工单只能追加说明或明确解除原限制');
const expectedState=(row:any,states:string[])=>ensure(states.includes(row.status),409,'WORK_ORDER_STATE','当前工单状态不允许该操作');
const pick=(row:any,keys:string[])=>Object.fromEntries(keys.map(key=>[key,row?.[key]??null]));
const fields=['id','revision','eventSequence','workOrderNo','vehicleId','kind','status','priority','title','description','sourceServiceRequestId','relatedWorkOrderId','assignedStaffId','providerName','contact','costConfirmationRequired','noCostReason','solution','submittedBy','submittedRevision','acceptedBy','acceptedRevision','acceptedEventId','closedBy','cancelledBy','cancelReason','accidentLocation','accidentDescription','insurerName','claimNumber','claimStatus','createdBy','updatedBy'];
const dates=['occurredAt','scheduledAt','submittedAt','acceptedAt','closedAt','cancelledAt','accidentAt','createdAt','updatedAt'];
const operationalEvents=new Set(['CREATE','UPDATE','ASSIGN','START','WAIT','RESUME','SUBMIT_ACCEPTANCE','ACCEPT','RETURN_FOR_WORK','CANCEL','NOTE','CLAIM','RESTRICT','RELEASE_RESTRICTION']);
const eventFields=['reason','note','status','beforeStatus','fields','assigneeId','providerName','contact','scheduledAt','solution','maintenance','evidence','restrictionId','scopes','vehicleRevision','insurerName','claimNumber','claimStatus','submissionEventId','eventId'];
function eventView(row:any){return{...pick(row,['id','sequence','action','actorId','beforeRevision','afterRevision','sourceHash']),actorAt:iso(row.actorAt),...(operationalEvents.has(row.action)?{detailSnapshot:Object.fromEntries(eventFields.filter(field=>Object.hasOwn(row.detailSnapshot||{},field)).map(field=>[field,row.detailSnapshot[field]]))}:{})};}
function workOrderView(row:any){return{...pick(row,fields),...Object.fromEntries(dates.map(key=>[key,iso(row[key])])),costReviewStatus:!row.costConfirmationRequired?'NOT_REQUIRED':row.status==='CLOSED'?'CONFIRMED':row.acceptedAt&&row.status!=='PENDING_COST_CONFIRMATION'?'CORRECTION_REQUIRED':'PENDING',sourceServiceSnapshot:row.sourceServiceSnapshot?pick(row.sourceServiceSnapshot,['serviceRequestId','orderId','customerId','assignmentId','vehicleId','eventAt','assignmentStartAt','assignmentEndAt','deliveryHandoverId','returnHandoverId']):null,maintenance:row.submissionSnapshot?.maintenance??null};}
export class WorkOrdersService{
 constructor(private readonly now:()=>Date=()=>new Date()){}
 async list(tx:any,actor:StaffActor,body:unknown){
  await requireCurrentStaff(tx,actor,'asset-work-orders',false);const input=workOrderListInput.parse(body),where:any={};
  for(const key of ['vehicleId','kind','status','priority']as const)if(input[key])where[key]=input[key];if(input.assigneeId)where.assignedStaffId=input.assigneeId;if(input.keyword)where.OR=['title','workOrderNo'].map(field=>({[field]:{contains:input.keyword,mode:'insensitive'}}));
  const rows=await tx.assetWorkOrder.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize});
  return{items:rows.map(workOrderView),total:await tx.assetWorkOrder.count({where}),page:input.page,pageSize:input.pageSize};
 }
 async assigneeOptions(tx:any,actor:StaffActor,body:unknown){
  await requireCurrentStaff(tx,actor,'asset-work-orders',false);const input=assigneeListInput.parse(body),where:any={active:true,role:{in:['ADMIN','OPERATIONS']}};
  if(input.keyword)where.OR=['id','name'].map(field=>({[field]:{contains:input.keyword,mode:'insensitive'}}));
  const items=await tx.adminUser.findMany({where,select:{id:true,name:true,role:true},orderBy:[{name:'asc'},{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize});
  return{items:items.map((row:any)=>pick(row,['id','name','role'])),total:await tx.adminUser.count({where}),page:input.page,pageSize:input.pageSize};
 }
 async detail(tx:any,actor:StaffActor,id:string){
  await requireCurrentStaff(tx,actor,'asset-work-orders',false);const workOrderId=workId.parse(id),row=await tx.assetWorkOrder.findUnique({where:{id:workOrderId}});ensure(row,404,'NOT_FOUND','工单不存在');
  const vehicle=await tx.vehicle.findUnique({where:{id:row.vehicleId}}),events=await tx.assetWorkOrderEvent.findMany({where:{workOrderId},orderBy:{sequence:'asc'}}),restrictions=await tx.vehicleOperationalRestriction.findMany({where:{workOrderId},orderBy:[{createdAt:'desc'},{id:'asc'}]});
  const files=await requireAssetFiles(tx,actor,{kind:'WORK_ORDER',resourceId:workOrderId});
  return{...workOrderView(row),vehicle:pick(vehicle,['id','title','vin','plateNumber']),vehicleRevision:vehicle?.revision??null,events:events.map(eventView),restrictions:restrictions.map((item:any)=>({...pick(item,['id','revision','status','scopes','reason','createdBy','releasedBy','releaseReason','evidenceFileIds','releaseEvidenceFileIds']),createdAt:iso(item.createdAt),releasedAt:iso(item.releasedAt)})),files};
 }
 async create(tx:any,actor:StaffActor,body:unknown){
  const input=createWorkOrderCommandInput.parse(body);
  if(input.sourceServiceRequestId!==null)await requireServiceSourceAccess(tx,actor);
  return workOrderCommand(tx,actor,'asset-work-orders','create','CREATE',input,async()=>{
   createWorkOrderInput.parse(input);
   await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${input.vehicleId} FOR UPDATE`;
   const vehicle=await tx.vehicle.findUnique({where:{id:input.vehicleId}});ensure(vehicle,404,'NOT_FOUND','车辆不存在');ensure(vehicle.revision===input.vehicleRevision,409,'REVISION_CONFLICT','车辆资料已变化');
   const now=this.now(),occurredAt=new Date(input.occurredAt),accidentAt=input.accident?new Date(input.accident.accidentAt):null;ensure(occurredAt<=now&&(!accidentAt||accidentAt<=now),400,'WORK_ORDER_DATE','发生时间不得晚于当前时间');
   let sourceServiceSnapshot:any=null;
   if(input.sourceServiceRequestId!==null){
    await tx.$queryRaw`SELECT id FROM "ServiceRequest" WHERE id=${input.sourceServiceRequestId} FOR UPDATE`;
    const selected=await readServiceSource(tx,input.sourceServiceRequestId,input.vehicleId,accidentAt??occurredAt);
    ensure(selected.row.revision===input.sourceServiceRequestRevision&&selected.sourceHash===input.sourceServiceRequestHash,409,'SERVICE_SOURCE_CHANGED','客户服务来源或事件归属已变化，请重新读取并核对');
    sourceServiceSnapshot={...selected.snapshot,sourceRevision:selected.row.revision,sourceHash:selected.sourceHash};
   }
   if(input.relatedWorkOrderId){const related=await tx.assetWorkOrder.findUnique({where:{id:input.relatedWorkOrderId}});ensure(related?.vehicleId===input.vehicleId,409,'WORK_ORDER_RELATION','关联工单须属于同一车辆');}
   const id=randomUUID(),eventId=randomUUID(),snapshot={vehicleId:input.vehicleId,kind:input.kind,title:input.title,description:input.description,priority:input.priority,occurredAt:input.occurredAt,costConfirmationRequired:input.costConfirmationRequired,noCostReason:input.noCostReason,sourceServiceSnapshot,relatedWorkOrderId:input.relatedWorkOrderId,accident:input.accident};
   await tx.assetWorkOrder.create({data:{id,revision:0,eventSequence:1,workOrderNo:'WO-'+randomUUID(),vehicleId:input.vehicleId,kind:input.kind,status:'PENDING',priority:input.priority,title:input.title,description:input.description,occurredAt,sourceServiceRequestId:input.sourceServiceRequestId,sourceServiceSnapshot:sourceServiceSnapshot??undefined,relatedWorkOrderId:input.relatedWorkOrderId,costConfirmationRequired:input.costConfirmationRequired,noCostReason:input.noCostReason,...(input.accident?{accidentAt,accidentLocation:input.accident.location,accidentDescription:input.accident.description,claimStatus:'NOT_REPORTED'}:{}),createdBy:actor.id,updatedBy:actor.id,createdAt:now,updatedAt:now}});
   const sourceHash=canonicalHash(snapshot);await tx.assetWorkOrderEvent.create({data:{id:eventId,workOrderId:id,sequence:1,action:'CREATE',actorId:actor.id,actorAt:now,beforeRevision:null,afterRevision:0,detailSnapshot:snapshot,sourceHash}});
   await audit(tx,actor.id,'WORK_ORDER_CREATE','asset-work-orders',id,{eventId,sequence:1,revision:0,sourceHash});return this.detail(tx,actor,id);
  });
 }
 async patch(tx:any,actor:StaffActor,id:string,body:unknown){
  workId.parse(id);const input=patchWorkOrderInput.parse(body);
  return workOrderCommand(tx,actor,'asset-work-orders',id,'UPDATE',input,async()=>{
   const row=await lockWorkOrder(tx,id,input.revision);expectedState(row,['PENDING']);const changes:any={};for(const field of ['title','description','priority','costConfirmationRequired','noCostReason'])if(Object.hasOwn(input,field))changes[field]=(input as any)[field];
   if(Object.hasOwn(changes,'costConfirmationRequired')||Object.hasOwn(changes,'noCostReason')){
    ensure(!(await financialWorkOrderState(tx,id)).hasAny,409,'WORK_ORDER_COST_PENDING','已有费用来源，不能改写成本确认要求');
    const required=changes.costConfirmationRequired??row.costConfirmationRequired,reason=Object.hasOwn(changes,'noCostReason')?changes.noCostReason:row.noCostReason;ensure(required?reason===null:typeof reason==='string'&&reason.trim().length>0,400,'VALIDATION','无需成本确认必须明确无成本原因');
   }
   await recordWorkOrderTransition(tx,actor,row,'UPDATE',changes,{fields:changes},this.now());return this.detail(tx,actor,id);
  });
 }
 async action(tx:any,actor:StaffActor,id:string,action:string,body:unknown){
  workId.parse(id);const schemas:any={assign:assignWorkOrderInput,start:reasonWorkOrderInput,wait:reasonWorkOrderInput,resume:reasonWorkOrderInput,'submit-acceptance':submitAcceptanceInput,accept:acceptWorkOrderInput,'return-for-work':reasonWorkOrderInput,cancel:reasonWorkOrderInput,notes:noteWorkOrderInput,claim:claimWorkOrderInput};ensure(Object.hasOwn(schemas,action),400,'VALIDATION','未知工单动作');const input=schemas[action].parse(body);
  return workOrderCommand(tx,actor,'asset-work-orders',id,action.toUpperCase().replaceAll('-','_'),input,async()=>{
   const row=await lockWorkOrder(tx,id,input.revision),now=this.now(),vehicle=await tx.vehicle.findUnique({where:{id:row.vehicleId}});ensure(vehicle,409,'WORK_ORDER_RELATION','工单车辆不存在');
   if(action!=='notes')live(row);
   let changes:any={},detail:any={reason:input.reason??null,beforeStatus:row.status},eventAction=action.toUpperCase().replaceAll('-','_'),eventId=randomUUID();
   if(action==='assign'){
    await tx.$queryRaw`SELECT id FROM "AdminUser" WHERE id=${input.assigneeId} FOR SHARE`;
    const assignee=await tx.adminUser.findUnique({where:{id:input.assigneeId}});ensure(assignee?.active&&['ADMIN','OPERATIONS'].includes(assignee.role),409,'ASSIGNEE_INVALID','只能指派当前有效管理员或运营');
    changes={assignedStaffId:assignee.id,providerName:input.providerName,contact:input.contact,scheduledAt:input.scheduledAt?new Date(input.scheduledAt):null};detail={...detail,assigneeId:assignee.id,providerName:input.providerName,contact:input.contact,scheduledAt:input.scheduledAt};
   }else if(action==='start'||action==='wait'||action==='resume'){
    const from={start:'PENDING',wait:'IN_PROGRESS',resume:'WAITING_EXTERNAL'}[action],to={start:'IN_PROGRESS',wait:'WAITING_EXTERNAL',resume:'IN_PROGRESS'}[action];expectedState(row,[from]);changes.status=to;detail.status=to;
   }else if(action==='submit-acceptance'){
    expectedState(row,['IN_PROGRESS']);ensure((row.kind==='MAINTENANCE')===(input.maintenance!==undefined),400,'VALIDATION','保养工单须明确完成资料，其他工单不得填写');
    const evidence=await requireAssetFiles(tx,actor,{kind:'WORK_ORDER',resourceId:id,fileIds:input.fileIds,required:true}),maintenance=input.maintenance?await validateMaintenanceCompletion(tx,vehicle,input.maintenance,now):null;
    const snapshot={version:1,eventId,workOrderId:id,vehicleId:row.vehicleId,solution:input.solution,evidence,maintenance};
    changes={status:'PENDING_ACCEPTANCE',solution:input.solution,submissionSnapshot:snapshot,submissionEvidenceFileIds:input.fileIds,submittedBy:actor.id,submittedAt:now,submittedRevision:row.revision+1};detail={solution:input.solution,maintenance,evidence,eventId,status:changes.status};
   }else if(action==='accept'){
    expectedState(row,['PENDING_ACCEPTANCE']);ensure(row.submissionSnapshot?.workOrderId===id&&row.submissionSnapshot?.vehicleId===row.vehicleId&&row.submittedAt,409,'WORK_ORDER_EVIDENCE_CHANGED','缺少有效提交事实');
    const submitted=await requireAssetFiles(tx,actor,{kind:'WORK_ORDER',resourceId:id,fileIds:row.submissionEvidenceFileIds,required:true});assertFrozenEvidence(submitted,row.submissionSnapshot.evidence);
    const evidence=await requireAssetFiles(tx,actor,{kind:'WORK_ORDER',resourceId:id,fileIds:input.fileIds,required:true});
    if(!row.costConfirmationRequired){const state=await financialWorkOrderState(tx,id);ensure(!state.pending&&!state.effective&&!state.hasAny,409,'WORK_ORDER_COST_PENDING','无成本关单须无任何待处理或已发生费用来源');ensure(row.noCostReason,409,'WORK_ORDER_COST_PENDING','缺少明确无成本原因');}
    const maintenance=row.kind==='MAINTENANCE'?await completeMaintenance(tx,actor,row,vehicle,row.submissionSnapshot.maintenance,now):null;
    const snapshot={version:1,eventId,workOrderId:id,vehicleId:row.vehicleId,submissionEventId:row.submissionSnapshot.eventId,submissionRevision:row.submittedRevision,solution:row.solution,maintenance,evidence,reason:input.reason};
    changes={status:row.costConfirmationRequired?'PENDING_COST_CONFIRMATION':'CLOSED',acceptanceSnapshot:snapshot,acceptanceEvidenceFileIds:input.fileIds,acceptedBy:actor.id,acceptedAt:now,acceptedRevision:row.revision+1,acceptedEventId:eventId,...(!row.costConfirmationRequired?{closedBy:actor.id,closedAt:now}:{})};detail={...snapshot,status:changes.status};
   }else if(action==='return-for-work'){
    expectedState(row,['PENDING_ACCEPTANCE','PENDING_COST_CONFIRMATION']);changes.status='IN_PROGRESS';detail.status=changes.status;
   }else if(action==='cancel'){
    ensure(!await tx.vehicleOperationalRestriction.count({where:{workOrderId:id,status:'ACTIVE'}}),409,'WORK_ORDER_RESTRICTED','须先明确解除有效车辆限制');
    const state=await financialWorkOrderState(tx,id);ensure(!state.pending&&!state.effective,409,'WORK_ORDER_COST_PENDING','尚有待处理费用或未冲正成本，不能取消');changes={status:'CANCELLED',cancelledBy:actor.id,cancelledAt:now,cancelReason:input.reason};detail.status=changes.status;
   }else if(action==='notes'){eventAction='NOTE';detail={note:input.note};}
   else if(action==='claim'){
    ensure(row.kind==='ACCIDENT_REPAIR',409,'WORK_ORDER_KIND','仅事故工单可登记理赔结论');const evidence=await requireAssetFiles(tx,actor,{kind:'WORK_ORDER',resourceId:id,fileIds:input.fileIds,required:true});changes={insurerName:input.insurerName,claimNumber:input.claimNumber,claimStatus:input.claimStatus};detail={...detail,...changes,evidence};
   }
   await recordWorkOrderTransition(tx,actor,row,eventAction,changes,detail,now,eventId);return this.detail(tx,actor,id);
  });
 }
 async restrict(tx:any,actor:StaffActor,id:string,body:unknown){
  workId.parse(id);const input=restrictWorkOrderInput.parse(body);
  return workOrderCommand(tx,actor,'asset-work-orders',id,'RESTRICT',input,async()=>{
   const row=await lockWorkOrder(tx,id,input.revision);live(row);const vehicle=await tx.vehicle.findUnique({where:{id:row.vehicleId}});ensure(vehicle?.revision===input.vehicleRevision,409,'REVISION_CONFLICT','车辆已变化，请重新确认限制');
   const evidence=await requireAssetFiles(tx,actor,{kind:'WORK_ORDER',resourceId:id,fileIds:input.fileIds,required:true}),now=this.now();
   const restriction=await tx.vehicleOperationalRestriction.create({data:{vehicleId:row.vehicleId,workOrderId:id,revision:0,status:'ACTIVE',scopes:input.scopes,reason:input.reason,evidenceFileIds:input.fileIds,evidenceSnapshot:evidence,createdBy:actor.id,createdAt:now}});
   const changed=await tx.vehicle.updateMany({where:{id:row.vehicleId,revision:input.vehicleRevision},data:{revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','车辆已变化');
   await recordWorkOrderTransition(tx,actor,row,'RESTRICT',{}, {restrictionId:restriction.id,scopes:input.scopes,reason:input.reason,evidence,vehicleRevision:input.vehicleRevision+1},now);return this.detail(tx,actor,id);
  });
 }
 async release(tx:any,actor:StaffActor,id:string,restrictionId:string,body:unknown){
  workId.parse(id);workId.parse(restrictionId);const input=releaseWorkOrderInput.parse(body),commandInput={...input,restrictionId};
  return workOrderCommand(tx,actor,'asset-work-orders',id,'RELEASE_RESTRICTION',commandInput,async()=>{
   const row=await lockWorkOrder(tx,id,input.revision);await tx.$queryRaw`SELECT id FROM "VehicleOperationalRestriction" WHERE id=${restrictionId} FOR UPDATE`;
   const restriction=await tx.vehicleOperationalRestriction.findUnique({where:{id:restrictionId}}),vehicle=await tx.vehicle.findUnique({where:{id:row.vehicleId}});ensure(restriction?.workOrderId===id&&restriction.vehicleId===row.vehicleId,409,'WORK_ORDER_RELATION','车辆限制不属于本工单');ensure(restriction.revision===input.restrictionRevision&&vehicle?.revision===input.vehicleRevision,409,'REVISION_CONFLICT','车辆或限制已变化');ensure(restriction.status==='ACTIVE',409,'WORK_ORDER_STATE','限制已解除');
   const evidence=await requireAssetFiles(tx,actor,{kind:'WORK_ORDER',resourceId:id,fileIds:input.fileIds,required:true}),now=this.now();
   const changed=await tx.vehicleOperationalRestriction.updateMany({where:{id:restrictionId,workOrderId:id,vehicleId:row.vehicleId,revision:input.restrictionRevision,status:'ACTIVE'},data:{status:'RELEASED',revision:{increment:1},releasedBy:actor.id,releasedAt:now,releaseReason:input.reason,releaseEvidenceFileIds:input.fileIds,releaseEvidenceSnapshot:evidence}});ensure(changed.count===1,409,'REVISION_CONFLICT','限制已变化');
   const changedVehicle=await tx.vehicle.updateMany({where:{id:row.vehicleId,revision:input.vehicleRevision},data:{revision:{increment:1}}});ensure(changedVehicle.count===1,409,'REVISION_CONFLICT','车辆已变化');
   await recordWorkOrderTransition(tx,actor,row,'RELEASE_RESTRICTION',{}, {restrictionId,reason:input.reason,evidence,vehicleRevision:input.vehicleRevision+1},now);return this.detail(tx,actor,id);
  });
 }
}
