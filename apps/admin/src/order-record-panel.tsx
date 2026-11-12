import {OnlineHandoverFacts} from './online-handover-facts';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, ApiError, date, money, type Entity } from './core';
import { ErrorNotice, Loading, RecordForm, Status } from './ui';
import { actionAllowed, detailFor, resourceAccessible, resourceActionWritable, resourceWritable, resources, statusLabel, type Action } from './resources';
import { fieldsForAction, mutationPayload } from './form';
import { CommandIdentity } from './domain-commands';
import { actionPayload, relatedRecords, scopedRecord, processActions, refundableReceipt, type OrderProcess } from './order-process';
import { BillPublicationNotice } from './bill-publication-ui';
import { PaymentException } from './work-queue';
import { CommandBoundary } from './domain-ui';
import {processHref,rememberProcessPosition} from './process-navigation';
import './order-funds-table.css';

export type OrderFocus = { resource: string; id?: string; key?: string; section?: string; sequence: number };
type Props = { orderId: string; resource: string; rows: Entity[]; process: OrderProcess | null; disabled: boolean; focus?: OrderFocus; refreshKey: number; after: () => Promise<void>; renderValues: (value: Record<string, unknown>) => React.ReactNode };
export function OrderRecordPanel({ orderId, resource, rows, process, disabled, focus, refreshKey, after, renderValues }: Props) {
  const definition=resources.find(row=>row.key===resource),user=api.session?.user;
  const allowed=resourceAccessible(definition,user?.permissions||[],user?.role);
  const [selected,setSelected]=useState<string>(),[detail,setDetail]=useState<Entity>(),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
  const [action,setAction]=useState<Action>(),[refund,setRefund]=useState(false),[receipt,setReceipt]=useState(''),[readbackError,setReadbackError]=useState<unknown>(),[conflicted,setConflicted]=useState(false),[expanded,setExpanded]=useState(false);
  const identity=useRef(new CommandIdentity()),generation=useRef(0),detailElement=useRef<HTMLDivElement>(null),handledFocus=useRef<number|undefined>(undefined);
  const selectedRow=rows.find(row=>row.id===selected);
  useEffect(()=>{if(focus?.resource===resource&&rows.some(row=>row.id===focus.id)){setSelected(focus.id);setAction(undefined);setRefund(false);}},[focus?.sequence]);
  useLayoutEffect(()=>{detailElement.current?.scrollIntoView({block:'nearest'});},[selected]);
  useEffect(()=>{if(!selected||!selectedRow||!allowed){setDetail(undefined);return;}const g=++generation.current,controller=new AbortController();setBusy(true);setError(undefined);setConflicted(false);
    api.request<Entity>(`/admin/${resource}/${encodeURIComponent(selected)}`,{signal:controller.signal}).then(value=>{
      if(g!==generation.current)return;
      // Older money endpoints bind through the original bill/payment. Verify that chain against the scoped projection.
      const bound=scopedRecord(value,orderId) || (!value.orderId && resource==='payments' && typeof selectedRow.billId==='string' && value.billId===selectedRow.billId ? {...value,orderId} : !value.orderId && resource==='refunds' && typeof selectedRow.paymentId==='string' && value.paymentId===selectedRow.paymentId ? {...value,orderId} : null);
      if(!bound||bound.id!==selected)throw new Error('返回记录与当前订单不一致，请刷新订单');setDetail(bound);
    }).catch(e=>{if(g===generation.current&&e.name!=='AbortError')setError(e);}).finally(()=>{if(g===generation.current)setBusy(false);});
    return()=>{generation.current++;controller.abort();};
  },[orderId,resource,selected,allowed,refresh,refreshKey]);
  const fresh=!!detail&&detail.id===selected&&detail.orderId===orderId&&!busy&&!error&&!disabled&&!conflicted;
  useEffect(()=>{
    if(!fresh||!focus||focus.resource!==resource||focus.id!==detail?.id||handledFocus.current===focus.sequence||!definition)return;
    handledFocus.current=focus.sequence;
    if(focus.key==='REQUEST_REFUND'&&resource==='payments'&&detail.status==='SUCCEEDED'&&refundableReceipt(selectedRow)&&resourceWritable(resources.find(r=>r.key==='refunds')!,user?.permissions||[],user?.role)){setRefund(true);return;}
    const path=({REVIEW_REFUND:'approve',SYNC_REFUND:'sync',PUBLISH_HANDOVER:'publish',COMPLETE_HANDOVER:'complete',COMPLETE_SETTLEMENT:'complete'} as Record<string,string>)[focus.key||''];
    const next=definition.actions?.find(a=>a.path===path);
    if(next&&resourceActionWritable(definition,next,user?.permissions||[],user?.role)&&actionAllowed(resource,next,detail,user?.id)&&!(resource==='refunds'&&['approve','reject'].includes(next.path)&&detail.requestedBy===user?.id))setAction(next);
  },[fresh,focus?.sequence,detail?.id]);
  if(!definition||!allowed)return <p className="muted">当前岗位无此分区的读取权限。</p>;
  const commit=async(label:string,body:Record<string,unknown>,command?:Action)=>{
    if(!fresh||!detail||!process)throw new Error('当前状态尚未核对，请刷新订单后办理');
    const target=refund?'/admin/refunds':`/admin/${resource}/${encodeURIComponent(detail.id)}/${command!.path}`;
    const idem=identity.current.for(target,body);
    let payload:Record<string,unknown>;
    if(refund){const refundResource=resources.find(r=>r.key==='refunds')!;if(!resourceWritable(refundResource,user?.permissions||[],user?.role)||detail.status!=='SUCCEEDED'||!refundableReceipt(selectedRow))throw new Error('当前支付不允许申请退款，请刷新核对');payload=mutationPayload('refunds','create',{...body,paymentId:detail.id},idem);}
    else {if(!command||!resourceActionWritable(definition,command,user?.permissions||[],user?.role)||!actionAllowed(resource,command,detail,user?.id)||resource==='refunds'&&['approve','reject'].includes(command.path)&&detail.requestedBy===user?.id||resource==='handovers'&&command.path==='complete'&&!processActions(process).some(a=>a.key==='COMPLETE_HANDOVER'&&a.target?.id===detail.id&&a.enabled))throw new Error('当前记录不允许此操作，请刷新后核对');payload=actionPayload(resource,{...body,...command.fixed},detail,idem);}
    const g=generation.current;
    try{await api.request(target,{method:'POST',body:payload,permission:`${refund?'refunds':resource}.write`});}catch(e){if(e instanceof ApiError&&e.status===409)setConflicted(true);throw e;}
    if(g!==generation.current)return;
    setAction(undefined);setRefund(false);setReceipt(`${label}已提交。`);setReadbackError(undefined);
    try{await after();setRefresh(value=>value+1);}catch(e){setReadbackError(e);}
  };
  const visibleActions=detail?(definition.actions||[]).filter(a=>resourceActionWritable(definition,a,user?.permissions||[],user?.role)&&actionAllowed(resource,a,detail,user?.id)&&!(resource==='refunds'&&['approve','reject'].includes(a.path)&&detail.requestedBy===user?.id)&&!(resource==='handovers'&&a.path==='prepare-signature')&&!(resource==='handovers'&&a.path==='complete'&&!(process&&processActions(process).some(a=>a.key==='COMPLETE_HANDOVER'&&a.target?.id===detail.id&&a.enabled)))):[];
  const canRefund=resource==='payments'&&detail?.status==='SUCCEEDED'&&refundableReceipt(selectedRow)&&resourceWritable(resources.find(r=>r.key==='refunds')!,user?.permissions||[],user?.role);
  const visibleRows=expanded?rows:[...rows.slice(0,3),...(selectedRow&&!rows.slice(0,3).includes(selectedRow)?[selectedRow]:[])];
  return <section className="order-related-panel" aria-label={definition.title}>
    <h3>{definition.title}</h3>
    {!rows.length?<p className="muted">本单暂无当前岗位可查看的{definition.singular}。</p>:<div className="order-record-list">{visibleRows.map(row=><article className="order-record-summary" key={row.id}><div><strong>{recordTitle(resource,row)}</strong> <Status resource={resource} value={row.reconciliationRequired?'RECONCILIATION_REQUIRED':row.status}/><small>{row.id}</small></div>{resource==='bills'?<><p>应付 {money(row.amount)} · 已收 {money(row.receivedAmount)} · 已退 {money(row.refundedAmount)} · 净收 {money(row.netReceivedAmount)}</p><p className="muted">到期日 {date(row.dueDate,true)}</p><BillPublicationNotice bill={row} compact/></>:resource==='payments'?<p>到账 {money(row.amount)} · 已退 {money(row.refundedAmount)} · 净收 {money(row.netReceivedAmount)}</p>:resource==='refunds'?<p>退款金额 {money(row.amount)}</p>:resource==='handover-tasks'?<p>现场人员：{String(row.assigneeName||'待核对')}</p>:null}<button className="button" aria-expanded={selected===row.id} onClick={()=>{setSelected(selected===row.id?undefined:row.id);setAction(undefined);setRefund(false);setReceipt('');}}> {selected===row.id?'收起':'查看与办理'}</button></article>)}</div>}{rows.length>3?<button className="text-button" onClick={()=>setExpanded(v=>!v)}>{expanded?'收起其他记录':`查看全部 ${rows.length} 条记录`}</button>:null}
    {selected&&selectedRow?<div ref={detailElement} className="order-inline-detail"><div className="order-panel-heading"><h4>{recordTitle(resource,selectedRow)}</h4><button className="text-button" onClick={()=>setRefresh(v=>v+1)}>刷新记录</button></div>
      {error?<ErrorNotice error={error} retry={()=>setRefresh(v=>v+1)}/>:null}{busy?<Loading label="正在核对本单记录"/>:null}
      {conflicted?<p className="muted">输入已保留，请先刷新本条记录，核对新状态后再决定是否提交。</p>:null}{receipt?<p className="order-operation-receipt" role="status">{receipt}{readbackError?'已写入，但最新进度读取失败。请刷新核对，勿重复提交。':'已重新核对本单进度。'}</p>:null}{readbackError?<ErrorNotice error={readbackError} retry={()=>{void after().then(()=>{setReadbackError(undefined);setRefresh(v=>v+1);}).catch(setReadbackError);}}/>:null}
      {detail&&detail.id===selected?<><div className="order-inline-actions">{visibleActions.map((a,index)=><button key={`${a.path}-${index}`} disabled={!fresh} className={`button ${a.kind||''}`} onClick={()=>{setAction(a);setRefund(false);}}>{a.label}</button>)}{canRefund?<button disabled={!fresh} className="button" onClick={()=>{setAction(undefined);setRefund(true);}}>申请原路退款</button>:null}</div>
        {resource==='payments'?<CommandBoundary disabled={!fresh||!resourceWritable(definition,user?.permissions||[],user?.role)} onCommitted={setReceipt}><PaymentException payment={detail} after={async()=>{try{await after();setRefresh(v=>v+1);}catch(e){setReadbackError(e);throw e;}}}/></CommandBoundary>:null}
        {action||refund?<RecordForm key={`${selected}-${refund?'refund':action?.label}`} fields={refund?resources.find(r=>r.key==='refunds')!.fields!.filter(f=>f.key!=='paymentId'):fieldsForAction(resource,action!,detail)} initial={detail} warning={refund?'退款将绑定本笔支付，审核通过后按原渠道执行。':action?.warning} submitLabel={refund?'提交退款申请':action!.label} submitDisabled={!fresh} onSubmit={body=>commit(refund?'退款申请':action!.label,body,action)} onCancel={()=>{setAction(undefined);setRefund(false);}}/>:null}
        {resource==='handovers'?<OnlineHandoverFacts record={detail}/>:null}
        <details className="order-facts"><summary>查看完整记录</summary>{renderValues(detailFor(resource,detail))}</details>
      </>:null}
    </div>:null}
  </section>;
}
export function recordTitle(resource:string,row:Entity):string {
  if(resource==='bills')return row.type==='PAYMENT_TEST'?'支付链路测试款':`${statusLabel(String(row.type))}${row.sequence?` · 第 ${row.sequence} 期`:''}`;
  if(resource==='handover-tasks'||resource==='handovers')return `${statusLabel(String(row.type))}${resource==='handover-tasks'?'任务':'记录'}`;
  return ({payments:'支付记录',refunds:'退款记录','return-settlements':'退订结算'} as Record<string,string>)[resource]||String(row.title||row.name||row.id);
}
const fundsTabs=[{key:'bills',label:'账单'},{key:'payments',label:'收款'},{key:'refunds',label:'退款'}];
// Preferences contain no business data and disappear with the login session.
const fundsPreferences=new WeakMap<object,Map<string,string>>();
export function OrderFundsPanel(props:Omit<Props,'resource'|'rows'>) {
  const session=api.session,user=session?.user,permitted=(key:string)=>resourceAccessible(resources.find(r=>r.key===key),user?.permissions||[],user?.role);
  const tabs=fundsTabs.filter(tab=>permitted(tab.key));
  if(session&&!fundsPreferences.has(session))fundsPreferences.set(session,new Map());
  const preferences=session?fundsPreferences.get(session):undefined;
  const [tab,setTab]=useState(preferences?.get(props.orderId)||tabs[0]?.key||'bills'),handled=useRef<number|undefined>(undefined);
  const current=tabs.some(t=>t.key===tab)?tab:tabs[0]?.key||'bills';
  const rows=props.process?.orderId===props.orderId?relatedRecords(props.process,current).filter(row=>scopedRecord(row,props.orderId)):[];
  const choose=(key:string)=>{setTab(key);preferences?.set(props.orderId,key);};
  useEffect(()=>{setTab(preferences?.get(props.orderId)||tabs[0]?.key||'bills');},[props.orderId,session]);
  const open=(resource:string,row:Entity)=>{
    if(!permitted(resource)||!scopedRecord(row,props.orderId))return;
    preferences?.set(props.orderId,resource);rememberProcessPosition(user?.id||'');
    window.location.hash=processHref(`#${resource}?record=${encodeURIComponent(row.id)}&view=overview`,window.location.hash);
  };
  useEffect(()=>{
    const focus=props.focus;if(!focus||handled.current===focus.sequence||props.disabled||!props.process||!fundsTabs.some(tab=>tab.key===focus.resource))return;
    const row=relatedRecords(props.process,focus.resource).find(row=>row.id===focus.id&&scopedRecord(row,props.orderId));
    if(!row||!permitted(focus.resource))return;handled.current=focus.sequence;open(focus.resource,row);
  },[props.focus?.sequence,props.disabled,props.process]);
  if(!tabs.length)return <p className="muted">当前岗位没有资金资料读取权限。</p>;
  const amount=(row:Entity,key:string,label:string)=><button className="funds-amount" aria-label={label} onClick={()=>open(current,row)}>{money(row[key])}</button>;
  const title=()=>`本单${fundsTabs.find(t=>t.key===current)!.label}`;
  return <section className="order-funds-table" aria-label="本单资金明细">
    <div className="funds-toolbar"><div role="tablist" aria-label="资金分类">{tabs.map((item,i)=><button role="tab" key={item.key} aria-selected={current===item.key} tabIndex={current===item.key?0:-1} onClick={()=>choose(item.key)} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;choose(tabs[n].key);(e.currentTarget.parentElement?.children[n]as HTMLElement)?.focus();}}>{item.label} <span>{props.process?relatedRecords(props.process,item.key).filter(row=>scopedRecord(row,props.orderId)).length:0}</span></button>)}</div><span className="muted">点击金额查看详情</span></div>
    {!rows.length?<p className="muted">本单暂无{fundsTabs.find(t=>t.key===current)?.label}记录。</p>:<div className="funds-table-scroll"><table aria-label={title()}><thead><tr>{(current==='bills'?['账单 / 期次','到期日','应付','实收','已退','净收','状态']:current==='payments'?['收款记录','时间','支付金额','已退','净收','状态']:['退款记录','时间','退款金额','状态']).map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id}>
      <td>{current==='bills'?recordTitle(current,row):<span className="funds-record-id" title={row.id}>{row.id}</span>}</td>
      <td>{date(current==='bills'?row.dueDate:row.paidAt||row.succeededAt||row.createdAt,true)}</td>
      {current==='bills'?<>{['amount','receivedAmount','refundedAmount','netReceivedAmount'].map((key,i)=><td className="funds-number" key={key}>{amount(row,key,`查看${row.sequence?`第 ${row.sequence} 期`:'本笔'}账单${['应付','实收','已退','净收'][i]}金额`)}</td>)}</>:current==='payments'?<>{['amount','refundedAmount','netReceivedAmount'].map((key,i)=><td className="funds-number" key={key}>{amount(row,key,`查看${['收款','收款已退','收款净收'][i]}金额 ${row.id}`)}</td>)}</>:<td className="funds-number">{amount(row,'amount',`查看退款金额 ${row.id}`)}</td>}
      <td><Status resource={current} value={row.reconciliationRequired?'RECONCILIATION_REQUIRED':row.status}/></td>
    </tr>)}</tbody></table></div>}
  </section>;
}
