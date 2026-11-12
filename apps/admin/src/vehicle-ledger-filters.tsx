import {useEffect,useState,type FormEvent} from 'react';
import {api,type Page} from './core';
import {ErrorNotice} from './ui';
import {vehicleLedgerFilters,type VehicleLedgerFilters as Filters} from './vehicle-ledger-filters-model';
import './vehicle-ledger-filters.css';
type Owner={id:string;name:string};
export function VehicleLedgerFilters({value,onApply}:{value:Filters;onApply:(filters:Filters)=>void}){
 const [draft,setDraft]=useState<Filters>(value),[open,setOpen]=useState(false),[owners,setOwners]=useState<Owner[]>([]),[asOf,setAsOf]=useState(''),[loading,setLoading]=useState(true),[readError,setReadError]=useState<unknown>(),[error,setError]=useState<unknown>();const signature=JSON.stringify(value);
 useEffect(()=>{setDraft(value);setError(undefined);},[signature]);
 useEffect(()=>{const controller=new AbortController();void(async()=>{try{const items:Owner[]=[];for(let page=1;page<=100;page++){const result=await api.request<Page<Owner>&{ageAsOf?:string}>(`/admin/vehicles/filter-options?page=${page}&pageSize=100`,{signal:controller.signal,permission:'vehicles.read'});if(controller.signal.aborted)return;if(!Array.isArray(result.items)||!Number.isSafeInteger(result.total))throw Error('合作商筛选目录不完整，请刷新车辆列表后重试');items.push(...result.items);if(result.ageAsOf&&/^\d{4}-\d{2}-\d{2}$/.test(result.ageAsOf))setAsOf(result.ageAsOf);if(items.length>=result.total)break;if(!result.items.length||page===100)throw Error('合作商目录未完整返回，请重新读取');}if(!controller.signal.aborted){setOwners(items);setReadError(undefined);}}catch(cause){if(!controller.signal.aborted)setReadError(cause);}finally{if(!controller.signal.aborted)setLoading(false);}})();return()=>controller.abort();},[]);
 const change=(key:keyof Filters,next:string)=>setDraft(previous=>({...previous,[key]:next}));
 const apply=(event:FormEvent)=>{event.preventDefault();try{onApply(vehicleLedgerFilters(draft));setError(undefined);}catch(cause){setError(cause);}};
 const count=Number(!!value.cooperationOwnerId)+Number(!!value.batteryOwnership)+Number(value.mileageKmMin!==undefined||value.mileageKmMax!==undefined)+Number(value.ageMonthsMin!==undefined||value.ageMonthsMax!==undefined);
 const number=(key:keyof Filters,label:string,placeholder:string)=><input aria-label={label} inputMode="numeric" maxLength={10} placeholder={placeholder} value={draft[key]||''} onChange={event=>change(key,event.target.value)}/>;
 return <><button type="button" className="button vehicle-more-filters" aria-expanded={open} onClick={()=>setOpen(previous=>!previous)}>更多筛选{count?`（${count}）`:''}</button><form className={'vehicle-ledger-filter-form'+(open?' is-open':'')} aria-label="车辆组合筛选" onSubmit={apply}>
  <select aria-label="合作商" className={!draft.cooperationOwnerId?'is-placeholder':undefined} value={draft.cooperationOwnerId||''} disabled={loading||!!readError} onChange={event=>change('cooperationOwnerId',event.target.value)}><option value="">{loading?'读取合作商…':'合作商'}</option>{draft.cooperationOwnerId&&!owners.some(owner=>owner.id===draft.cooperationOwnerId)?<option value={draft.cooperationOwnerId}>已选合作商（当前目录未返回）</option>:null}{owners.map(owner=><option value={owner.id} key={owner.id}>{owner.name}</option>)}</select>
  <select aria-label="电池方式" className={!draft.batteryOwnership?'is-placeholder':undefined} value={draft.batteryOwnership||''} onChange={event=>change('batteryOwnership',event.target.value)}><option value="">电池方式</option><option value="OWNED">电池买断</option><option value="BAAS">BaaS / 电池租用</option></select>
  <div className="vehicle-filter-range" role="group" aria-label="里程范围（km）">{number('mileageKmMin','最小里程（km）','里程下限 km')}<span>至</span>{number('mileageKmMax','最大里程（km）','里程上限 km')}<span>km</span></div>
  <div className="vehicle-filter-range" role="group" aria-label="车龄范围（月）" title="按首次登记日期计算完整月；未登记或未来日期不按0匹配">{number('ageMonthsMin','最小车龄（月）','车龄下限 月')}<span>至</span>{number('ageMonthsMax','最大车龄（月）','车龄上限 月')}<span>月</span></div>
  <button className="button primary">应用更多筛选</button><button type="button" className="button" onClick={()=>{setDraft({});setError(undefined);onApply({});}}>重置更多筛选</button>
  <small className="vehicle-filter-note">合作商按当前生效车辆归属；车龄按首次登记完整月{asOf?`，截至 ${asOf}`:''}。里程或登记日期缺失的车辆不按 0 匹配。</small>{readError?<ErrorNotice error={readError}/>:null}{error?<ErrorNotice error={error}/>:null}
 </form></>;
}
