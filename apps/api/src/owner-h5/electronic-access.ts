import {ensure} from '../common/errors';
import {requireOwnerLegalRepresentative} from './legal-representative';
const owner='/owner-h5/owners/[^/]+';
export function electronicOwnerRoute(method:string,path:string){
 const read=['GET','HEAD'].includes(method);
 if(read&&new RegExp(`^${owner}/(?:electronic-documents/authorities/list|authority-options|authorities(?:/[^/]+/document/(?:source|signed))?|internal-evidence/[^/]+|electronic-documents/(?:workspace/[^/]+|[^/]+/dependencies(?:/[^/]+)?))$`).test(path))return true;
 if(method==='POST'&&new RegExp(`^${owner}/electronic-documents/(?:authorities/confirm|authorities/[^/]+/switch|[^/]+/revoke-grant)$`).test(path))return true;
 if(read)return /^\/owner-h5\/(?:auth\/me|owners)$/.test(path)||new RegExp(`^${owner}(?:$|/electronic-documents(?:/[^/]+(?:/files/(?:source|signed))?)?$|/seals/[^/]+/image$|/electronic-authorities(?:/[^/]+)?$)`).test(path);
 if(method!=='POST')return false;
 return path==='/owner-h5/auth/logout'||new RegExp(`^${owner}/(?:verification|refresh|seal|authorities(?:/[^/]+/(?:refresh|resume|switch|revoke))?|electronic-documents/[^/]+/(?:sign|sync|accept)|electronic-authorities(?:/[^/]+/(?:refresh|enable|disable|revoke))?)$`).test(path);
}
/** A fresh explicit legal session never upgrades an older paper or viewing session. */
export async function requireElectronicOwnerSession(tx:any,session:any,ownerId?:string){
 const snapshot=session?.identitySnapshot;
 ensure(session?.expiresAt>new Date()&&snapshot?.mode==='ELECTRONIC_LEGAL'&&Array.isArray(snapshot.owners)&&snapshot.owners.length>0,401,'SESSION_EXPIRED','请由登记本人重新登录签署入口');
 const choices=ownerId?snapshot.owners.filter((s:any)=>s.ownerId===ownerId):snapshot.owners;ensure(choices.length>0,404,'NOT_FOUND','本人的企业不存在');
 for(const choice of choices){const {profile}=await requireOwnerLegalRepresentative(tx,session.customerId,choice.ownerId);ensure(profile.revision===choice.legalRevision&&profile.mobileHash===choice.legalMobileHash,401,'SESSION_EXPIRED','登记本人资料已变化，请重新登录');}
 return tx.customer.findUnique({where:{id:session.customerId}});
}
