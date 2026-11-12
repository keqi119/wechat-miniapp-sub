import type {LegalTask} from './legal-client';

const titles:Record<string,string>={COOPERATION:'主合作协议',COOPERATION_GRANT:'独立用印授权',COOPERATION_AMENDMENT:'合作补充协议',COOPERATION_TERMINATION:'合作终止协议',SUBSCRIPTION:'主订阅合同',DELIVERY_DELAY:'延期交付协议',VEHICLE_SWAP:'换车协议',VEHICLE_CHANGE:'换车协议',RENEWAL:'续期协议',PRE_DELIVERY_CANCELLATION:'交付前取消协议',EARLY_TERMINATION:'提前终止协议',TERMINATION:'终止协议',RETURN_SETTLEMENT:'退车结算协议',RENEWAL_CANCELLATION:'续期取消协议'};
export const legalDocumentTitle=(kind:string)=>titles[kind]||'合同文件';
export const signingRoleLabel=(role:string)=>({OWNER:'出租方',PLATFORM:'宁达',CUSTOMER:'客户'}[role]||'签署方');
export function legalDocumentView(task:LegalTask){
 const allSigned=task.parties.length>0&&task.parties.every(p=>p.status==='SIGNED');
 const archived=allSigned&&task.status==='ARCHIVED'&&!!task.archivedAt;
 const state=archived?'已归档':allSigned?'待归档':'待签署';
 const parties=task.parties.map(p=>({role:p.role,label:signingRoleLabel(p.role),signed:p.status==='SIGNED',status:({SIGNED:'已签署',PENDING:'待签署',ISSUED:'签署办理中',UNKNOWN:'结果待核对',DECLINED:'已拒签',EXPIRED:'签署已过期'} as Record<string,string>)[p.status]||'结果待核对',signedAt:p.status==='SIGNED'?p.signedAt:null}));
 let hint='';
 if(archived)hint='各方已签署，文件已归档。';
 else if(allSigned){
  hint=task.lastErrorCode||task.nextAction.kind==='BLOCKED'?'各方已签署，归档暂未完成。请状态刷新；仍未完成时联系平台核对，无需重新签署。':task.filingStatus==='UNKNOWN'?'各方已签署，归档结果待核对。请状态刷新，无需重新签署。':'各方已签署，正在办理归档。无需重新签署。';
 }else if(['WITHDRAWN','RETIRED','CANCELLED'].includes(task.status))hint='本文件已停止办理，已有签署记录保留。';
 else if(task.status==='DECLINED'||task.parties.some(p=>p.status==='DECLINED'))hint='有参与方拒绝签署，请联系平台核对。';
 else if(task.status==='EXPIRED'||task.parties.some(p=>p.status==='EXPIRED'))hint='签署已过期，请联系平台核对。';
 else if(task.nextAction.kind==='BLOCKED')hint='当前办理条件待核对，请状态刷新或联系平台。';
 else if(task.nextAction.role)hint=`当前办理方：${signingRoleLabel(task.nextAction.role)}${task.nextAction.kind==='QUERY'?'，签署结果待核对':''}。`;
 else hint='文件准备中，请状态刷新。';
 return {state,allSigned,archived,parties,hint};
}
export type LegalFileVariant='source'|'signed';
export function legalFilePath(ownerId:string,taskId:string,variant:LegalFileVariant){
 if(!/^[A-Za-z0-9_-]+$/.test(ownerId)||!/^[A-Za-z0-9_-]+$/.test(taskId)||!['source','signed'].includes(variant))throw Error('文件范围已变化，请重新读取');
 return `/owners/${ownerId}/electronic-documents/${taskId}/files/${variant}`;
}
export function legalPreviewKey(sessionBinding:string,ownerId:string,task:Pick<LegalTask,'id'|'revision'|'sourceSha256'>,variant:LegalFileVariant){
 return JSON.stringify([sessionBinding,ownerId,task.id,task.revision,task.sourceSha256,variant]);
}
