import {useEffect,useState} from 'react';
import {api} from './core';
import {Command,Facts,rows,write,type Row} from './domain-ui';
import {ErrorNotice} from './ui';
import {InsuranceArchive} from './insurance-workspace';
const base='/admin/insurance-policies';
export function InsurancePage({renewals=false}:{renewals?:boolean}){return renewals?<RenewalPage/>:<InsuranceArchive/>;}
export function CoverageRequirements(){return <section className="panel module-empty"><h1>保障要求管理已停用</h1><p>请在保单档案核对真实原件、被保车辆和有效期；既有审核记录继续留存。</p></section>;}
function RenewalPage(){const[items,setItems]=useState<Row[]>([]),[error,setError]=useState<unknown>();const load=async()=>{try{const result=await api.request(base+'/renewal-reminders');setItems(rows(result));setError(undefined);}catch(e){setError(e);}};useEffect(()=>{void load();},[]);return <><div className="page-heading"><div><h1>续保待办</h1><p>续保提醒来自已登记保单的真实保障期限。</p></div></div>{write('insurance-policies')?<Command label="刷新续保待办" path={base+'/renewal-reminders/refresh'} revision={0} after={load}/>:null}{error?<ErrorNotice error={error}/>:null}{items.map(r=><section className="panel domain-version" key={r.id}><h3>续保提醒 · {r.thresholdDays}天</h3><Facts items={[["计划日期",r.dueAt,'date'],["状态",r.status,'status']]}/><a className="button" href="#insurance">打开保单办理</a></section>)}{!items.length&&!error?<section className="panel module-empty">当前暂无待办。</section>:null}</>;}
