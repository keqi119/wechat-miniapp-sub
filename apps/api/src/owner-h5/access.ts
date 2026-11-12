import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {tokenHash} from '../auth/auth.service';
import {OWNER_H5_COOKIE,ownerH5Enabled,ownerH5Origin} from './config';
import {portalSessionDto,requirePartnerReadAccess} from '../partners/portal-session';
import {electronicOwnerRoute,requireElectronicOwnerSession} from './electronic-access';
import {virtualActorScope} from '../virtual-acceptance/actors';
import {newOrderContractMode} from '../offline-documents/mode';

export type PortalPathPolicy='PUBLIC'|'AUTH'|'SESSION'|'READ'|'DENY_WRITE'|'UNKNOWN';
export function canonicalPortalPath(path:string){
 let value=path;
 try{for(let i=0;i<3;i++){const decoded=decodeURIComponent(value);if(decoded===value)break;value=decoded;}}catch{ensure(false,404,'NOT_FOUND','接口不存在');}
 return value.toLowerCase().replace(/\/+$/,'');
}
const part='[^/]+',owner=`/owner-h5/owners/${part}`;
const reads=[/^\/owner-h5\/owners$/,new RegExp(`^${owner}$`),new RegExp(`^${owner}/(?:workbench|vehicles|policies|offline-archives|revenue-rules|settlements|revenue|agreements|cooperation-vehicles)$`),new RegExp(`^${owner}/agreements/${part}/files/${part}$`),new RegExp(`^${owner}/orders/${part}/workspace$`),new RegExp(`^${owner}/(?:offline-archives|settlements)/${part}$`),new RegExp(`^${owner}/offline-archives/${part}/versions/${part}/files/${part}$`)];
const writes=[new RegExp(`^${owner}/electronic-documents/${part}/(?:sign|sync|accept)$`),/^\/owner-h5\/owners\/claim$/,new RegExp(`^${owner}/(?:verification|refresh|seal|authorities)$`),new RegExp(`^${owner}/authorities/${part}/(?:refresh|resume|switch|revoke)$`),new RegExp(`^${owner}/(?:contracts|handovers)/${part}/(?:sign|sync)$`),new RegExp(`^${owner}/(?:offline-archives|settlements)/${part}/feedback$`)];
export function portalPathPolicy(method:string,path:string):PortalPathPolicy{
 const canonical=canonicalPortalPath(path),read=['GET','HEAD'].includes(method);
 if(read&&['/owner-h5/config','/owner-h5/legal','/owner-h5/legal-signing'].includes(canonical))return'PUBLIC';
 if(method==='POST'&&['/owner-h5/auth/sms/request','/owner-h5/auth/login','/owner-h5/auth/invitation/preview','/owner-h5/auth/invitation/confirm'].includes(canonical))return'AUTH';
 if(read&&canonical==='/owner-h5/auth/me'||method==='POST'&&canonical==='/owner-h5/auth/logout')return'SESSION';
 if(read&&reads.some(r=>r.test(canonical)))return'READ';
 if(!['GET','HEAD','OPTIONS'].includes(method)&&writes.some(r=>r.test(canonical)))return'DENY_WRITE';
 return'UNKNOWN';
}
export async function ownerH5Access(db:Db,request:any,response:any,path:string){
 response.setHeader('Cache-Control','no-store');response.setHeader('Referrer-Policy','no-referrer');response.setHeader('X-Content-Type-Options','nosniff');
 const canonical=canonicalPortalPath(path),policy=portalPathPolicy(request.method,path);
 if(policy==='PUBLIC')return true;
 ensure(ownerH5Enabled(),503,'OWNER_H5_DISABLED','合作商入口暂未开放，请联系运营');
 const write=!['GET','HEAD','OPTIONS'].includes(request.method);
 if(write)ownerH5Origin(request);
 if(policy==='AUTH')return true;
 const raw=request.cookies?.[OWNER_H5_COOKIE];
 ensure(typeof raw==='string'&&/^[a-f0-9]{64}$/.test(raw),401,'UNAUTHENTICATED','请登录合作商中心');
 const storedLegal=await db.ownerH5Session.findUnique({where:{id:tokenHash(raw)}}),mode=newOrderContractMode();
 let legal=mode==='ELECTRONIC'?storedLegal:null;
 if(mode==='OFFLINE'&&(storedLegal?.identitySnapshot as any)?.mode==='ELECTRONIC_LEGAL'){
  const choices=(storedLegal!.identitySnapshot as any).owners;
  // Authentication permits historical recovery, never a new operation. Every
  // session owner must retain its exact persisted enterprise-actor binding.
  if(Array.isArray(choices)&&choices.length&&choices.every(choice=>typeof choice?.ownerId==='string')&&
   (await Promise.all(choices.map(choice=>virtualActorScope(db,storedLegal!.customerId,{ownerId:choice.ownerId,current:false})))).every(Boolean))legal=storedLegal;
 }
 if((legal?.identitySnapshot as any)?.mode==='ELECTRONIC_LEGAL'){
  ensure(electronicOwnerRoute(request.method,canonical),404,'NOT_FOUND','签署入口不支持此接口');
  if(write)ensure(typeof request.headers['x-csrf-token']==='string'&&request.headers['x-csrf-token']===legal!.csrfToken,403,'CSRF_DENIED','请求校验失败');
  const ownerId=/^\/owner-h5\/owners\/([^/]+)(?:\/|$)/.exec(canonical)?.[1];
  request.ownerH5Customer=await requireElectronicOwnerSession(db,legal,ownerId);request.ownerH5Session=legal;return true;
 }
 const session=await (db as any).partnerPortalSession.findUnique({where:{id:tokenHash(raw)}});
 if(!session){
  // Historical sessions are never promoted into independent portal scopes.
  // Existing authenticated write links still receive an explicit read-only denial.
  const legacy=policy==='DENY_WRITE'&&await db.ownerH5Session.findUnique({where:{id:tokenHash(raw)}});
  ensure(legacy&&legacy.expiresAt>new Date(),401,'SESSION_EXPIRED','请重新登录合作商中心');
  ensure(false,403,'PARTNER_READ_ONLY','合作商入口仅供查看，请联系运营办理');
 }
 ensure(session.expiresAt>new Date()&&session.mode==='PARTNER_READONLY',401,'SESSION_EXPIRED','合作商登录已过期');
 await portalSessionDto(db,session);
 ensure(policy!=='DENY_WRITE',403,'PARTNER_READ_ONLY','合作商入口仅供查看，请联系运营办理');
 ensure(policy==='READ'||policy==='SESSION',404,'NOT_FOUND','接口不存在');
 if(write)ensure(typeof request.headers['x-csrf-token']==='string'&&request.headers['x-csrf-token']===session.csrfToken,403,'CSRF_DENIED','请求校验失败');
 const ownerId=/^\/owner-h5\/owners\/([^/]+)(?:\/|$)/.exec(canonical)?.[1];
 if(ownerId)await requirePartnerReadAccess(db,session,ownerId);
 request.partnerPortalSession=session;return true;
}
