import {useCallback,useEffect,useRef,useState} from 'react';
import {api,ApiError,can,date} from './core';
import {useCommandDisabled} from './domain-ui';
import {MediaScope,accessFailure,definiteFailure,mediaError,mediaOperator,mediaPath,mediaWritable,type MediaProps} from './vehicle-media';
import {checkCondition,conditionDraft,conditionFields,conditionMatches,conditionReceipt,type ConditionAssessment,type ConditionCommand,type ConditionDraft,type ConditionKey} from './vehicle-condition-model';
import './vehicle-condition.css';

export function VehicleConditionAssessment(props:MediaProps){
 return <MediaScope vehicleId={props.vehicleId} privateLabel="车况基础判断">{mediaOperator()&&can(api.session?.user.permissions||[],'vehicles.read')?<ConditionBody {...props}/>:<p>当前账号无权查看车况基础判断。</p>}</MediaScope>;
}
type Pending={body:ConditionCommand;accepted:boolean};
const emptyDraft:ConditionDraft={fireDamage:'',floodDamage:'',structuralDamage:''};
function ConditionBody({vehicleId,refreshKey=0,onUpdated}:MediaProps){
 const boundary=useCommandDisabled(),path=mediaPath(vehicleId)+'/condition-assessment',session=useRef(api.session),signature=useRef(JSON.stringify([api.session?.user.id,api.session?.user.role,api.session?.user.permissions]));
 const alive=useRef(false),controller=useRef(new AbortController()),sequence=useRef(0),running=useRef(false),pending=useRef<Pending|undefined>(undefined),latest=useRef<ConditionAssessment|undefined>(undefined),readingRef=useRef(true),failedRef=useRef(false),dirty=useRef(false),base=useRef<{revision:number;vehicleRevision:number}|undefined>(undefined),locked=useRef(boundary),updated=useRef(onUpdated);locked.current=boundary;updated.current=onUpdated;
 const[data,setData]=useState<ConditionAssessment>(),[draft,setDraft]=useState<ConditionDraft>(emptyDraft),[reason,setReason]=useState(''),[reading,setReading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[failed,setFailed]=useState(false),[denied,setDenied]=useState(false),[notice,setNotice]=useState(''),[phase,setPhase]=useState<'ready'|'retry'|'readback'|'conflict'>('ready');
 const current=useCallback(()=>alive.current&&session.current===api.session&&signature.current===JSON.stringify([api.session?.user.id,api.session?.user.role,api.session?.user.permissions])&&!controller.current.signal.aborted,[]);
 const reset=useCallback((value:ConditionAssessment)=>{setDraft(conditionDraft(value));setReason('');dirty.current=false;base.current={revision:value.revision,vehicleRevision:value.vehicleRevision};},[]);
 const failure=useCallback((e:unknown)=>{if(!alive.current||!accessFailure(e)&&!current())return;if(accessFailure(e)){pending.current=undefined;latest.current=undefined;setData(undefined);setDraft(emptyDraft);setReason('');setDenied(true);controller.current.abort();}failedRef.current=true;setFailed(true);setError(e);},[current]);
 const load=useCallback(async(resetDraft=false)=>{
  const token=++sequence.current;readingRef.current=true;setReading(true);
  try{const value=checkCondition(await api.request<unknown>(path,{signal:controller.current.signal,permission:'vehicles.read'}),vehicleId);if(!current()||token!==sequence.current)throw new Error('本次车况基础判断读取已失效。');latest.current=value;setData(value);failedRef.current=false;setFailed(false);setError(undefined);if(resetDraft||!dirty.current&&!pending.current)reset(value);return value;
  }catch(e){if(token===sequence.current&&alive.current&&(current()||accessFailure(e)))failure(e);throw e;}finally{if(current()&&token===sequence.current){readingRef.current=false;setReading(false);}}
 },[path,vehicleId,current,failure,reset]);
 useEffect(()=>{alive.current=true;controller.current=new AbortController();return()=>{alive.current=false;sequence.current++;controller.current.abort();pending.current=undefined;latest.current=undefined;};},[]);
 useEffect(()=>{void load().catch(()=>{});},[load,refreshKey]);
 const writable=mediaWritable(),complete=conditionFields.every(([key])=>draft[key]==='true'||draft[key]==='false'),reasonRequired=data?.registered===true,canSave=complete&&(!reasonRequired||!!reason.trim())&&reason.trim().length<=1000;
 const change=(key:ConditionKey,value:string)=>{if(!dirty.current&&latest.current)base.current={revision:latest.current.revision,vehicleRevision:latest.current.vehicleRevision};dirty.current=true;setDraft(old=>({...old,[key]:value}));setNotice('');};
 const save=async()=>{
  if(running.current||!current()||!can(api.session?.user.permissions||[],'vehicles.read')||phase==='conflict')return;
  const accepted=pending.current?.accepted===true;
  if(!accepted&&(!mediaWritable()||locked.current||readingRef.current||failedRef.current))return;
  running.current=true;setBusy(true);setError(undefined);setNotice('');
  try{
   if(!pending.current){const value=latest.current;if(!value||!canSave)throw new Error('请填写三项基础判断；修改已登记判断时还需填写修改原因。');if(base.current&&(base.current.revision!==value.revision||base.current.vehicleRevision!==value.vehicleRevision)){setPhase('conflict');throw new Error('记录版本已变化，请重新核对基础判断后再保存。');}pending.current={accepted:false,body:{revision:value.revision,vehicleRevision:value.vehicleRevision,idempotencyKey:crypto.randomUUID(),fireDamage:draft.fireDamage==='true',floodDamage:draft.floodDamage==='true',structuralDamage:draft.structuralDamage==='true',...(reason.trim()?{reason:reason.trim()}: {})}};}
   const command=pending.current;
   if(!command.accepted){try{const raw=await api.request<unknown>(path,{method:'POST',body:command.body,signal:controller.current.signal,permission:'vehicles.write'});command.accepted=true;conditionReceipt(raw,vehicleId,command.body);}catch(e){if(e instanceof ApiError&&e.code==='INVALID_RESPONSE'&&e.status>=200&&e.status<300)command.accepted=true;throw e;}}
   if(!current())return;setPhase('readback');const value=await load();if(!current())return;if(!conditionMatches(value,command.body))throw new Error('保存请求已受理，但当前记录尚未确认，请重新读取结果。');pending.current=undefined;setPhase('ready');reset(value);setNotice('车况基础判断已保存。');updated.current?.();
  }catch(e){if(accessFailure(e)){failure(e);return;}if(!current())return;setError(e);if(pending.current?.accepted)setPhase('readback');else if(definiteFailure(e)){pending.current=undefined;setPhase('conflict');}else if(pending.current)setPhase('retry');
  }finally{running.current=false;if(current())setBusy(false);}
 };
 const recheck=async()=>{if(running.current||!current())return;setBusy(true);setNotice('');try{await load(true);if(current()){pending.current=undefined;setPhase('ready');}}catch{}finally{if(current())setBusy(false);}};
 if(denied)return <p role="alert">车况基础判断访问权限已失效，请重新核对登录权限。</p>;
 const formLocked=!writable||boundary||busy||reading||failed||phase!=='ready';
 return <section className="vehicle-condition-card" aria-label="车况基础判断"><header><div><h3>车况基础判断</h3><p>上架前请填写三项基础判断，详细查验报告可按需补充。</p></div>{data?.registered?<small>最近核对 {date(data.assessedAt)}</small>:null}</header>
 {error?<p className="vehicle-condition-message" role="alert">{mediaError(error)}</p>:null}{notice?<p className="vehicle-condition-message" role="status">{notice}</p>:null}{reading&&!data?<p role="status">正在读取车况基础判断…</p>:null}
 {data?<form onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={formLocked}><div className="vehicle-condition-fields">{conditionFields.map(([key,label])=><label key={key}>{label}<select aria-label={label} value={draft[key]} onChange={event=>change(key,event.target.value)} required><option value="">未填写</option><option value="false">否</option><option value="true">是</option></select></label>)}</div>{reasonRequired?<label className="vehicle-condition-reason">修改原因<input aria-label="修改原因" maxLength={1000} required value={reason} onChange={event=>{dirty.current=true;setReason(event.target.value);setNotice('');}} placeholder="修改已登记判断时填写"/></label>:null}</fieldset>
 <div className="vehicle-condition-actions">{phase==='retry'||phase==='readback'?<button type="button" className="button" disabled={busy||reading||phase==='retry'&&(boundary||!writable||failed)} onClick={()=>void save()}>{busy?'正在核对…':phase==='retry'?'重试原请求':'重新读取结果'}</button>:phase==='conflict'?<><span>请重新读取并再次核对，当前输入将重置。</span><button type="button" className="button" disabled={busy||reading} onClick={()=>void recheck()}>重新核对基础判断</button></>:writable?<button type="submit" className="button primary" disabled={formLocked||!canSave}>{busy?'正在保存…':'保存基础判断'}</button>:<span>当前账号仅可查看基础判断。</span>}{failed&&(phase==='ready'||phase==='retry')?<button type="button" className="button" disabled={busy||reading} onClick={()=>void load().catch(()=>{})}>重新读取基础判断</button>:null}</div></form>:failed?<button type="button" className="button" disabled={busy||reading} onClick={()=>void load().catch(()=>{})}>重新读取基础判断</button>:null}
 </section>;
}
