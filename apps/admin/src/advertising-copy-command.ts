import {ApiError,type Session} from './core.ts';
import {CommandIdentity} from './domain-commands.ts';
import {normalizeItems} from './advertising-copy-model.ts';
type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type Pending={action:'draft'|'publish';body:Record<string,unknown>;committed:boolean};
type Requester=(path:string,options:{method:string;permission:string;body?:Record<string,unknown>;cache?:RequestCache})=>Promise<unknown>;
const storageKey='admin:advertising-copy:pending';
export async function scopeDigest(session:Session){const bytes=new TextEncoder().encode(JSON.stringify([session.user.id,session.user.role,[...session.user.permissions].sort(),[...session.user.partnerCapabilities||[]].sort(),session.csrfToken]));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');}
async function hash(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');}
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const positive=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
const digest=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
async function validateReceipt(value:unknown,pending:Pending){
 if(exact(value,['found'])&&value.found===false)return false;
 if(!exact(value,['found','requestHash','result'])||value.found!==true||!digest(value.requestHash))throw Error('命令回执不完整，已停止重提，请稍后重新核对');
 const body=pending.body;
 const parsed=pending.action==='draft'?{revision:body.revision,items:normalizeItems(body.items),idempotencyKey:body.idempotencyKey}:{revision:body.revision,draftHash:body.draftHash,idempotencyKey:body.idempotencyKey};
 if(await hash(parsed)!==value.requestHash)throw new ApiError('命令回执与原请求不一致，已停止重提，请联系管理员核对',409,'RECEIPT_MISMATCH');
 const result=value.result,keys=pending.action==='draft'?['id','revision','draftHash','publishedVersion']:['id','revision','version','contentHash'];
 if(!exact(result,keys)||result.id!=='discovery'||result.revision!==Number(body.revision)+1||!positive(result.revision)||(pending.action==='draft'?(!positive(result.publishedVersion)||!digest(result.draftHash)||result.draftHash!==await hash(normalizeItems(body.items))):(!positive(result.version)||result.contentHash!==body.draftHash)))throw Error('命令回执结果不完整，已停止重提，请稍后重新核对');
 return true;
}
export class AdvertisingCopyCommand{
 phase:'idle'|'unknown'|'readback'|'conflict'='idle';ready=false;
 private scope='';private owner?:Session;private pending?:Pending;private running=false;private binding=false;private epoch=0;private identity=new CommandIdentity();
 private storage?:StorageLike;
 constructor(storage?:StorageLike){this.storage=storage;}
 get hasPending(){return !!this.pending||this.binding;}
 get originalItems(){return this.pending?.action==='draft'?structuredClone(this.pending.body.items):undefined;}
 get pendingAction(){return this.pending?.action;}
 async bind(session:Session){this.binding=true;try{const epoch=this.epoch;const digest=await scopeDigest(session);if(epoch!==this.epoch)return;if(this.ready&&this.scope===digest)return;if(this.ready)this.dispose();this.scope=digest;
  try{this.storage??=sessionStorage;const raw=this.storage.getItem(storageKey);if(raw){const saved=JSON.parse(raw);if(saved.scope===digest&&['draft','publish'].includes(saved.pending?.action)&&saved.pending?.body&&typeof saved.pending.body.idempotencyKey==='string'&&typeof saved.pending.committed==='boolean'){this.pending=saved.pending;this.phase=this.pending!.committed?'readback':'unknown';}else this.storage.removeItem(storageKey);}this.owner=session;this.ready=true;}catch{throw Error('无法读取广告词恢复记录，请允许本页会话存储后重试');}
 }finally{this.binding=false;}}
 private persist(){try{if(this.pending)this.storage!.setItem(storageKey,JSON.stringify({scope:this.scope,pending:this.pending}));else this.storage!.removeItem(storageKey);}catch{throw Error('无法保存恢复记录，操作已暂停；请保持此页并恢复会话存储');}}
 dispose(){this.epoch++;this.ready=false;this.pending=undefined;this.phase='idle';this.scope='';this.owner=undefined;try{this.storage?.removeItem(storageKey);}catch{/* Remains scope-bound and cannot be restored by another session. */}}
 reviewed(){if(this.phase==='conflict'&&!this.pending)this.phase='idle';}
 async execute(action:'draft'|'publish',body:Record<string,unknown>,request:Requester,readback:()=>Promise<void>){
  if(this.running)return;if(!this.ready)throw Error('会话绑定尚未完成');if(this.phase==='conflict')throw Error('请先重新读取并核对版本');this.running=true;const epoch=this.epoch;const current=()=>{if(epoch!==this.epoch||!this.ready)throw new ApiError('登录或权限已变化',0,'SESSION_CHANGED');};
  let stage:'prepare'|'lookup'|'write'|'readback'='prepare';
  try{
   if(!this.owner||await scopeDigest(this.owner)!==this.scope){this.dispose();throw new ApiError('登录或权限已变化',0,'SESSION_CHANGED');}current();
   const recovering=!!this.pending;
   if(!this.pending){const snapshot=structuredClone(body);this.pending={action,body:{...snapshot,idempotencyKey:this.identity.for(action,snapshot)},committed:false};try{this.persist();}catch(error){this.pending=undefined;throw error;}}
   const pending=this.pending;
   if(!pending.committed&&recovering){stage='lookup';const receipt=await request(`/admin/advertising-copy/commands/${pending.action==='draft'?'SAVE_DRAFT':'PUBLISH'}/${encodeURIComponent(String(pending.body.idempotencyKey))}`,{method:'GET',permission:'advertising-copy.write',cache:'no-store'});current();const found=await validateReceipt(receipt,pending);current();if(found){pending.committed=true;this.phase='readback';this.persist();}}
   if(!pending.committed){stage='prepare';this.persist();stage='write';try{await request('/admin/advertising-copy/'+pending.action,{method:pending.action==='draft'?'PATCH':'POST',permission:'advertising-copy.write',body:structuredClone(pending.body)});current();pending.committed=true;}catch(error){current();if(error instanceof ApiError&&error.status>=200&&error.status<300)pending.committed=true;else throw error;}this.phase='readback';try{this.persist();}catch(error){try{this.storage?.removeItem(storageKey);}catch{}throw error;}}
   stage='readback';
   this.phase='readback';await readback();current();try{this.storage!.removeItem(storageKey);}catch{throw Error('无法清理恢复记录，请保持此页并恢复会话存储后重新核对');}this.pending=undefined;this.phase='idle';
  }catch(error){if(epoch===this.epoch){if(error instanceof ApiError&&([401,403].includes(error.status)||error.code==='SESSION_CHANGED'))this.dispose();else if(this.pending?.committed)this.phase='readback';else if(stage==='lookup'){this.phase=error instanceof ApiError&&error.code==='RECEIPT_MISMATCH'?'conflict':'unknown';}else if(stage==='write'&&error instanceof ApiError&&error.status>=400&&error.status<500){this.pending=undefined;this.phase=error.status===409?'conflict':'idle';this.persist();}else if(this.pending)this.phase='unknown';}throw error;}finally{this.running=false;}
 }
}
