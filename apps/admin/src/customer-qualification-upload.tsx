import {useEffect,useRef,useState} from 'react';
import {api} from './core';
import {Command,FormFields,endpoint,type CommandFieldsProps} from './domain-ui';
import {CommandIdentity,type BusinessField} from './domain-commands';
import {ErrorNotice} from './ui';
import {qualificationValidityFields,qualificationValidityInitial,qualificationValidityPayload} from './qualification-validity';

const slots=[['identityFrontFileId','身份证人像面'],['identityBackFileId','身份证国徽面'],['drivingLicenseFileId','驾驶证']] as const;
const fields:BusinessField[]=[...slots.map(([key,label])=>({key,label,required:true})),...qualificationValidityFields];

export function QualificationUploadCommand({customerId,profileHash,revision,disabled,after,onCommitted}:{customerId:string;profileHash:string;revision:number;disabled:boolean;after:()=>void;onCommitted?:()=>void}){
 const [uploading,setUploading]=useState(false);
 return <Command label="提交新资格资料" path={`/admin/customers/${encodeURIComponent(customerId)}/qualifications`} permission="customers.write" revision={revision} disabled={disabled||uploading} initial={qualificationValidityInitial} fields={fields}
  note="分别上传身份证人像面、国徽面及驾驶证。确认提交后，将更新客户当前证件并生成待审核资格资料；原审核和订单中的历史资料保留。"
  renderFields={props=><DocumentFields {...props} customerId={customerId} onUploading={setUploading}/>}
  build={values=>{const documents=Object.fromEntries(slots.map(([key])=>[key,String(values[key])]));if(new Set(Object.values(documents)).size!==3)throw Error('身份证正反面和驾驶证须分别选择不同附件');return {documents,identityFileIds:[documents.identityFrontFileId,documents.identityBackFileId],drivingLicenseFileIds:[documents.drivingLicenseFileId],...qualificationValidityPayload(values),profileHash,verificationSource:'MANUAL'};}}
  after={after} onCommitted={onCommitted}/>;
}

function DocumentFields({customerId,values,setValues,disabled,onUploading}:CommandFieldsProps&{customerId:string;onUploading:(busy:boolean)=>void}){
 const [names,setNames]=useState<Record<string,string>>({}),[error,setError]=useState<unknown>(),[busy,setBusy]=useState<string>();
 const pending=useRef<AbortController|null>(null),alive=useRef(true),identities=useRef(new Map<string,CommandIdentity>()),latestValues=useRef(values);latestValues.current=values;
 useEffect(()=>{alive.current=true;const cancel=()=>pending.current?.abort();window.addEventListener('admin-session-change',cancel);return()=>{alive.current=false;cancel();window.removeEventListener('admin-session-change',cancel);onUploading(false);};},[onUploading]);
 const upload=async(slot:string,file?:File)=>{
  if(!file||disabled||pending.current)return;const controller=new AbortController(),session=api.session;pending.current=controller;setBusy(slot);setError(undefined);onUploading(true);
  const active=()=>alive.current&&!controller.signal.aborted&&api.session===session;
  try{
   if(file.size>10*1024*1024||!['image/png','image/jpeg','application/pdf'].includes(file.type))throw Error('请选择10MiB以内的 JPEG、PNG 或 PDF');
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');if(!active())return;
   const path=`/admin/customers/${encodeURIComponent(customerId)}/qualification-files`,body=new FormData();
   if(!identities.current.has(slot))identities.current.set(slot,new CommandIdentity());
   body.set('file',file);body.set('idempotencyKey',identities.current.get(slot)!.for(path,{slot,name:file.name,size:file.size,sha256:digest}));
   const result=await api.request<{id:string}>(path,{method:'POST',permission:'customers.write',body,signal:controller.signal});if(!active())return;
   if(typeof result.id!=='string'||!result.id)throw Error('未返回附件记录，请重新上传');
   setValues({...latestValues.current,[slot]:result.id});setNames(old=>({...old,[result.id]:file.name}));
  }catch(e){if(active())setError(e);}finally{if(alive.current){pending.current=null;setBusy(undefined);onUploading(false);}}
 };
 return <><div className="domain-form-grid" style={{marginBottom:16}}>{slots.map(([slot,label])=><div className="domain-field wide" key={slot}><label>{label}<span className="required"> *</span></label><input type="file" aria-label={label} accept="image/jpeg,image/png,application/pdf" required={!values[slot]} disabled={disabled||!!busy} onChange={e=>{void upload(slot,e.target.files?.[0]);e.target.value='';}}/>{busy===slot?<span role="status">上传中…</span>:null}{values[slot]?<div className="domain-files"><div><a href={endpoint('/admin/files/'+encodeURIComponent(String(values[slot])))} target="_blank" rel="noreferrer">{names[String(values[slot])]||label}</a><button type="button" className="text-button" disabled={disabled||!!busy} onClick={()=>setValues({...values,[slot]:''})}>移除{label}</button></div></div>:null}</div>)}</div>{error?<ErrorNotice error={error}/>:null}<FormFields fields={qualificationValidityFields} values={values} setValues={setValues} disabled={disabled}/></>;
}
