import {OwnerApiError,OwnerClient} from './client.ts';
import type {LegalSession} from './legal-client.ts';
export type EnterpriseSession=Session|LegalSession;
export function validEnterpriseSession(value:unknown):value is EnterpriseSession {
 const v=value as LegalSession;return validPortalSession(value)||!!v&&v.mode==='ELECTRONIC_LEGAL'&&typeof v.sessionBinding==='string'&&!!v.sessionBinding&&typeof v.csrfToken==='string'&&!!v.csrfToken&&typeof v.viewer?.maskedMobile==='string'&&Date.parse(v.expiresAt)>Date.now()&&Array.isArray(v.owners)&&v.owners.length>0&&v.owners.every(o=>/^[A-Za-z0-9_-]+$/.test(o.ownerId))&&new Set(v.owners.map(o=>o.ownerId)).size===v.owners.length;
}
import type {LegalDocument,OwnerSummary,Session} from './model.ts';
export interface BootstrapState {config:{enabled:boolean;entryUrl?:string;mode?:string};documents:LegalDocument[];session:EnterpriseSession|null;owners:OwnerSummary[]}
export function validPortalSession(value:unknown):value is Session {
 const v=value as Session;
 return !!v&&v.mode==='PARTNER_READONLY'&&typeof v.viewer?.maskedMobile==='string'&&typeof v.csrfToken==='string'&&!!v.csrfToken&&Number.isFinite(Date.parse(v.expiresAt))&&Date.parse(v.expiresAt)>Date.now()&&Array.isArray(v.scopes)&&v.scopes.length>0&&v.scopes.every(s=>/^[A-Za-z0-9_-]+$/.test(s.ownerId)&&Number.isSafeInteger(s.accessVersion)&&s.accessVersion>0)&&new Set(v.scopes.map(s=>s.ownerId)).size===v.scopes.length;
}
export function scopedOwners(session:EnterpriseSession,owners:OwnerSummary[]){return owners.filter(owner=>session.mode==='ELECTRONIC_LEGAL'?session.owners.some(scope=>scope.ownerId===owner.ownerId):session.scopes.some(scope=>scope.ownerId===owner.ownerId&&scope.accessVersion===owner.accessVersion));}
export class OwnerLifecycle {
 private epoch=0;api:OwnerClient;
 constructor(api:OwnerClient){this.api=api;}
 ticket(){return this.epoch;}
 current(ticket:number){return ticket===this.epoch;}
 clear(){this.epoch++;this.api.clear();}
 async bootstrap():Promise<BootstrapState>{
  const config=await this.api.request<BootstrapState['config']>('/config');
  if(!config.enabled)return{config,documents:[],session:null,owners:[]};
  if(config.mode!=='PARTNER_READONLY')throw Error('合作商入口配置已变化，请联系运营。');
  const documents=(await this.api.request<{documents:LegalDocument[]}>('/legal')).documents;
  let session:EnterpriseSession|null=null;
  try{const value=await this.api.request<Session>('/auth/me');if(validEnterpriseSession(value))session=value;}catch(e){if(!(e instanceof OwnerApiError&&e.status===401))throw e;}
  const owners=session?scopedOwners(session,await this.api.request<OwnerSummary[]>('/owners')):[];
  return{config,documents,session,owners};
 }
}
export function portalReturnDecision(current:unknown,previous:Session):'PRESERVE'|'RELOAD'|'EXPIRE'{
 if(!validPortalSession(current))return 'EXPIRE';
 const scopes=(session:Session)=>JSON.stringify([...session.scopes].sort((a,b)=>a.ownerId.localeCompare(b.ownerId)));
 return current.csrfToken===previous.csrfToken&&scopes(current)===scopes(previous)?'PRESERVE':'RELOAD';
}
