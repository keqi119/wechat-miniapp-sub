import {useCallback,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {api,can} from './core';
import {Command,CommandBoundary,Facts,evidence,reason,endpoint,type Row} from './domain-ui';
import {ErrorNotice,Status} from './ui';
import {OrderContractPanel} from './order-contract-panel';
import {OrderFundsPanel,type OrderFocus} from './order-record-panel';
import {type OrderProcess} from './order-process';
import {cancellationContext,cancellationExternalRoute,cancellationStepAccessible,readCancellationReadiness,scopedCancellationAction,type CancellationReadiness} from './order-cancellation-model';
import {type ProcessAction,type ProcessCheck} from './process-guide-model';
import {processHref,rememberProcessPosition} from './process-navigation';
import {resourceHref,routeAllowed} from './modules/navigation';
import './order-cancellation.css';

type Props={order:Row;process?:OrderProcess|null;after:()=>void|Promise<void>;disabled?:boolean;refreshKey?:number;renderValues?:(value:Row)=>ReactNode;onOpenSection?:(section:string,focus?:OrderFocus)=>void;onOpenArchives?:()=>void};
const stepPreferences=new WeakMap<object,Map<string,{tab:string;currentStep:string}>>();
function rememberStep(session:object|null|undefined,orderId:string,tab:string,currentStep:string){if(!session)return;let values=stepPreferences.get(session);if(!values){values=new Map();stepPreferences.set(session,values);}values.set(orderId,{tab,currentStep});if(values.size>100)values.delete(values.keys().next().value!);}
const tabs=[{key:'EVIDENCE',label:'确认签署情况'},{key:'TERMINATION',label:'终止协议'},{key:'FUNDS',label:'资金核查'},{key:'CONFIRM',label:'确认取消'}];
export function OrderOfflineActions(props:Props){return <CancellationBody key={`${api.session?.user.id||''}:${String(props.order.id)}`} {...props}/>;}
function CancellationBody({order,process,after,disabled=false,refreshKey=0,renderValues=v=><pre>{JSON.stringify(v,null,2)}</pre>,onOpenSection}:Props){
 const orderId=String(order.id),session=api.session,user=session?.user,role=user?.role||'',operator=['ADMIN','OPERATIONS'].includes(role),allowed=['ADMIN','OPERATIONS','FINANCE'].includes(role)&&can(user?.permissions||[],'orders.read'),uid=useId();
 const preference=session?stepPreferences.get(session)?.get(orderId):undefined;
 const [readiness,setReadiness]=useState<CancellationReadiness|null>(null),[error,setError]=useState<unknown>(),[loading,setLoading]=useState(allowed),[readVersion,setReadVersion]=useState(0),[tab,setTab]=useState(preference?.tab||'EVIDENCE'),[receipt,setReceipt]=useState(''),[focus,setFocus]=useState<OrderFocus>(),[openCommand,setOpenCommand]=useState<string>();
 const generation=useRef(0),controller=useRef<AbortController|null>(null),root=useRef<HTMLElement>(null),mounted=useRef(true),positions=useRef<Record<string,number>>({}),lastCurrent=useRef<string|undefined>(preference?.currentStep);
 const read=useCallback(async()=>{if(!allowed)return;const token=++generation.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;setLoading(true);setError(undefined);
  try{const raw=await api.request<unknown>(`/admin/orders/${encodeURIComponent(orderId)}/cancellation-readiness`,{signal:abort.signal});if(!mounted.current||token!==generation.current)return;const value=readCancellationReadiness(raw,orderId);if(!value)throw new Error('取消条件与当前订单不一致，请重新读取。');setReadiness(value);setReadVersion(v=>v+1);
   const changed=lastCurrent.current!==value.currentStep;lastCurrent.current=value.currentStep;
   setTab(previous=>{const next=changed||!cancellationStepAccessible(value,previous)?value.currentStep:previous;rememberStep(session,orderId,next,value.currentStep);return next;});
  }catch(e){if(!mounted.current||token!==generation.current)return;setError(e);throw e;}finally{if(mounted.current&&token===generation.current)setLoading(false);}
 },[allowed,orderId,session]);
 useEffect(()=>{mounted.current=true;void read().catch(()=>{});return()=>{mounted.current=false;generation.current++;controller.current?.abort();};},[read,refreshKey]);
 const reload=async()=>{await read();await after();};
 const refresh=()=>{void reload().catch(setError);};
 const fresh=!disabled&&!loading&&!error&&!!readiness&&(!process||readiness.orderRevision===process.orderRevision);
 const writeEnabled=fresh&&operator&&can(user?.permissions||[],'orders.write')&&readiness?.mode==='PRE_DELIVERY_CANCEL'&&tab===readiness.currentStep;
 const actions=readiness?.actions.filter(a=>scopedCancellationAction(a,readiness,process))||[];
 const byKey=(key:string)=>actions.find(a=>a.key===key);
 const submit=byKey('SUBMIT_CANCELLATION_REVIEW'),review=byKey('REVIEW_CANCELLATION_EVIDENCE'),cancel=byKey('CANCEL_ORDER');
 const context=readiness&&process?cancellationContext(readiness,process):null;
 const choose=(key:string)=>{if(!readiness||!cancellationStepAccessible(readiness,key))return;const scroller=root.current?.closest<HTMLElement>('.detail-panel-scroll');if(scroller)positions.current[tab]=scroller.scrollTop;setTab(key);rememberStep(session,orderId,key,readiness.currentStep);requestAnimationFrame(()=>{if(scroller)scroller.scrollTop=positions.current[key]||0;});};
 const actionReason=(action:ProcessAction)=>{if(!fresh)return '当前资料尚未完整读取，刷新恢复后可办理。';if(!action.enabled)return action.disabledReason||'当前操作条件或岗位权限尚未满足。';if(!readiness||!scopedCancellationAction(action,readiness,process))return '本单关联资料尚未完整读取，请刷新核对。';if(['OPEN_CHANGE','OPEN_VEHICLE','OPEN_CONTRACT'].includes(action.key)){const route=cancellationExternalRoute(action,readiness);if(!route||!routeAllowed(route,role,user?.permissions||[]))return '当前岗位不能进入该资料，请由运营办理。';}return '';};
 const act=(action:ProcessAction)=>{if(!readiness||actionReason(action))return;const target=action.target!;
  if(['SUBMIT_CANCELLATION_REVIEW','REVIEW_CANCELLATION_EVIDENCE','CANCEL_ORDER'].includes(action.key)){choose(action.key==='CANCEL_ORDER'?'CONFIRM':'EVIDENCE');setOpenCommand(action.key);return;}
  if(action.key==='OPEN_ARCHIVE'&&target.id!==readiness.related.terminationArchive?.id){onOpenSection?.('contracts',{resource:'offline-archives',id:target.id,key:'OPEN_ARCHIVE',section:target.section,sequence:Date.now()});return;}
  if(['CREATE_ARCHIVE','OPEN_ARCHIVE'].includes(action.key)){choose('TERMINATION');setFocus({resource:'offline-archives',id:target.id,key:action.key,section:'TERMINATION',sequence:Date.now()});return;}
  if(['OPEN_BILL','OPEN_PAYMENT','REQUEST_REFUND','REVIEW_REFUND','SYNC_REFUND'].includes(action.key)){choose('FUNDS');setFocus({resource:target.resource!,id:target.id,key:action.key,section:'funds',sequence:Date.now()});return;}
  if(action.key==='OPEN_RETURN'){onOpenSection?.('handover');return;}
  if(action.key==='OPEN_SETTLEMENT'&&process?.related.settlements.some(row=>row.id===target.id)){onOpenSection?.('settlement',{resource:target.resource!,id:target.id,key:'OPEN_SETTLEMENT',sequence:Date.now()});return;}
  if(['OPEN_TASK','OPEN_HANDOVER'].includes(action.key)&&onOpenSection){onOpenSection('handover',{resource:target.resource!,id:target.id,key:action.key,sequence:Date.now()});return;}
  const route=cancellationExternalRoute(action,readiness);if(target.id&&route&&routeAllowed(route,role,user?.permissions||[])){rememberProcessPosition(user?.id||'');window.location.hash=processHref(resourceHref(route,target.id,target.section||'overview'),window.location.hash);}
 };
 useEffect(()=>{if(!openCommand)return;const frame=requestAnimationFrame(()=>{const node=root.current?.querySelector<HTMLElement>(`[data-process-action="cancel-${openCommand}"]`);const button=node?.querySelector<HTMLButtonElement>(':scope > button[aria-expanded]');if(button&&!button.disabled&&button.getAttribute('aria-expanded')!=='true')button.click();node?.scrollIntoView({block:'nearest'});setOpenCommand(undefined);});return()=>cancelAnimationFrame(frame);},[openCommand,tab]);
 const actionButton=(a:ProcessAction)=>{const explanation=actionReason(a);return <span className="order-cancel-action" key={`${a.key}-${a.target?.id||''}`}><button className="button" disabled={!!explanation} title={explanation||undefined} onClick={()=>act(a)}>{a.label}</button>{explanation?<small>{explanation}</small>:null}</span>;};
 const checks=(items:ProcessCheck[],withActions=true)=><ul className="order-cancel-checks">{items.map((c,i)=><li key={`${c.code}-${i}`}><div><strong>{c.label}</strong></div>{c.description?<p>{c.description}</p>:null}{withActions&&c.action?actionButton(c.action):null}</li>)}</ul>;
 const step=(key:string)=>readiness?.steps.find(s=>s.key===key);
 const stepStatus=(key:string)=>{const state=step(key)?.state;return state==='DONE'?'已完成':state==='NOT_APPLICABLE'?'无需办理':state==='WAITING'?'待前序完成':key===readiness?.currentStep?'当前待办':'待核对';};
 const body=()=>{
  if(!readiness)return <p className="muted">完整读取本单取消条件后才能办理。</p>;
  if(readiness.mode!=='PRE_DELIVERY_CANCEL')return <div className="order-cancel-result"><h3>{readiness.mode==='POST_DELIVERY_RETURN'?'车辆已交付，请办理还车与结算':readiness.orderStatus==='CANCELLED'?'订单已取消':'订单已完成'}</h3><p>{step('RESULT')?.summary||'正式交付后需办理还车与结算。'}</p>{actions.filter(a=>['OPEN_RETURN','OPEN_SETTLEMENT','OPEN_VEHICLE'].includes(a.key)).map(actionButton)}</div>;
  if(tab==='EVIDENCE')return <>
   <h3>确认签署情况</h3><p className="order-cancel-stage-note">{step('EVIDENCE')?.summary}</p>
   {!operator?<p className="muted">签署材料由平台运营办理，当前岗位不显示原件。</p>:<>
    {readiness.signing?.source==='ARCHIVE'?<p className="order-cancel-stage-finished">已签署 · 依据已审核的租赁签字合同</p>:null}
    {readiness.related.review?<><Facts items={[["签署情况",{UNSIGNED:'未签署',SIGNED:'已签署',UNKNOWN:'待核实'}[readiness.related.review.paperStatus as string]],['确认说明',readiness.related.review.reason]]}/>{Array.isArray(readiness.related.review.evidence)&&readiness.related.review.evidence.length?<div className="order-inline-actions">{readiness.related.review.evidence.map((file:Row)=><a className="button" key={file.id} href={endpoint('/admin/files/'+encodeURIComponent(file.id))} target="_blank" rel="noreferrer">{file.name||'签署依据材料'}</a>)}</div>:null}</>:null}
    {tab===readiness.currentStep?<>
     {review?.enabled?<Command processKey="cancel-REVIEW_CANCELLATION_EVIDENCE" disabled={!writeEnabled} label="确认已有签署记录" path={`/admin/orders/${encodeURIComponent(orderId)}/offline-cancellation/review`} revision={review.expectedRevision} fields={[{...reason,label:'确认说明'}]} build={v=>({...v,reviewId:readiness.related.review?.id,decision:'APPROVED'})} after={reload} successReceipt="实际签署情况已确认。"/>:null}
     <Command processKey="cancel-SUBMIT_CANCELLATION_REVIEW" disabled={!writeEnabled||!submit?.enabled} label={submit?.label||'确认签署情况'} path={`/admin/orders/${encodeURIComponent(orderId)}/offline-cancellation/submit`} revision={submit?.expectedRevision} fields={[{key:'paperStatus',label:'实际签署情况',kind:'select',required:true,choices:[{value:'UNSIGNED',label:'未签署'},{value:'SIGNED',label:'已签署'},{value:'UNKNOWN',label:'尚不能确定'}]},{...reason,label:'取消原因及确认说明'},{...evidence,label:'签署依据附件（选填）',required:false}]} initial={{paperStatus:String(readiness.related.review?.paperStatus||''),reason:String(readiness.related.review?.reason||'')}} after={reload} successReceipt="签署情况已保存。" nextStep="系统按签署情况解锁后续步骤。"/>
    </>:null}
   </>}{step('EVIDENCE')?.checks.length?checks(step('EVIDENCE')!.checks,false):null}
  </>;
  if(tab==='TERMINATION')return <><h3>终止协议</h3><p className="order-cancel-stage-note">{step('TERMINATION')?.summary}</p>{step('TERMINATION')?.state==='NOT_APPLICABLE'?null:operator&&context?<OrderContractPanel orderId={orderId} process={context} disabled={!fresh||tab!==readiness.currentStep} focus={focus} refreshKey={readVersion} after={reload}/>:<p className="muted">终止协议由平台运营办理。</p>}{step('TERMINATION')?.checks.some(c=>c.code==='ARCHIVE_FEEDBACK_OPEN')?checks(step('TERMINATION')!.checks.filter(c=>c.code==='ARCHIVE_FEEDBACK_OPEN')):null}</>;
  if(tab==='FUNDS')return <><h3>资金核查</h3><p className="order-cancel-stage-note">{step('FUNDS')?.summary}</p>{step('FUNDS')?.checks.length?checks(step('FUNDS')!.checks):null}{context?<OrderFundsPanel orderId={orderId} process={context} disabled={!fresh||tab!==readiness.currentStep} focus={focus} refreshKey={readVersion} after={reload} renderValues={renderValues}/>:<p className="muted">本单财务明细尚未完整读取，请刷新订单。</p>}</>;
  return <><h3>确认取消</h3>{step('CONFIRM')?.checks.length?checks(step('CONFIRM')!.checks):<p className="order-cancel-stage-finished">签署事项及资金已核清，可确认取消。</p>}
   <div className="order-cancel-effects"><h4>取消后的处理</h4><ul>{readiness.effects.map(text=><li key={text}>{text}</li>)}</ul></div>
   <Command processKey="cancel-CANCEL_ORDER" label="取消本单" path={`/admin/orders/${encodeURIComponent(orderId)}/cancel`} revision={cancel?.expectedRevision} fields={[{...reason,label:'取消原因'}]} initial={{reason:String(readiness.related.review?.reason||'')}} disabled={!writeEnabled||!readiness.canCancel||!cancel?.enabled} permission="orders.write" after={reload} note="系统会重新核验取消条件。" successReceipt="取消命令已提交。" nextStep="请以最新订单状态确认结果。"/>{!readiness.canCancel||!cancel?.enabled?<p className="muted">{cancel?.disabledReason||'请先完成待办事项。'}</p>:null}
  </>;
 };
 if(!allowed)return <p className="muted">当前岗位无取消条件读取权限。</p>;
 return <section className="order-cancellation order-cancellation-trial" ref={root} aria-label="本单取消办理">
  <div className="order-cancel-heading"><span>原订单：<Status value={readiness?.orderStatus||order.status}/></span><button className="text-button" onClick={refresh}>刷新取消条件</button></div>
  {loading?<p role="status">正在读取本单取消条件…</p>:null}{error?<ErrorNotice error={error} retry={refresh}/>:null}{readiness&&process&&readiness.orderRevision!==process.orderRevision?<p className="order-read-warning">订单版本已变化，请刷新本单；已保留输入，暂不能提交。</p>:null}{receipt?<p role="status" className="order-operation-receipt">{receipt}</p>:null}
  {readiness?.mode==='PRE_DELIVERY_CANCEL'?<div className="order-cancel-sequence" role="tablist" aria-label="取消办理步骤">{tabs.map((item,i)=><button key={item.key} id={`${uid}-${item.key}-tab`} role="tab" aria-controls={`${uid}-panel`} aria-selected={tab===item.key} disabled={!cancellationStepAccessible(readiness,item.key)} tabIndex={tab===item.key?0:-1} onClick={()=>choose(item.key)} onKeyDown={e=>{if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;e.preventDefault();const available=tabs.filter(x=>cancellationStepAccessible(readiness,x.key)),index=available.findIndex(x=>x.key===item.key);const next=e.key==='Home'?0:e.key==='End'?available.length-1:(index+(e.key==='ArrowRight'?1:-1)+available.length)%available.length;choose(available[next].key);document.getElementById(`${uid}-${available[next].key}-tab`)?.focus();}}><b>{i+1}</b><span><strong>{item.label}</strong><small>{stepStatus(item.key)}</small></span></button>)}</div>:null}
  <CommandBoundary disabled={!fresh} readVersion={readVersion} onCommitted={setReceipt}><section className="order-cancel-panel" id={`${uid}-panel`} role={readiness?.mode==='PRE_DELIVERY_CANCEL'?'tabpanel':undefined} aria-labelledby={readiness?.mode==='PRE_DELIVERY_CANCEL'?`${uid}-${tab}-tab`:undefined}>{body()}</section></CommandBoundary>
  {readiness?.attention.length?<details className="order-cancel-attention"><summary>办理提醒</summary>{checks(readiness.attention)}</details>:null}
 </section>;
}
