import {ensure} from '../common/errors';
import type {StaffActor} from './staff.types';
import {assertIndependentStaffReview} from '../partners/capabilities';
/** Ordinary material checks only. Callers must enforce their resource RBAC/session first.
 * Never use for money, prices, refunds, revenue rules, payment accounts or enterprise seals. */
export function assertOrdinaryReview(actor:Pick<StaffActor,'id'|'role'>,otherActorIds:Array<string|null|undefined>,code='ORDINARY_SELF_REVIEW',status=409){
 ensure(actor.role==='ADMIN'||!otherActorIds.includes(actor.id),status,code,'提交、编辑及上传人员须由其他有权限人员审核；管理员可审核普通资料并留痕');
}
/** Partner materials retain verified real-person ownership and current-session checks. */
export async function assertOrdinaryStaffReview(tx:any,actor:StaffActor,otherActorIds:Array<string|null|undefined>,code='PARTNER_SELF_REVIEW'){
 const current=await tx.adminUser.findUnique({where:{id:actor.id}});
 ensure(current?.active&&current.role===actor.role&&(actor.authVersion===undefined||current.authVersion===actor.authVersion),403,'STAFF_SESSION_CHANGED','人员权限已变化，请重新登录');
 if(current.role!=='ADMIN')return assertIndependentStaffReview(tx,actor.id,otherActorIds,code);
 ensure(otherActorIds.every(id=>typeof id==='string'&&id.trim()),409,'STAFF_PERSON_UNVERIFIED','历史经办、提交或上传人员归属缺失，请先核实');
 const ids=[...new Set([actor.id,...otherActorIds])],rows=await tx.adminUser.findMany({where:{id:{in:ids}},select:{id:true,staffPersonId:true}});
 ensure(rows.length===ids.length&&rows.every((row:any)=>typeof row.staffPersonId==='string'&&row.staffPersonId.trim()),409,'STAFF_PERSON_UNVERIFIED','相关员工实际人员归属尚未由管理员核实');
}
