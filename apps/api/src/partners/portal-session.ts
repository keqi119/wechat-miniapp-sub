import {ensure} from '../common/errors';
export type PartnerPortalScope={accessId:string;ownerId:string;accessVersion:number};
export type PartnerPortalSession={id:string;mode:'PARTNER_READONLY'|string;mobileHash:string;maskedMobile?:string;scopeSnapshot:unknown;csrfToken?:string;expiresAt:Date};
export function portalScopes(snapshot:unknown):PartnerPortalScope[]{
 if(!Array.isArray(snapshot))return[];
 return snapshot.filter((s:any)=>s&&typeof s.accessId==='string'&&typeof s.ownerId==='string'&&Number.isInteger(s.accessVersion)&&s.accessVersion>0);
}
export async function validPortalGrants(tx:any,rows:any[]){
 const ids=rows.filter(row=>row.bindingMethod==='INVITATION'&&row.boundInvitationId).map(row=>row.boundInvitationId);
 const invitations=ids.length?await tx.partnerPortalInvitation.findMany({where:{id:{in:ids},status:'BOUND'}}):[];
 return rows.filter(row=>row.status==='ENABLED'&&row.accessVersion>0&&(row.bindingMethod==='INVITATION'
  ?row.boundAt&&invitations.some((invitation:any)=>invitation.id===row.boundInvitationId&&invitation.boundAt&&invitation.accessId===row.id&&invitation.ownerId===row.ownerId&&invitation.mobileHash===row.mobileHash&&invitation.accessVersion===row.accessVersion)
  :(!row.bindingMethod||row.bindingMethod==='REVIEWED')&&row.reviewedBy&&row.reviewedAt));
}
export async function currentPortalSession(tx:any,session:PartnerPortalSession){
 ensure(session?.id&&session.mode==='PARTNER_READONLY',401,'SESSION_EXPIRED','请重新登录合作商中心');
 const current=await tx.partnerPortalSession.findUnique({where:{id:session.id}});
 ensure(current&&current.mode==='PARTNER_READONLY'&&current.expiresAt>new Date()&&current.mobileHash===session.mobileHash,401,'SESSION_EXPIRED','合作商登录已过期');return current as PartnerPortalSession;
}
export async function validPartnerScopes(tx:any,session:PartnerPortalSession){
 const current=await currentPortalSession(tx,session),snapshots=portalScopes(current.scopeSnapshot);
 if(!snapshots.length)return[];
 const grants=await validPortalGrants(tx,await tx.partnerPortalAccess.findMany({where:{id:{in:snapshots.map(s=>s.accessId)},mobileHash:current.mobileHash,status:'ENABLED'}}));
 return snapshots.filter(s=>grants.some((g:any)=>g.id===s.accessId&&g.ownerId===s.ownerId&&g.accessVersion===s.accessVersion));
}
export async function requirePartnerReadAccess(tx:any,session:PartnerPortalSession,ownerId:string){
 const scope=(await validPartnerScopes(tx,session)).find(s=>s.ownerId===ownerId);
 ensure(scope,403,'PARTNER_ACCESS_DENIED','当前账号无权查看该合作商');return scope;
}
export async function portalSessionDto(tx:any,session:PartnerPortalSession){
 const current=await currentPortalSession(tx,session),scopes=await validPartnerScopes(tx,current);
 ensure(scopes.length,401,'SESSION_EXPIRED','查看授权已失效，请联系运营');
 return{mode:'PARTNER_READONLY',viewer:{maskedMobile:current.maskedMobile},scopes:scopes.map(({ownerId,accessVersion})=>({ownerId,accessVersion})),csrfToken:current.csrfToken,expiresAt:current.expiresAt};
}
