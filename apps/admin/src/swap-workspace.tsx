import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {api,ApiError} from './core';
import {assetSessionKey,useAssetMutation} from './asset-shared';
import {ErrorNotice} from './ui';
import {useCommandDisabled} from './domain-ui';

/** Scoped reads never revive private state after a later denial or session change. */
export function useSwapRead<T>(path:string,permission='order-changes.read'){
 const session=assetSessionKey(),scope=session+':'+path,[record,setRecord]=useState<{scope:string;data:T}>(),[error,setError]=useState<unknown>(),[loading,setLoading]=useState(false),generation=useRef(0),alive=useRef(true),currentScope=useRef(scope);currentScope.current=scope;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
 const reload=useCallback(async()=>{
  if(!path)return;const version=++generation.current,identity=api.session;setLoading(true);
  const current=()=>alive.current&&version===generation.current&&currentScope.current===scope&&identity===api.session;
  try{const data=await api.request<T>(path,{permission});if(current()){setRecord({scope,data});setError(undefined);}return data;}
  catch(e){if(current()){const transient=e instanceof ApiError&&(e.status>=500||e.status===0&&e.code==='NETWORK_ERROR');setRecord(old=>transient&&old?.scope===scope?old:undefined);setError(e);}throw e;}
  finally{if(current())setLoading(false);}
 },[path,permission,scope]);
 useEffect(()=>{setRecord(undefined);setError(undefined);if(path)void reload().catch(()=>{});return()=>{generation.current++;};},[reload]);
 return{data:record?.scope===scope?record.data:undefined,error,loading,reload,disabled:loading||!!error};
}

/** Forms stay mounted through 409/5xx. Only the frozen command can retry an unknown write. */
export function SwapMutationForm({path,permission='order-changes.write',build,after,reload,disabled=false,onFrozenChange,children}:{path:string;permission?:string;build:(raw:Record<string,unknown>)=>Record<string,unknown>;after:(result?:unknown)=>Promise<void>;reload:()=>Promise<unknown>;disabled?:boolean;onFrozenChange?:(value:boolean)=>void;children:(submit:(raw:Record<string,unknown>)=>Promise<void>)=>ReactNode}){
 const parentDisabled=useCommandDisabled();disabled=disabled||parentDisabled;
 const mutation=useAssetMutation(),frozen=mutation.busy||mutation.unknown||mutation.readback,[validation,setValidation]=useState<unknown>();
 useEffect(()=>{onFrozenChange?.(frozen);return()=>onFrozenChange?.(false);},[frozen,onFrozenChange]);
 const submit=async(raw:Record<string,unknown>)=>{if(disabled||frozen||mutation.conflict)throw new Error('请先核对当前版本和未完成请求');setValidation(undefined);await mutation.submit(path,build(raw),permission,after);};
 const recover=()=>{void mutation.submit(path,{},permission,after).catch(setValidation);};
 return <section>{mutation.error||validation?<ErrorNotice error={mutation.error||validation}/>:null}
  {mutation.readback?<p className="action-warning">操作已提交，当前只重新读取结果，不重复提交。</p>:mutation.unknown?<p className="action-warning">提交结果未知，已保留原内容和请求编号；只可按原请求核对。</p>:null}
  {mutation.conflict?<><p className="action-warning">版本或来源已变化。已填内容保留，重新读取后再核对；报价需重新预览。</p><button type="button" className="button" disabled={mutation.busy} onClick={()=>void reload().then(()=>mutation.clearConflict()).catch(setValidation)}>重新读取并核对当前版本</button></>:null}
  {mutation.unknown||mutation.readback?<button type="button" className="button primary" disabled={mutation.busy} onClick={recover}>{mutation.readback?'重新读取结果':'按原请求重试'}</button>:null}
  <fieldset className="swap-command-fields" disabled={disabled||frozen||mutation.conflict}>{children(submit)}</fieldset>
 </section>;
}
