import {useCallback,useEffect,useRef,useState} from 'react';
import {api,ApiError} from './core';
import {useCommandDisabled} from './domain-ui';
import {catalogAccess,checkedCatalogReadiness,VehicleCatalogCommand,type CatalogReadiness,type CatalogMode} from './vehicle-catalog-model';
import {sessionPendingIntent,pendingIntentCurrent,subscribePendingIntent,releasePendingIntent,intentUiLease,runPendingIntent,resetPendingIntent} from './session-pending-intents';
import {ErrorNotice} from './ui';
import './vehicle-catalog-control.css';
type Props={vehicleId:string;refreshKey?:number;disabled?:boolean;appVisiblePlanCount?:number;onFrozenChange?:(frozen:boolean)=>void;onUpdated?:()=>void};
export function VehicleCatalogControl(props:Props){
 const[epoch,setEpoch]=useState(0);useEffect(()=>{const changed=()=>setEpoch(n=>n+1);window.addEventListener('admin-session-change',changed);return()=>window.removeEventListener('admin-session-change',changed);},[]);
 const user=api.session?.user,access=catalogAccess(user?.role,user?.permissions||[]),scope=JSON.stringify([props.vehicleId,epoch,user?.id,user?.role,user?.permissions]);
 return access.read?<CatalogControlBody key={scope} {...props}/>:null;
}
function CatalogControlBody({vehicleId,refreshKey=0,disabled=false,appVisiblePlanCount,onFrozenChange,onUpdated}:Props){
 const boundaryDisabled=useCommandDisabled(),blocked=disabled||boundaryDisabled;
 const[intent]=useState(()=>sessionPendingIntent<VehicleCatalogCommand,{mode:CatalogMode;reason:string}>(`vehicle:catalog:${vehicleId}`,()=>new VehicleCatalogCommand()));
 const[data,setData]=useState<CatalogReadiness>(),[reading,setReading]=useState(false),[readError,setReadError]=useState<unknown>(),[mode,setMode]=useState<CatalogMode|undefined>(intent.snapshot?.mode),[reason,setReason]=useState(intent.snapshot?.reason||''),[notice,setNotice]=useState(''),[,render]=useState(0);
 const alive=useRef(false),controller=useRef<AbortController|undefined>(undefined),sequence=useRef(0),frozenRef=useRef(false),deferred=useRef(false),callback=useRef(onFrozenChange);callback.current=onFrozenChange;
 const command=intent.command,phase=command.phase,valid=pendingIntentCurrent(intent),frozen=intent.busy||phase==='unknown'||phase==='readback';frozenRef.current=frozen;
 const current=()=>alive.current&&pendingIntentCurrent(intent),access=catalogAccess(api.session?.user.role,api.session?.user.permissions||[]);
 const load=useCallback(async()=>{
  const token=++sequence.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;if(current())setReading(true);
  try{const next=checkedCatalogReadiness(await api.request(`/admin/vehicles/${encodeURIComponent(vehicleId)}/catalog/readiness`,{permission:'vehicles.read',signal:abort.signal}),vehicleId);if(current()&&!abort.signal.aborted&&token===sequence.current){setData(next);setReadError(undefined);}return next;}
  catch(e){if(current()&&!abort.signal.aborted&&token===sequence.current){setReadError(e);if(e instanceof ApiError&&[401,403,404].includes(e.status))setData(undefined);}throw e;}
  finally{if(current()&&token===sequence.current)setReading(false);}
 },[vehicleId,intent]);
 useEffect(()=>{alive.current=true;const unsubscribe=subscribePendingIntent(intent,()=>{if(alive.current){if(!pendingIntentCurrent(intent)){setData(undefined);setMode(undefined);setReason('');}render(n=>n+1);}});return()=>{alive.current=false;sequence.current++;controller.current?.abort();unsubscribe();releasePendingIntent(intent);callback.current?.(false);};},[intent]);
 useEffect(()=>{callback.current?.(frozen);},[frozen]);
 useEffect(()=>{if(frozenRef.current){deferred.current=true;return;}if(!blocked)void load().catch(()=>{});},[refreshKey,blocked,load]);
 useEffect(()=>{if(!frozen&&deferred.current){deferred.current=false;if(!blocked)void load().catch(()=>{});}},[frozen,blocked,load]);
 useEffect(()=>{if(intent.completed&&!intent.busy){setMode(undefined);setReason('');setNotice('已核对最新商品状态。');resetPendingIntent(intent,()=>new VehicleCatalogCommand());}},[intent.completed,intent.busy,intent]);
 const act=async()=>{
  if(!current()||!access.write||intent.busy||intent.completed||phase==='conflict'||blocked&&phase==='idle'||!mode||!data&&phase==='idle')return;
  const canApply=intentUiLease(intent,()=>alive.current);sequence.current++;controller.current?.abort();setReading(false);setNotice('');
  try{await runPendingIntent(intent,{mode,reason},()=>command.execute(vehicleId,mode,data?.vehicleRevision??0,reason,(path,body)=>api.request(path,{method:'POST',permission:'vehicles.write',body}),id=>api.request(`/admin/vehicles/${encodeURIComponent(id)}`,{permission:'vehicles.read'}),async record=>{
   if(!canApply())return;const next=await load();if(!canApply())return;if(next.vehicleRevision<record.revision||next.catalogPublished!==record.catalogPublished)throw new ApiError('商品最新状态尚未完成回读，请重新读取',0,'INVALID_RESPONSE');setData(next);onUpdated?.();
  }));}catch{/* The session-scoped intent owns and exposes the exact command error. */}
 };
 const recover=async()=>{if(frozen||!current())return;try{await load();if(current()){resetPendingIntent(intent,()=>new VehicleCatalogCommand());setMode(undefined);}}catch{/* Keep the read error and rejected operation visible. */}};
 const locked=blocked||reading||!valid||frozen,canPublish=!!data?.ready&&!readError;
 return <section className="vehicle-catalog-control" aria-label="商品上架控制"><div className="vehicle-catalog-control-main"><div><strong>对客商品</strong><span className={`status ${data?.catalogPublished?'success':'neutral'}`}>{data?data.catalogPublished?'商品已上架':'商品未上架':'商品状态待核对'}</span><small>{data?`${data.vehicleActivated?'车辆已激活':'车辆未激活'} · ${data.publishedPlanCount} 个已上架产品方案`:'正在核对商品资料'}</small></div><div className="goods-actions">{access.write&&data&&!mode?<button className={`button ${data.catalogPublished?'danger':'primary'}`} disabled={locked||!!readError||!data.catalogPublished&&!canPublish} onClick={()=>{setMode(data.catalogPublished?'withdraw':'publish');setNotice('');}}>{data.catalogPublished?'商品下架':'商品上架'}</button>:null}<button className="text-button" disabled={frozen||blocked||reading} onClick={()=>void load().then(()=>onUpdated?.()).catch(()=>{})}>刷新商品状态</button></div></div>
  <p className="vehicle-catalog-note">仅此处控制小程序首页与选车展示。激活车辆、上架产品方案均不会自动上架商品。</p>
  <p className="vehicle-catalog-app-state">{frozen||reading||!data?'App 展示状态待核对':!data.catalogPublished?'App 未展示：商品尚未上架。':appVisiblePlanCount===undefined||appVisiblePlanCount>data.publishedPlanCount?'App 展示状态待核对':appVisiblePlanCount>0?`App 当前可展示 ${appVisiblePlanCount} 个产品方案`:'App 未展示：没有符合条件的公开产品方案。'}</p>
  {data&&!data.catalogPublished&&data.blockers.length?<p className="vehicle-catalog-blockers">{data.blockers.map(b=>b.message).join('；')}</p>:null}
  {mode&&access.write?<div className="vehicle-catalog-confirm"><span>{mode==='publish'?'上架后，符合条件的产品方案可在小程序展示。':'下架后停止首页推荐与选车展示，既有订单继续履行。'}</span><input aria-label="商品上架操作说明" placeholder="操作说明（选填）" value={reason} maxLength={500} disabled={frozen||blocked} onChange={e=>setReason(e.target.value)}/><button className="button" disabled={frozen} onClick={()=>setMode(undefined)}>取消</button><button className="button primary" disabled={intent.busy||!valid||blocked&&phase==='idle'||phase==='conflict'} onClick={()=>void act()}>{intent.busy?'正在提交…':phase==='unknown'?'重试原商品请求':phase==='readback'?'重新读取商品状态':mode==='publish'?'确认商品上架':'确认商品下架'}</button></div>:null}
  {readError||intent.error?<ErrorNotice error={intent.error||readError}/>:null}{phase==='unknown'?<small role="status">结果待确认，原操作、版本与请求标识已冻结。</small>:phase==='readback'?<small role="status">操作已提交，仅重新读取商品状态，不重复提交。</small>:phase==='conflict'?<p role="status">车辆版本已变化，请重新核对。<button className="text-button" disabled={blocked||reading} onClick={()=>void recover()}>重新读取商品来源</button></p>:notice?<small role="status">{notice}</small>:null}
 </section>;
}
