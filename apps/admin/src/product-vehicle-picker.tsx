import {useEffect,useRef,useState} from 'react';
import {api,can,type Page} from './core';
import {ErrorNotice,Loading} from './ui';
import {vehicleFilterQuery,mergeVehicleSelection,loadMatchingVehicleIds,type VehicleFilters} from './product-vehicle-selection';
import './product-vehicle-picker.css';

type VehicleChoice={id:string;title:string;registeredOwnerName:string|null;brand:string;model:string;modelYear:number|null;ageMonths:number|null;mileageKm:number;plateNumber:string|null;vin:string|null;batteryOwnership:'OWNED'|'BAAS'|'UNKNOWN';batteryCapacityKwh:string|null};
type VehicleResults=Page<VehicleChoice>&{ageAsOf?:string};
type Props={value:string[];onChange:(ids:string[])=>void;disabled:boolean};
const fields:{key:keyof VehicleFilters;label:string;numeric?:boolean}[]=[
 {key:'registeredOwnerName',label:'车辆登记人'},{key:'brand',label:'品牌'},{key:'model',label:'车型'},
 {key:'modelYear',label:'年款',numeric:true},{key:'ageMonthsMin',label:'最小车龄（月）',numeric:true},{key:'ageMonthsMax',label:'最大车龄（月）',numeric:true},
 {key:'mileageKmMin',label:'最小公里数',numeric:true},{key:'mileageKmMax',label:'最大公里数',numeric:true},{key:'plateNumber',label:'车牌号'},{key:'vin',label:'VIN码'},
];
function sessionScope(){const user=api.session?.user;return JSON.stringify([user?.id,user?.role,user?.permissions]);}
export function ProductVehiclePicker(props:Props){
 const identity=sessionScope(),scope=useRef({session:api.session,identity,generation:0}),committedScope=useRef(0);
 if(scope.current.session!==api.session||scope.current.identity!==identity)scope.current={session:api.session,identity,generation:scope.current.generation+1};
 const generation=scope.current.generation;
 useEffect(()=>{if(committedScope.current!==generation){committedScope.current=generation;props.onChange([]);}},[generation,props.onChange]);
 const allowed=['ADMIN','OPERATIONS'].includes(api.session?.user.role||'')&&can(api.session?.user.permissions||[],'vehicles.read');
 return allowed?<VehiclePicker key={generation} {...props} value={committedScope.current===generation?props.value:[]}/>:<p className="muted">当前岗位无车辆选择权限。</p>;
}
function VehiclePicker({value,onChange,disabled}:Props){
 const[filters,setFilters]=useState<VehicleFilters>({}),[query,setQuery]=useState(''),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
 const[result,setResult]=useState<VehicleResults>(),[loading,setLoading]=useState(true),[error,setError]=useState<unknown>(),[bulkBusy,setBulkBusy]=useState(false);
 const bulk=useRef<AbortController|null>(null),scope=useRef({session:api.session,key:sessionScope()}),latest=useRef({value,onChange,disabled});latest.current={value,onChange,disabled};
 const currentScope=()=>scope.current.session===api.session&&scope.current.key===sessionScope();
 const url=(targetPage:number,pageSize=20)=>{const params=new URLSearchParams(query);params.set('view','product-selection');params.set('page',String(targetPage));params.set('pageSize',String(pageSize));return '/admin/vehicles?'+params;};
 useEffect(()=>{const controller=new AbortController();bulk.current?.abort();setBulkBusy(false);setLoading(true);setResult(undefined);setError(undefined);
  void api.request<VehicleResults>(url(page),{signal:controller.signal,permission:'vehicles.read'}).then(data=>{if(!controller.signal.aborted&&currentScope())setResult(data);}).catch(cause=>{if(!controller.signal.aborted)setError(cause);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[query,page,refresh]);
 useEffect(()=>()=>bulk.current?.abort(),[]);
 const apply=()=>{try{const next=vehicleFilterQuery(filters).toString();bulk.current?.abort();setQuery(next);setPage(1);setRefresh(n=>n+1);}catch(cause){setError(cause);}};
 const change=(matching:string[],mode:'add'|'remove')=>{if(disabled||bulkBusy||!currentScope())return;try{onChange(mergeVehicleSelection(value,matching,mode));setError(undefined);}catch(cause){setError(cause);}};
 const all=async(mode:'add'|'remove')=>{
  if(disabled||loading||bulkBusy||!result||!currentScope())return;const controller=new AbortController();bulk.current?.abort();bulk.current=controller;setBulkBusy(true);setError(undefined);
  try{const ids=await loadMatchingVehicleIds(targetPage=>api.request<VehicleResults>(url(targetPage,100),{signal:controller.signal,permission:'vehicles.read'}),controller.signal);
   if(!currentScope()||controller.signal.aborted||latest.current.disabled)return;
   latest.current.onChange(mergeVehicleSelection(latest.current.value,ids,mode));
  }catch(cause){if(!controller.signal.aborted)setError(cause);}finally{if(bulk.current===controller){setBulkBusy(false);bulk.current=null;}}
 };
 const blocked=disabled||loading||bulkBusy,pageIds=result?.items.map(vehicle=>vehicle.id)||[];
 return <section className="product-vehicle-picker" aria-label="适用车辆筛选选择">
  <div className="product-vehicle-filter-grid">{fields.map(field=><label key={field.key}>{field.label}<input aria-label={field.label} type={field.numeric?'number':'text'} min={field.numeric?0:undefined} step={field.numeric?1:undefined} maxLength={200} value={filters[field.key]||''} disabled={disabled||bulkBusy} placeholder={field.key==='modelYear'?'如 2024':undefined} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();apply();}}} onChange={event=>setFilters(old=>({...old,[field.key]:event.target.value}))}/></label>)}<label>电池买断/BaaS<select aria-label="电池买断/BaaS" value={filters.batteryOwnership||''} disabled={disabled||bulkBusy} onChange={event=>setFilters(old=>({...old,batteryOwnership:event.target.value}))}><option value="">全部电池方式</option><option value="OWNED">电池买断</option><option value="BAAS">BaaS租用</option></select></label><label>电池规格（kWh）<input aria-label="电池规格（kWh）" type="number" min="0.001" max="99999.999" step="0.001" placeholder="如 75 / 100" value={filters.batteryCapacityKwh||''} disabled={disabled||bulkBusy} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();apply();}}} onChange={event=>setFilters(old=>({...old,batteryCapacityKwh:event.target.value}))}/></label></div>
  <div className="product-vehicle-picker-toolbar"><button type="button" className="button primary" disabled={disabled||bulkBusy} onClick={apply}>筛选车辆</button><button type="button" className="button" disabled={disabled||bulkBusy} onClick={()=>{setFilters({});setQuery('');setPage(1);setRefresh(n=>n+1);}}>重置筛选</button><span role="status">匹配 {result?.total??'—'} 辆 · 已选 {value.length} 辆</span></div>
  <p className="product-vehicle-picker-note">登记人取机动车登记证上的所有人；车龄按首次登记日期计算，年款取车型资料。更换筛选条件会保留已选车辆。</p>
  {error?<ErrorNotice error={error}/>:null}
  <div className="product-vehicle-picker-toolbar"><button type="button" className="button" disabled={blocked||!result?.total} onClick={()=>void all('add')}>全选筛选结果</button><button type="button" className="button" disabled={blocked||!result?.total||!value.length} onClick={()=>void all('remove')}>取消选择筛选结果</button><button type="button" className="text-button" disabled={disabled||bulkBusy||!value.length} onClick={()=>onChange([])}>清空已选</button>{bulkBusy?<span role="status">正在读取全部筛选结果…</span>:null}</div>
  {loading?<Loading label="读取适用车辆"/>:result?<><div className="product-vehicle-picker-table"><table><thead><tr><th><input type="checkbox" aria-label="选择本页车辆" disabled={blocked||!pageIds.length} checked={!!pageIds.length&&pageIds.every(id=>value.includes(id))} onChange={event=>change(pageIds,event.target.checked?'add':'remove')}/></th>{['车辆','登记人','品牌 / 车型','电池方式','电池规格','年款','车龄','公里数','车牌号 / VIN'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{result.items.map(vehicle=><tr key={vehicle.id}><td><input type="checkbox" aria-label={'选择车辆 '+vehicle.title} disabled={blocked} checked={value.includes(vehicle.id)} onChange={event=>change([vehicle.id],event.target.checked?'add':'remove')}/></td><td>{vehicle.title}</td><td>{vehicle.registeredOwnerName||'未登记'}</td><td>{[vehicle.brand,vehicle.model].filter(Boolean).join(' / ')||'未登记'}</td><td className="product-battery-cell">{vehicle.batteryOwnership==='OWNED'?'电池买断':vehicle.batteryOwnership==='BAAS'?'BaaS租用':'未登记'}</td><td className="product-battery-cell">{vehicle.batteryCapacityKwh!=null&&Number.isFinite(Number(vehicle.batteryCapacityKwh))&&Number(vehicle.batteryCapacityKwh)>0?Number(vehicle.batteryCapacityKwh)+' kWh':'未登记'}</td><td>{vehicle.modelYear?vehicle.modelYear+'款':'未登记'}</td><td>{vehicle.ageMonths==null?'未登记':vehicle.ageMonths+'个月'}</td><td>{Number.isFinite(vehicle.mileageKm)?vehicle.mileageKm.toLocaleString()+' km':'未登记'}</td><td>{vehicle.plateNumber||'未登记车牌'}<small>{vehicle.vin||'未登记VIN'}</small></td></tr>)}</tbody></table>{!result.items.length?<p className="product-vehicle-picker-empty">没有符合条件的车辆，请调整筛选。</p>:null}</div>
   <div className="product-vehicle-picker-pagination"><span>{result.ageAsOf?'车龄截至 '+result.ageAsOf:''}</span><div><button type="button" className="button" disabled={blocked||page===1} onClick={()=>setPage(n=>n-1)}>上一页车辆</button><span>第 {page} 页</span><button type="button" className="button" disabled={blocked||page*20>=result.total} onClick={()=>setPage(n=>n+1)}>下一页车辆</button></div></div></>:null}
 </section>;
}
