import {ApiError,type ApiClient,type Entity} from './core.ts';
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const pick=(value:Record<string,unknown>,keys:string[])=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
export function technicalSafe(value:Record<string,unknown>):Entity{
 const safe=pick(value,['id','verificationNo','title','customerId','revision','status','signatureStatus','createdAt','confirmedAt','stoppedAt','completedAt','retentionDueAt','retentionStatus','legalHold','sourceFileId','signedFileId','enabled','consentRequirementsMet','canConfirm','canPrepare','canSign','canSync','canStop','canReviewRetention','canPurge','statusMessage']);
 if(object(value.document))safe.document=pick(value.document,['id','type','version','title','templateHash','bodyHash','documentHash','sourcePdfHash','content']);
 if(object(value.approval))safe.approval=pick(value.approval,['id','status','expiresAt','requesterId','approverId','planHash']);
 if(object(value.disclosure))safe.disclosure=pick(value.disclosure,['version','text','privacyDocumentId','privacyVersion']);
 if(Array.isArray(value.blockers))safe.blockers=value.blockers.filter(item=>typeof item==='string');
 return safe as Entity;
}
export function technicalAllowed(action:string,value:Record<string,unknown>,role?:string){
 if(role!==undefined&&!['ADMIN','OPERATIONS'].includes(role))return false;
 if(value.status==='PURGED')return false;
 if(action==='prepare-signature')return value.canPrepare===true&&value.status==='CONFIRMED'&&!value.stoppedAt;
 if(action==='stop')return value.canStop===true&&!value.stoppedAt;
 if(action==='retention-review')return (role===undefined||role==='ADMIN')&&value.canReviewRetention===true;
 if(action==='purge')return (role===undefined||role==='ADMIN')&&value.canPurge===true;
 return false;
}
export function technicalPayload(action:string,body:Record<string,unknown>,key?:string,record?:Entity,role?:string){
 if(!key||key.length<8)throw new Error('业务请求编号缺失，请重新打开表单');
 const allowed=action==='create'?['customerId','documentId']:action==='prepare-signature'?['revision','policyId']:action==='retention-review'?['revision','legalHold','reason']:action==='purge'?['revision','reason']:action==='stop'?['revision']:[];
 if(!allowed.length||Object.keys(body).some(field=>!allowed.includes(field)))throw new Error('技术验收只接受独立文件字段，不接受正文、商业金额或其他业务操作');
 const text=(field:string)=>{const value=body[field];if(typeof value!=='string'||!value.trim())throw new Error(`请完整填写${field==='reason'?'人工核对理由':field==='policyId'?'签署策略':'指定客户与批准模板'}`);return value.trim();};
 if(action==='create')return{customerId:text('customerId'),documentId:text('documentId'),idempotencyKey:key};
 if(!record||!technicalAllowed(action,record,role)||!Number.isSafeInteger(record.revision)||Number(record.revision)<0)throw new Error('当前角色或服务端状态不允许该操作，请刷新独立验收详情');
 if(body.revision!==undefined&&Number(body.revision)!==record.revision)throw new Error('记录版本已变化，请重新读取');
 const version={revision:record.revision,idempotencyKey:key};
 if(action==='prepare-signature')return{...version,policyId:text('policyId')};
 if(action==='stop')return version;
 if(action==='retention-review'){if(![true,false,'true','false'].includes(body.legalHold as any))throw new Error('请明确选择必要留存或审核释放，不默认替您决定');return{...version,legalHold:body.legalHold===true||body.legalHold==='true',reason:text('reason')};}
 return{...version,reason:text('reason')};
}
export function technicalApprovalId(value:Record<string,unknown>,recordId:string){if(!object(value.record)||value.record.id!==recordId||!object(value.approval)||typeof value.approval.id!=='string'||!value.approval.id)throw new Error('尚未取得本份文件的真实复核计划，请重新读取原记录');return value.approval.id;}
export function technicalInitial(action:string,record:Entity){return action==='retention-review'?{revision:record.revision,legalHold:'',reason:''}:{revision:record.revision};}
export class TechnicalViewGuard{
 private generation=0;private resource:unknown;private record:unknown;private form:unknown;
 update(resource:unknown,record:unknown,form:unknown){if(this.resource!==resource||this.record!==record||this.form!==form){this.generation++;this.resource=resource;this.record=record;this.form=form;}}
 capture(){return this.generation;}current(stamp:number){return stamp===this.generation;}invalidate(){this.generation++;}
}
export async function technicalWrite(client:ApiClient,path:string,body:Record<string,unknown>,recordId?:string,onRead?:(value:Entity)=>void,isCurrent:()=>boolean=()=>true){
 const check=()=>{if(!isCurrent())throw new ApiError('已离开原验收记录，请在当前页面重新核对',0,'VIEW_CHANGED');};
 check();try{const saved=await client.request<Entity>(path,{method:'POST',permission:'technical-acceptances.write',body});check();return saved;}
 catch(error){check();if(error instanceof ApiError&&error.status===409){try{const fresh=await client.request<Entity>(recordId?`/admin/technical-acceptances/${encodeURIComponent(recordId)}`:'/admin/technical-acceptances?page=1&pageSize=12');check();if(recordId&&fresh.id===recordId)onRead?.(technicalSafe(fresh));}catch(readError){if(readError instanceof ApiError&&['SESSION_CHANGED','VIEW_CHANGED'].includes(readError.code))throw readError;}}throw error;}
}
export function technicalArchiveText(value:Record<string,unknown>){return value.signatureStatus==='SIGNED'&&(value.status==='PURGED'||value.retentionStatus==='PURGED')?'保留历史双方签署事实；独立文件已清理':value.signatureStatus==='SIGNED'&&value.signedFileId?'双方可信完成且已归档':value.signatureStatus==='SIGNED'?'归档文件尚未取得，请核对':value.signatureStatus==='PENDING'?'签署或归档仍待核实':'尚未确认完成';}
export function signingResourcePath(kind:unknown,id:string){const resource=kind==='TECHNICAL_ACCEPTANCE'?'technical-acceptances':kind==='HANDOVER'?'handovers':'contracts';return`#${resource}?record=${encodeURIComponent(id)}`;}
export function technicalNotice(value:Record<string,unknown>){
 if(value.status==='PURGED')return'本验证独立资料已按人工复核结果清理；不表示共用实名、证书或其他业务资料被删除。';
 if(value.stoppedAt||value.status==='STOPPED')return`${typeof value.statusMessage==='string'?value.statusMessage+'。':''}已记录停止后续参与；原渠道任务及迟到结果仍须核实，本地停止不等于供应商撤销成功，已发生签署事实仍保留。`;
 return typeof value.statusMessage==='string'?value.statusMessage:'结果以可信双方签署及签后文件归档为准；准备、审批、打开或返回签署页均不表示完成。';
}
