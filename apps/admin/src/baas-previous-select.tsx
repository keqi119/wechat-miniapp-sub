import {useEffect,useState} from 'react';
import {api} from './core';
import {useBaasLease} from './baas-session';
import {readBaasPreviousCandidates,type BaasPreviousCandidate} from './baas-previous-model';
import './baas-save-fix.css';

export function BaasPreviousSelect({vehicleId,currentId,value,onChange,disabled=false}:{vehicleId:string;currentId?:string;value:string;onChange:(value:string)=>void;disabled?:boolean}){
 const [rows,setRows]=useState<BaasPreviousCandidate[]>([]),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0),lease=useBaasLease();
 useEffect(()=>{
  setRows([]);setFailed(false);if(!vehicleId)return;
  const controller=new AbortController();setLoading(true);
  void readBaasPreviousCandidates(path=>api.request(path,{permission:'baas-contracts.read',signal:controller.signal}),vehicleId,currentId).then(result=>{if(!controller.signal.aborted&&lease.current())setRows(result);}).catch(()=>{if(!controller.signal.aborted&&lease.current())setFailed(true);}).finally(()=>{if(!controller.signal.aborted&&lease.current())setLoading(false);});
  return()=>controller.abort();
 },[vehicleId,currentId,attempt]);
 if(!lease.valid)return null;
 const retained=!!value&&!rows.some(row=>row.id===value);
 return <div className="baas-previous-choice"><label><span>承接原合同（选填）</span><select aria-label="承接原合同（选填）" value={value} disabled={disabled||!vehicleId} onChange={event=>onChange(event.target.value)}><option value="">无承接（独立合同）</option>{retained?<option value={value} disabled>现有关联（待核实，保持不变）</option>:null}{rows.map(row=><option value={row.id} key={row.id}>{row.contractNumber}{row.provider?' · '+row.provider:''}{row.effectiveFrom?' · '+row.effectiveFrom+' 至 '+(row.effectiveTo||'长期'):''}</option>)}</select></label>
  <small>仅在续接本车曾启用的合同时选择；普通独立合同保持“无承接”。</small>
  {loading?<small role="status">正在读取本车历史合同…</small>:null}
  {retained&&!loading?<small className="baas-previous-warning">原有关联暂不可核实，已保留。可继续修改其他资料；如需取消，请明确选择“无承接”。</small>:null}
  {failed?<small className="baas-previous-warning">本车历史合同目录暂不可读取；现有选择保持不变，不影响保存其他资料。<button type="button" className="text-button" disabled={disabled} onClick={()=>setAttempt(value=>value+1)}>重读原合同目录</button></small>:null}
 </div>;
}
