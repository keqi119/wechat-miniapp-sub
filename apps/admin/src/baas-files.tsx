import {useEffect,useRef,useState} from 'react';
import {api,ApiError,date} from './core';
import {endpoint} from './domain-ui';
import {CommandIdentity} from './domain-commands';
import {ErrorNotice} from './ui';
import type {AssetFile} from './asset-model';
import {AssetAction,useAssetRecordUnavailable} from './asset-shared';
import {useBaasLease} from './baas-session';

type Pending={body:FormData;committed:boolean};
export function BaasFiles({id,revision,files,writable,disabled=false,after,onFrozenChange}:{id:string;revision:number;files:AssetFile[];writable:boolean;disabled?:boolean;after:()=>Promise<void>;onFrozenChange?:(value:boolean)=>void}){
 const unavailable=useAssetRecordUnavailable(),lease=useBaasLease();
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[phase,setPhase]=useState<'idle'|'unknown'|'readback'>('idle'),[drag,setDrag]=useState(false),[actionsFrozen,setActionsFrozen]=useState<Record<string,boolean>>({});
 const pending=useRef<Pending|null>(null),running=useRef(false),mounted=useRef(true),identity=useRef(new CommandIdentity()),picker=useRef<HTMLInputElement>(null),actionCallbacks=useRef(new Map<string,(value:boolean)=>void>());
 const path=`/admin/baas-contracts/${encodeURIComponent(id)}/files`,frozen=busy||phase!=='idle'||Object.values(actionsFrozen).some(Boolean),blocked=disabled||unavailable||!lease.valid;
 const valid=()=>mounted.current&&lease.current();
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{onFrozenChange?.(frozen);return()=>onFrozenChange?.(false);},[frozen,onFrozenChange]);
 useEffect(()=>{if(!lease.valid){pending.current=null;setError(undefined);setPhase('idle');setBusy(false);}},[lease.valid]);
 const upload=async(file?:File)=>{
  if(running.current||!writable||!valid()||blocked&&!pending.current||!file&&!pending.current||Object.values(actionsFrozen).some(Boolean))return;
  running.current=true;setBusy(true);setError(undefined);
  try{
   if(!pending.current){
    if(!file||file.size<=0||file.size>10*1024*1024||file.type!=='application/pdf')throw Error('请放入10MiB以内已签署的BaaS合同PDF');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('');
    if(!valid())return;
    const body=new FormData();body.set('file',file);body.set('revision',String(revision));body.set('idempotencyKey',identity.current.for(path,{revision,name:file.name,size:file.size,sha256:digest}));pending.current={body,committed:false};
   }
   const attempt=pending.current;
   if(!attempt.committed){if(!valid())return;await api.request(path,{method:'POST',body:attempt.body,permission:'baas-contracts.write'});attempt.committed=true;}
   if(!valid())return;setPhase('readback');await after();
   if(valid()){pending.current=null;setPhase('idle');}
  }catch(cause){if(valid()){
   setError(cause);
   if(cause instanceof ApiError&&[401,403].includes(cause.status)){pending.current=null;setPhase('idle');lease.revoke();}
   else if(pending.current?.committed)setPhase('readback');
   else if(cause instanceof ApiError&&cause.status>=400&&cause.status<500){pending.current=null;setPhase('idle');if(cause.status===409)await after().catch(()=>{});}
   else if(pending.current)setPhase('unknown');
  }}finally{running.current=false;if(valid())setBusy(false);}
 };
 const freezeAction=(key:string)=>{if(!actionCallbacks.current.has(key))actionCallbacks.current.set(key,value=>setActionsFrozen(old=>old[key]===value?old:{...old,[key]:value}));return actionCallbacks.current.get(key)!;};
 if(!lease.valid)return <section className="asset-section"><p>登录权限已变化，请重新读取合同附件。</p></section>;
 return <section className={`asset-section baas-file-card${drag?' is-dragging':''}`} aria-label="合同专用附件" onDragOver={event=>{event.preventDefault();if(writable&&!blocked&&!frozen)setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={event=>{event.preventDefault();setDrag(false);if(!blocked&&!frozen){if(event.dataTransfer.files.length!==1)setError(Error('每次放入一份合同文件，上传完成后可继续添加'));else void upload(event.dataTransfer.files[0]);}}}>
  <h3>已签署的BaaS合同PDF</h3>
  {files.length?<ul className="baas-file-list">{files.map(file=><li key={file.id} className={file.state==='VOIDED'?'is-voided':''}>
   <div className="baas-file-name"><a href={endpoint(path+'/'+encodeURIComponent(file.id)+(file.state==='VOIDED'?'/history':''))} target="_blank" rel="noreferrer">{file.name}</a><small>{Math.ceil(file.size/1024)} KB{file.mimeType!=='application/pdf'?' · 历史图片附件':''}{file.state==='VOIDED'?' · 已作废':''}</small>{file.voidReason?<small>作废说明：{file.voidReason}{file.voidedAt?' · '+date(file.voidedAt):''}</small>:null}</div>
   {writable?<div className="baas-file-actions"><AssetAction available={(file.state||'ACTIVE')==='ACTIVE'} sessionScoped onAuthorizationLost={lease.revoke} label="作废" submitLabel="确认作废此附件" path={path+'/'+encodeURIComponent(file.id)+'/void'} permission="baas-contracts.write" revision={revision} fields={[{key:'reason',label:'作废说明',kind:'textarea',required:true,maxLength:500}]} build={values=>{const reason=String(values.reason||'').trim();if(!reason||reason.length>500)throw Error('请填写500字以内的作废说明');return{reason};}} after={after} disabled={blocked||busy||phase!=='idle'||Object.entries(actionsFrozen).some(([key,value])=>key!==file.id+'-void'&&value)} onFrozenChange={freezeAction(file.id+'-void')} note={<p>确认作废“{file.name}”？作废后保留历史原件与说明，不再作为当前有效附件。</p>}/>
    <AssetAction sessionScoped onAuthorizationLost={lease.revoke} label="删除" submitLabel="确认删除此附件" path={path+'/'+encodeURIComponent(file.id)+'/remove'} permission="baas-contracts.write" revision={revision} fields={[{key:'reason',label:'删除说明',kind:'textarea',required:true,maxLength:500}]} build={values=>{const reason=String(values.reason||'').trim();if(!reason||reason.length>500)throw Error('请填写500字以内的删除说明');return{reason};}} after={after} disabled={blocked||busy||phase!=='idle'||Object.entries(actionsFrozen).some(([key,value])=>key!==file.id+'-remove'&&value)} onFrozenChange={freezeAction(file.id+'-remove')} note={<p>确认删除“{file.name}”？删除后不再显示或提供原件读取；操作说明会保留。</p>}/>
   </div>:null}
  </li>)}</ul>:<p className="muted">尚无合同专用附件</p>}
  {writable?<label className={`baas-drop-hint${blocked||frozen?' is-disabled':''}`} tabIndex={blocked||frozen?-1:0} role="button" aria-label="拖入或选择合同附件" aria-disabled={blocked||frozen} onKeyDown={event=>{if(['Enter',' '].includes(event.key)&&!blocked&&!frozen){event.preventDefault();picker.current?.click();}}}>拖入已签署的BaaS合同PDF至此，或点击选择<small>PDF · 单份10MiB以内</small><input ref={picker} type="file" aria-label="上传合同附件" accept="application/pdf" disabled={blocked||frozen} onChange={event=>{void upload(event.target.files?.[0]);event.target.value='';}}/></label>:null}
  {busy?<p role="status">正在处理附件并回读合同…</p>:null}{error?<ErrorNotice error={error}/>:null}
  {phase!=='idle'?<div className="baas-file-recovery"><p className="action-warning">{phase==='readback'?'附件已上传，仅重新读取结果，不再次上传。':'上传结果尚未确认，原文件与请求已冻结。'}</p><button type="button" className="button" disabled={busy} onClick={()=>void upload()}>{phase==='readback'?'重新读取上传结果':'按原文件重试上传'}</button></div>:null}
 </section>;
}
