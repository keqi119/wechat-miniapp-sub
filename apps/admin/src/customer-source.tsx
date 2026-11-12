import {useCallback,useEffect,useRef,useState} from 'react';
import {api,ApiError} from './core';
import {AssetAction,assetSessionKey,type AssetField} from './asset-shared';
import {ErrorNotice,Loading} from './ui';
import {customerSourceAccess,customerSourcePayload,type CustomerSource} from './customer-source-model';

const fields:AssetField[]=[{key:'sourceChannel',label:'来源名称',hint:'依据客户说明填写，最多64字。'},{key:'clearSource',label:'清除已登记来源',kind:'check',hint:'勾选后清空来源，原修改记录保留。'},{key:'reason',label:'修改原因',kind:'textarea',required:true}];
export function CustomerSourcePanel({customerId,disabled=false,refreshKey=0,onSaved}:{customerId:string;disabled?:boolean;refreshKey?:number;onSaved?:()=>void}){
 const access=customerSourceAccess(api.session?.user.role,api.session?.user.permissions||[]);
 return access.read?<SourceDetails key={customerId+'-'+assetSessionKey()} customerId={customerId} disabled={disabled} refreshKey={refreshKey} writable={access.write} onSaved={onSaved}/>:null;
}
function SourceDetails({customerId,disabled,refreshKey,writable,onSaved}:{customerId:string;disabled:boolean;refreshKey:number;writable:boolean;onSaved?:()=>void}){
 const [record,setRecord]=useState<CustomerSource>(),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false);const generation=useRef(0),recordSession=useRef(''),sessionKey=assetSessionKey(),path='/admin/customers/'+encodeURIComponent(customerId)+'/source';
 const load=useCallback(async()=>{
  const token=++generation.current,session=api.session;setBusy(true);
  try{const result=await api.request<CustomerSource>(path,{permission:'customers.read'});if(session!==api.session||sessionKey!==assetSessionKey())throw new ApiError('当前会话已变化，请重新读取',0,'SESSION_CHANGED');if(result.customerId!==customerId||!Number.isInteger(result.sourceRevision)||result.sourceRevision<0||result.sourceChannel!==null&&typeof result.sourceChannel!=='string')throw new Error('返回来源与当前客户不一致');if(token===generation.current){recordSession.current=sessionKey;setRecord(result);setError(undefined);}}
  catch(e){if(token===generation.current){const transient=e instanceof ApiError&&(e.status>=500||e.status===0&&e.code==='NETWORK_ERROR'),same=session===api.session&&sessionKey===assetSessionKey()&&recordSession.current===sessionKey;setRecord(old=>transient&&same&&old?.customerId===customerId?old:undefined);setError(e);}throw e;}
  finally{if(token===generation.current)setBusy(false);}
 },[path,customerId,sessionKey]);
 useEffect(()=>{void load().catch(()=>{});return()=>{generation.current++;};},[load,refreshKey]);
 const current=record?.customerId===customerId&&recordSession.current===sessionKey?record:undefined;
 return <section className="asset-section"><h3>客户来源</h3>{current?<>{error?<div className="action-warning" role="alert"><p>来源暂时读取失败，以下为上次核对的信息；新修改已暂停。</p><button className="button" disabled={busy} onClick={()=>void load().catch(()=>{})}>重新读取客户来源</button></div>:null}<p>{current.sourceChannel??'尚未登记来源'}</p><p className="muted">记录客户获知订阅服务的渠道，修改来源不改变已审核的证件资料。</p>{writable?<AssetAction label="修改客户来源" path={path} method="PATCH" permission="customers.write" fields={fields} initial={{sourceChannel:current.sourceChannel??'',clearSource:false,reason:''}} build={values=>customerSourcePayload(values,current.sourceRevision)} after={async()=>{await load();onSaved?.();}} disabled={disabled||busy||!!error}/>:null}</>:error?<ErrorNotice error={error} retry={()=>void load().catch(()=>{})}/>:<Loading/>}</section>;
}
export function CustomerSourceFilter({value,onApply}:{value:string;onApply:(value:string)=>void}){
 const [draft,setDraft]=useState(value);useEffect(()=>setDraft(value),[value]);
 return <form className="search-field" onSubmit={event=>{event.preventDefault();onApply(draft.trim());}}><input aria-label="按客户来源筛选" maxLength={64} placeholder="按客户来源筛选" value={draft} onChange={event=>setDraft(event.target.value)}/><button type="submit" className="button">筛选来源</button></form>;
}
