import {useCallback,useEffect,useRef,useState} from 'react';
import {api,ApiError,type Page} from './core';
import {ErrorNotice,Loading} from './ui';
import {assetAccess,type BaasContract,type BaasGroup} from './asset-model';
import {assetSessionKey} from './asset-shared';
import {BaasDetail,BaasDraftForm} from './asset-baas';
import {useBaasLease} from './baas-session';
import {processHref,rememberProcessPosition} from './process-navigation';

const groups:{key:BaasGroup;label:string}[]=[{key:'CURRENT',label:'有效中'},{key:'EXPIRED',label:'已过期'},{key:'OTHER',label:'待完善及其他'}];
type Result=Page<BaasContract>&{groupCounts?:Record<BaasGroup,number>;serverDate?:string};
export function VehicleBaasPanel(props:{vehicleId:string;refreshKey?:number;disabled?:boolean;onFrozenChange?:(value:boolean)=>void}){
 const access=assetAccess('baas-contracts',api.session?.user.role,api.session?.user.permissions||[]);
 if(!access.read)return <p className="vehicle-workspace-empty">当前岗位无权查看本车 BaaS 合同。</p>;
 return <VehicleBaasBody key={props.vehicleId+'|'+assetSessionKey()} {...props} writable={access.write}/>;
}
function VehicleBaasBody({vehicleId,refreshKey=0,disabled=false,writable,onFrozenChange}:{vehicleId:string;refreshKey?:number;disabled?:boolean;writable:boolean;onFrozenChange?:(value:boolean)=>void}){
 const [group,setGroup]=useState<BaasGroup>('CURRENT'),[page,setPage]=useState(1),[result,setResult]=useState<Result>(),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[creating,setCreating]=useState(false),[createdId,setCreatedId]=useState(''),[version,setVersion]=useState(0),[frozen,setFrozen]=useState<Record<string,boolean>>({});
 const lease=useBaasLease(),generation=useRef(0),callbacks=useRef(new Map<string,(value:boolean)=>void>()),frozenAny=Object.values(frozen).some(Boolean),frozenRef=useRef(false),deferredRefresh=useRef(false);frozenRef.current=frozenAny;
 const freeze=(key:string)=>{if(!callbacks.current.has(key))callbacks.current.set(key,value=>setFrozen(old=>old[key]===value?old:{...old,[key]:value}));return callbacks.current.get(key)!;};
 useEffect(()=>{onFrozenChange?.(frozenAny);return()=>onFrozenChange?.(false);},[frozenAny,onFrozenChange]);
 const load=useCallback(async()=>{
  const token=++generation.current;setBusy(true);setError(undefined);
  try{
   const query=new URLSearchParams({vehicleId,group,page:String(page),pageSize:'5'}),next=await api.request<Result>('/admin/baas-contracts?'+query,{permission:'baas-contracts.read'});
   if(!lease.current()||token!==generation.current)return;
   if(next.page!==page||next.pageSize!==5||!Array.isArray(next.items)||next.items.some(row=>row.vehicleId!==vehicleId||row.validityGroup&&row.validityGroup!==group))throw Error('合同范围或分页不一致，请重新读取');
   setResult(next);
  }catch(cause){if(lease.current()&&token===generation.current){if(cause instanceof ApiError&&[401,403,404].includes(cause.status))setResult(undefined);setError(cause);}throw cause;}
  finally{if(lease.current()&&token===generation.current)setBusy(false);}
 },[vehicleId,group,page,refreshKey,version]);
 // External parent refreshes must not replace a card that owns an unresolved command.
 // The original command still calls load() explicitly after its POST resolves.
 useEffect(()=>{if(frozenRef.current){deferredRefresh.current=true;return;}deferredRefresh.current=false;setResult(undefined);void load().catch(()=>{});return()=>{generation.current++;};},[load]);
 useEffect(()=>{if(!frozenAny&&deferredRefresh.current){deferredRefresh.current=false;setResult(undefined);void load().catch(()=>{});}},[frozenAny,load]);
 const reload=async()=>{await load();setVersion(value=>value+1);};
 const canCreate=writable&&assetAccess('vehicle-assets',api.session?.user.role,api.session?.user.permissions||[]).read&&(api.session?.user.permissions.includes('*')||api.session?.user.permissions.includes('vehicles.read'));
 if(!lease.valid)return <p>登录权限已变化，请重新读取本车 BaaS 合同。</p>;
 return <section className="baas-vehicle-panel" aria-label="本车BaaS合同">
  <header className="baas-panel-heading"><h3>本车 BaaS 合同</h3><span className="muted">一车仅一份当前生效合同</span><div>{canCreate?<button type="button" className="button primary" disabled={disabled||frozenAny} onClick={()=>{setCreating(value=>!value);setCreatedId('');}}>{creating?'收起登记':'登记BaaS合同'}</button>:null}<button type="button" className="button" disabled={busy||frozenAny} onClick={()=>void load().catch(()=>{})}>刷新本车BaaS</button></div></header>
  <nav className="baas-group-tabs" aria-label="本车BaaS合同分组">{groups.map(item=><button key={item.key} type="button" className={group===item.key?'is-active':''} aria-pressed={group===item.key} disabled={frozenAny} onClick={()=>{setGroup(item.key);setPage(1);setCreatedId('');}}>{item.label}<small>{result?.groupCounts?.[item.key]??'—'}</small></button>)}</nav>
  {creating?<BaasDraftForm vehicleId={vehicleId} disabled={disabled||busy||!!error} onFrozenChange={freeze('create')} afterCreate={async id=>{
   const saved=await api.request<BaasContract>('/admin/baas-contracts/'+encodeURIComponent(id),{permission:'baas-contracts.read'});if(!lease.current())return;if(saved.vehicleId!==vehicleId)throw Error('新登记合同与本车不一致');setCreatedId(id);setGroup(saved.validityGroup||'OTHER');setPage(1);setCreating(false);setVersion(value=>value+1);
  }}/>:null}
  {error?<ErrorNotice error={error}/>:null}{busy&&!result?<Loading label="正在读取本车合同"/>:result?.items.length?<div className="baas-vehicle-records">{result.items.map(row=><VehicleBaasRecord key={row.id} row={{...row,serverDate:row.serverDate||result.serverDate}} refreshKey={version} disabled={disabled||busy||!!error||Object.entries(frozen).some(([key,value])=>key!==row.id&&value)} writable={writable} after={reload} onFrozenChange={freeze(row.id)} highlighted={createdId===row.id}/>)}</div>:<p className="baas-empty">{group==='CURRENT'?'本车暂无有效中的 BaaS 合同。登记资料并明确启用后显示于此。':group==='EXPIRED'?'本车暂无已过期合同。':'本车暂无待完善、未到生效日或其他合同记录。'}</p>}
  <footer className="baas-panel-footer"><a href={processHref('#baas-contracts?vehicleId='+encodeURIComponent(vehicleId)+'&group='+group,window.location.hash)} aria-disabled={frozenAny} onClick={event=>{if(frozenAny){event.preventDefault();return;}if(api.session?.user&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey)rememberProcessPosition(api.session.user.id);}}>本车BaaS记录</a><span>共 {result?.total??'—'} 条</span><button type="button" className="button" disabled={page<=1||busy||frozenAny} onClick={()=>setPage(value=>value-1)}>上一页</button><span>第 {page} 页</span><button type="button" className="button" disabled={!result||page*5>=result.total||busy||frozenAny} onClick={()=>setPage(value=>value+1)}>下一页</button></footer>
 </section>;
}
function VehicleBaasRecord({row,refreshKey,disabled,writable,after,onFrozenChange,highlighted}:{row:BaasContract;refreshKey:number;disabled:boolean;writable:boolean;after:()=>Promise<void>;onFrozenChange:(value:boolean)=>void;highlighted:boolean}){
 const [detail,setDetail]=useState<BaasContract>(),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),lease=useBaasLease(),generation=useRef(0);
 const load=useCallback(async()=>{const token=++generation.current;setBusy(true);try{const next=await api.request<BaasContract>('/admin/baas-contracts/'+encodeURIComponent(row.id),{permission:'baas-contracts.read'});if(!lease.current()||token!==generation.current)return;if(next.id!==row.id||next.vehicleId!==row.vehicleId)throw Error('合同详情归属不一致');setDetail({...next,serverDate:next.serverDate||row.serverDate});setError(undefined);}catch(cause){if(lease.current()&&token===generation.current){setError(cause);if(cause instanceof ApiError&&[401,403,404].includes(cause.status))setDetail(undefined);}throw cause;}finally{if(lease.current()&&token===generation.current)setBusy(false);}},[row.id,row.revision,refreshKey]);
 useEffect(()=>{void load().catch(()=>{});return()=>{generation.current++;};},[load]);
 if(!lease.valid)return null;
 return <article className={highlighted?'baas-inline-record is-new':'baas-inline-record'}>{error?<><ErrorNotice error={error}/><button className="button" onClick={()=>void load().catch(()=>{})}>重新读取合同</button></>:null}{detail?<BaasDetail contract={detail} writable={writable} disabled={disabled||busy||!!error} after={async()=>{await load();await after();}} onFrozenChange={onFrozenChange} showCostTools={false} linkedRecord/>:busy?<Loading label="读取合同登记资料"/>:null}</article>;
}
