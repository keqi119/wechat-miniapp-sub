import {ensure} from '../common/errors';
import type {StaffActor} from '../auth/staff.types';

export const partnerCapabilities = [
 'partner.cooperation.read','partner.cooperation.write','partner.cooperation.review',
 'partner.portal.read','partner.portal.write','partner.portal.review','partner.portal.disable',
 'partner.rules.read','partner.rules.write','partner.rules.review',
 'partner.accounts.read','partner.accounts.write','partner.accounts.review',
 'partner.settlements.read','partner.settlements.write','partner.settlements.review',
 'partner.payments.read','partner.payments.record','partner.payments.review',
] as const;
export type PartnerCapability = typeof partnerCapabilities[number];
export function isPartnerCapability(value:unknown):value is PartnerCapability{return typeof value==='string'&&partnerCapabilities.includes(value as PartnerCapability);}
/** ADMIN ordinary cooperation/portal resources follow full business RBAC; finance still requires exact persisted grants. */
export function getPartnerCapabilities(staff:{partnerCapabilities?:unknown;role?:string}|null|undefined):PartnerCapability[]{
 if(staff?.role==='FIELD')return [];
 const ordinary=(key:string)=>key.startsWith('partner.cooperation.')||key.startsWith('partner.portal.');
 return partnerCapabilities.filter(key=>(staff?.role==='ADMIN'&&ordinary(key))||(Array.isArray(staff?.partnerCapabilities)&&staff.partnerCapabilities.includes(key)));
}
export async function requirePartnerCapability(tx:any,actor:StaffActor,capability:PartnerCapability|string){
 ensure(isPartnerCapability(capability),403,'FORBIDDEN','未知合作运营能力');
 const current=await tx.adminUser.findUnique({where:{id:actor.id}});
 ensure(current?.active&&current.role===actor.role&&(actor.authVersion===undefined||current.authVersion===actor.authVersion),403,'STAFF_SESSION_CHANGED','人员权限已变化，请重新登录');
 ensure(['ADMIN','OPERATIONS','FINANCE','SUPPORT'].includes(current.role)&&getPartnerCapabilities(current).includes(capability),403,'FORBIDDEN','未获授此合作运营能力');
 return current;
}
/** Unknown historical ownership blocks review, even when two account IDs differ. */
export async function assertIndependentStaffReview(tx:any,actorId:string,otherActorIds:Array<string|null|undefined>,errorCode='SETTLEMENT_SELF_REVIEW'){
 ensure(otherActorIds.every(id=>typeof id==='string'&&id.trim()),409,'STAFF_PERSON_UNVERIFIED','历史经办、提交或上传人员归属缺失，请先核实');
 const others=[...new Set(otherActorIds as string[])];
 ensure(!others.includes(actorId),409,errorCode,'经办、提交及材料上传人员不能复核本人事项');
 const ids=[...new Set([actorId,...others])],rows=await tx.adminUser.findMany({where:{id:{in:ids}},select:{id:true,staffPersonId:true}});
 ensure(rows.length===ids.length&&rows.every((staff:any)=>typeof staff.staffPersonId==='string'&&staff.staffPersonId.trim()),409,'STAFF_PERSON_UNVERIFIED','相关员工实际人员归属尚未由管理员核实');
 const reviewer=rows.find((staff:any)=>staff.id===actorId);
 ensure(!rows.some((staff:any)=>staff.id!==actorId&&staff.staffPersonId===reviewer.staffPersonId),409,errorCode,'同一实际人员的不同账号不能互相复核');
}
