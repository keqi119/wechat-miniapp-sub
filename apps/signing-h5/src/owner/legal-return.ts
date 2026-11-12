export const legalReturnKey='owner-electronic-return-reference';
export type LegalReturnReference={ownerId:string;sessionBinding:string;taskId?:string;taskRevision?:number;authorityId?:string};
export function legalReturnReference(raw:string|null,ownerIds:string[],sessionBinding:string):LegalReturnReference|null{
 if(!raw||!sessionBinding)return null;
 try{const v=JSON.parse(raw) as LegalReturnReference;const valid=(s:unknown)=>typeof s==='string'&&/^[A-Za-z0-9_-]+$/.test(s);if(v.sessionBinding!==sessionBinding||!valid(v.ownerId)||!ownerIds.includes(v.ownerId)||v.taskId!==undefined&&!valid(v.taskId)||v.taskRevision!==undefined&&(!Number.isSafeInteger(v.taskRevision)||v.taskRevision<0)||v.authorityId!==undefined&&!valid(v.authorityId))return null;return {ownerId:v.ownerId,sessionBinding,...(v.taskId?{taskId:v.taskId,...(v.taskRevision!==undefined?{taskRevision:v.taskRevision}:{})}:{}),...(v.authorityId?{authorityId:v.authorityId}:{})};}catch{return null;}
}

export function providerReturnReference(path:string,result:{id?:string;url?:string},context:{ownerId:string;sessionBinding:string;taskId?:string;taskRevision?:number}):LegalReturnReference{
 const base={ownerId:context.ownerId,sessionBinding:context.sessionBinding};
 const prefix=`/owners/${context.ownerId}/`;
 if(!path.startsWith(prefix))throw Error('返回引用与当前企业不一致');
 const suffix=path.slice(prefix.length);
 const technical=/^authorities\/([A-Za-z0-9_-]+)\/(?:resume|revoke|refresh|switch)$/.exec(suffix);
 if(technical){
  if(result.id&&result.id!==technical[1])throw Error('渠道返回记录与原授权不一致');
  return {...base,authorityId:technical[1]};
 }
 if(suffix==='authorities'){
  if(!result.id||!/^[A-Za-z0-9_-]+$/.test(result.id))throw Error('渠道授权返回缺少原记录引用');
  return {...base,authorityId:result.id};
 }
 const document=/^electronic-documents\/([A-Za-z0-9_-]+)\/(?:sign|accept)$/.exec(suffix);
 if(document){
  if(document[1]!==context.taskId)throw Error('返回引用与当前文书不一致');
  return {...base,taskId:document[1],taskRevision:context.taskRevision};
 }
 return base;
}
export function returnRefresh(raw:string|null,current:{ownerId:string;sessionBinding:string;taskId?:string;taskRevision?:number;departing?:boolean}){
 if(current.departing)return null;
 const reference=legalReturnReference(raw,[current.ownerId],current.sessionBinding);
 if(!reference||reference.taskId&&(reference.taskId!==current.taskId||!Number.isSafeInteger(current.taskRevision)))return null;
 const base=`/owners/${current.ownerId}`;
 return reference.taskId?{path:`${base}/electronic-documents/${reference.taskId}/sync`,body:{revision:current.taskRevision,idempotencyKey:crypto.randomUUID()}}:reference.authorityId?{path:`${base}/authorities/${reference.authorityId}/refresh`,body:{}}:{path:`${base}/refresh`,body:{}};
}
