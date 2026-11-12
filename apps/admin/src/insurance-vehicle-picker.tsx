import {useEffect,useRef,useState} from 'react';
import {api,ApiError,can,type Page} from './core';
import type {PolicyVehicle} from './insurance-registration';
import {checkedInsuranceVehiclePage,insuranceVehicleLabel,insuranceVehiclePageSize} from './insurance-vehicle-picker-model';
import './insurance-vehicle-picker.css';

type Props={selectedIds:string[];seeds:PolicyVehicle[];disabled?:boolean;onChange:(ids:string[])=>void};
const signature=()=>JSON.stringify([api.session?.user.id,api.session?.user.role,api.session?.user.permissions]);
export function InsuranceVehiclePicker(props:Props){
 const [epoch,setEpoch]=useState(0);useEffect(()=>{const changed=()=>setEpoch(value=>value+1);window.addEventListener('admin-session-change',changed);return()=>window.removeEventListener('admin-session-change',changed);},[]);
 const allowed=['ADMIN','OPERATIONS'].includes(api.session?.user.role||'')&&can(api.session?.user.permissions||[],'vehicles.read');
 return allowed?<VehicleChoices key={epoch+'|'+signature()} {...props}/>:<section className="insurance-policy-vehicle-picker" aria-label="被保车辆"><h3>被保车辆</h3><p>当前账号无权检索车辆，已有关联仍保留在本次登记中。</p></section>;
}
function VehicleChoices({selectedIds,seeds,disabled=false,onChange}:Props){
 const [keyword,setKeyword]=useState(''),[page,setPage]=useState(1),[reading,setReading]=useState(true),[retry,setRetry]=useState(0),[denied,setDenied]=useState(false),[result,setResult]=useState<{scope:string;data:Page<PolicyVehicle>}>(),[error,setError]=useState<{scope:string;message:string}>();
 const session=useRef(api.session),grants=useRef(signature()),sequence=useRef(0),cache=useRef(new Map<string,PolicyVehicle>());
 for(const car of seeds)if(car.id&&!cache.current.has(car.id))cache.current.set(car.id,car);
 const scope=JSON.stringify([keyword.trim(),page]),data=result?.scope===scope?result.data:undefined,currentError=error?.scope===scope?error.message:undefined;
 const current=()=>api.session===session.current&&signature()===grants.current;
 useEffect(()=>{
  const token=++sequence.current,controller=new AbortController();let active=true;setReading(true);setError(undefined);
  const timer=setTimeout(()=>{void api.request<Page<PolicyVehicle>>('/admin/vehicles?'+new URLSearchParams({keyword:keyword.trim(),page:String(page),pageSize:String(insuranceVehiclePageSize)}),{permission:'vehicles.read',signal:controller.signal}).then(raw=>{
   if(!active||controller.signal.aborted||token!==sequence.current||!current())return;
   const value=checkedInsuranceVehiclePage(raw,page);for(const car of value.items)cache.current.set(car.id,car);setResult({scope,data:value});setDenied(false);
  }).catch(cause=>{if(active&&token===sequence.current&&current()){
   if(cause instanceof ApiError&&[401,403].includes(cause.status)){cache.current.clear();setResult(undefined);setDenied(true);}setError({scope,message:cause instanceof Error?cause.message:'车辆检索失败，请重新读取'});
  }}).finally(()=>{if(active&&token===sequence.current&&current())setReading(false);});},150);
  return()=>{active=false;clearTimeout(timer);controller.abort();sequence.current++;};
 },[scope,retry]);
 const toggle=(id:string,checked:boolean)=>{if(disabled||!current()||denied)return;onChange(checked?[...selectedIds.filter(value=>value!==id),id]:selectedIds.filter(value=>value!==id));};
 const row=(car:PolicyVehicle)=><label className="insurance-picker-row" key={car.id}><input type="checkbox" disabled={disabled||denied} checked={selectedIds.includes(car.id)} onChange={event=>toggle(car.id,event.target.checked)}/><span>{insuranceVehicleLabel(car)}</span></label>;
 const pinned=selectedIds.filter(id=>!data?.items.some(car=>car.id===id)).map(id=>cache.current.get(id)||{id,title:'已选车辆 '+id});
 return <section className="insurance-policy-vehicle-picker" aria-label="被保车辆"><header><h3>被保车辆</h3><div className="insurance-picker-toolbar"><input type="search" aria-label="搜索被保车辆" placeholder="搜索车牌 / VIN / 车型" value={keyword} disabled={disabled||denied} onChange={event=>{setKeyword(event.target.value);setPage(1);}}/><span>匹配 {data?.total??'—'} 辆 · 已选 {selectedIds.length} 辆</span><div className="insurance-picker-pages"><button type="button" className="button" aria-label="上一页车辆" disabled={disabled||denied||reading||page<=1} onClick={()=>setPage(value=>value-1)}>上一页</button><span>第 {page} 页</span><button type="button" className="button" aria-label="下一页车辆" disabled={disabled||denied||reading||!data||page*insuranceVehiclePageSize>=data.total} onClick={()=>setPage(value=>value+1)}>下一页</button></div></div></header>
  {currentError?<p role="alert">{currentError}<button type="button" className="text-button" disabled={disabled} onClick={()=>{setDenied(false);setRetry(value=>value+1);}}>重新读取车辆</button></p>:null}
  {!denied&&pinned.length?<div className="insurance-picker-pinned"><small>已选车辆（当前结果以外，切换查询不会取消）</small>{pinned.map(row)}</div>:null}
  {!denied?<div className="insurance-picker-results">{reading&&!data?<p role="status">正在检索车辆…</p>:data?.items.length?data.items.map(row):!currentError?<p>没有匹配车辆，已选车辆仍保留。</p>:null}</div>:null}
 </section>;
}
