import {ApiError,api,moneyToCents} from './core.ts';

export const insuranceBase='/admin/insurance-policies';
export const policyTypes={COMPULSORY_TRAFFIC:'交强险',COMMERCIAL:'商业险',DRIVER_PASSENGER:'驾乘险',OTHER:'其他'} as const;
export const policyStates={NOT_STARTED:'未起保',ACTIVE:'保障中',EXPIRED:'已到期',CANCELLED:'已退保',DRAFT:'草稿',SUBMITTED:'待核验',REJECTED:'已退回',UNVERIFIED:'未核验'} as const;
export type PolicyFile={fileId:string;name?:string;mimeType?:string;size?:number};
export type PolicyVehicle={id:string;plateNumber?:string|null;vin?:string|null;title?:string|null};
export type PolicyVersion={id:string;revision:number;version:number;status:string;policyType?:string|null;insurerSnapshot?:string|null;policyNumberSnapshot?:string|null;insuredParty?:string;policyholder?:string;startAt?:string;endAt?:string;premiumAmount?:number|null;vehicleIds?:string[];fileIds?:string[];registeredBy?:string|null;registeredByStaff?:{id:string;name?:string|null;username?:string}|null;registeredAt?:string|null;createdAt?:string;changeReason?:string|null;reviewReason?:string|null;terms?:string;coverageItems?:unknown[]};
export type InsurancePolicy={id:string;revision:number;policyNumber:string;insurer:string;policyType?:string|null;currentStatus?:string;currentVersionId?:string|null;startAt?:string|null;endAt?:string|null;insuredParty?:string|null;vehicles?:PolicyVehicle[];versions:PolicyVersion[];files:PolicyFile[]};
export type PolicyValues={vehicleIds:string[];policyType:string;policyNumber:string;insurer:string;insuredParty:string;policyholder:string;startAt:string;endAt:string;premiumAmount:string;fileIds:string[];reason:string;confirmed:boolean};
export function latestPolicyVersion(policy:InsurancePolicy){return [...policy.versions].sort((a,b)=>b.version-a.version)[0];}
export function localPolicyTime(value?:string|null){if(!value)return '';const date=new Date(value);return Number.isNaN(date.getTime())?'':new Date(date.getTime()+8*3600000).toISOString().slice(0,19);}
export function policyFormValues(policy?:InsurancePolicy):PolicyValues{const version=policy&&latestPolicyVersion(policy);return {vehicleIds:[...(version?.vehicleIds||[])],policyType:version?.policyType||policy?.policyType||'',policyNumber:policy?.policyNumber||'',insurer:policy?.insurer||'',insuredParty:version?.insuredParty||policy?.insuredParty||'',policyholder:version?.policyholder||'',startAt:localPolicyTime(version?.startAt||policy?.startAt),endAt:localPolicyTime(version?.endAt||policy?.endAt),premiumAmount:version?.premiumAmount==null?'':(version.premiumAmount/100).toFixed(2),fileIds:[...(version?.fileIds||[])],reason:'',confirmed:false};}
function required(value:string,label:string){const text=value.trim();if(!text)throw Error('请填写'+label);return text;}
function isoTime(value:string){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value))throw Error('请填写完整保险起止时间');const date=new Date(value+'+08:00');if(Number.isNaN(date.getTime()))throw Error('保险时间无效');return date.toISOString();}
export function registrationInput(values:PolicyValues,files:File[],current?:InsurancePolicy){
 const version=current&&latestPolicyVersion(current),startAt=isoTime(values.startAt),endAt=isoTime(values.endAt);
 if(endAt<=startAt)throw Error('保险截止时间必须晚于开始时间');
 if(!values.vehicleIds.length||new Set(values.vehicleIds).size!==values.vehicleIds.length)throw Error('请选择实际被保车辆');
 if(!Object.hasOwn(policyTypes,values.policyType))throw Error('请选择保单类型');
 if(!values.confirmed)throw Error('请核对车辆、保险有效期与原件后确认');
 const fileIds=[...new Set(values.fileIds)];
 if(fileIds.length+files.length<1||fileIds.length+files.length>20)throw Error('保单原件与批单合计须为1至20份');
 if(fileIds.some(id=>!current?.files.some(file=>file.fileId===id)))throw Error('保留附件必须属于当前保单');
 if(files.some(file=>file.size<1||file.size>10*1024*1024||!['application/pdf','image/jpeg','image/png'].includes(file.type)))throw Error('保单文件仅支持10MiB以内的PDF、JPEG或PNG');
 const retainedSize=fileIds.reduce((sum,id)=>sum+(current?.files.find(file=>file.fileId===id)?.size||0),0);
 if(retainedSize+files.reduce((sum,file)=>sum+file.size,0)>32*1024*1024)throw Error('保留与新增文件合计不可超过32MiB');
 const reason=values.reason.trim();if(current&&(reason.length<2||reason.length>1000))throw Error('修改说明须填写2至1000字');
 if(current&&!version)throw Error('当前保单版本未完整读取，请刷新后重试');
 return {revision:current?.revision??0,versionId:version?.id??null,versionRevision:version?.revision??0,vehicleIds:[...values.vehicleIds],policyType:values.policyType,policyNumber:required(values.policyNumber,'保单号'),insurer:required(values.insurer,'保险机构'),insuredParty:required(values.insuredParty,'被保险人'),policyholder:values.policyholder.trim(),startAt,endAt,premiumAmount:values.premiumAmount.trim()?moneyToCents(values.premiumAmount):null,fileIds,...(reason?{reason}:{}),confirmed:true};
}
export function insuranceFileUrl(policyId:string,fileId:string){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(policyId)||!/^[A-Za-z0-9_-]{1,128}$/.test(fileId))throw Error('保单文件路径无效');
 const marker='insurance-base-marker',suffix='/admin/files/'+marker,anchor=api.fileUrl(marker);
 if(!anchor.endsWith(suffix))throw Error('保单服务地址无效');
 return anchor.slice(0,-suffix.length)+insuranceBase+'/'+encodeURIComponent(policyId)+'/files/'+encodeURIComponent(fileId)+'/open';
}
type Requester=(path:string,options:{method:string;permission:string;body:FormData})=>Promise<{id:string}>;
/** A retry keeps the same multipart instance and idempotency key. A known commit
 * can only read back; it cannot issue another registration. */
export class InsuranceRegistrationCommand{
 phase:'idle'|'unknown'|'readback'|'conflict'='idle';
 private pending?:{path:string;body:FormData;id?:string;committed:boolean};
 private running=false;
 private epoch=0;
 get hasPending(){return !!this.pending;}
 dispose(){this.epoch++;this.pending=undefined;this.phase='idle';}
 private key:()=>string;
 constructor(key:()=>string=()=>crypto.randomUUID()){this.key=key;}
 get canReadResult(){return !!this.pending?.id;}
 async execute(path:string,input:Record<string,unknown>|undefined,files:File[],request:Requester,readback:(id:string)=>Promise<void>){
  if(this.running)return;this.running=true;const epoch=this.epoch;
  const current=()=>{if(epoch!==this.epoch)throw new ApiError('登录或权限已变化，原命令已清理',0,'SESSION_CHANGED');};
  try{
   if(!this.pending){if(!input)throw Error('登记资料尚未准备');const body=new FormData();body.set('input',JSON.stringify({...input,idempotencyKey:this.key()}));for(const file of files)body.append('files',file);const trustedId=path.match(/^\/admin\/insurance-policies\/([A-Za-z0-9_-]{1,128})\/registrations$/)?.[1];this.pending={path,body,id:trustedId,committed:false};}
   if(!this.pending.committed){try{const result=await request(this.pending.path,{method:'POST',permission:'insurance-policies.write',body:this.pending.body});current();this.pending.committed=true;if(!this.pending.id&&result&&typeof result.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(result.id))this.pending.id=result.id;}catch(error){current();if(error instanceof ApiError&&error.status>=200&&error.status<300)this.pending.committed=true;else throw error;}}
   this.phase='readback';
   if(!this.pending.id)throw Error('登记请求已返回成功，但未提供保单编号。请到保单列表核对结果，不要重复登记。');
   current();await readback(this.pending.id);current();this.pending=undefined;this.phase='idle';
  }catch(error){if(epoch===this.epoch){if(this.pending?.committed)this.phase='readback';else if(error instanceof ApiError&&error.status>=400&&error.status<500){this.pending=undefined;this.phase=error.status===409?'conflict':'idle';}else if(this.pending)this.phase='unknown';}throw error;}finally{this.running=false;}
 }
}
