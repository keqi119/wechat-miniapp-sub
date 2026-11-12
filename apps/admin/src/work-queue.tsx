import {useEffect,useRef,useState} from 'react';
import {api,can,money} from './core';
import {Command,Facts,evidence,endpoint,own,rows,type Row} from './domain-ui';
import {ErrorNotice} from './ui';
type PaymentExceptionProps={payment:Row;after?:()=>Promise<void>|void};
export function PaymentException(props:PaymentExceptionProps){return <PaymentExceptionBody key={props.payment.id} {...props}/>;}
function PaymentExceptionBody({payment,after}:PaymentExceptionProps){
 const sequence=useRef(0);const[loading,setLoading]=useState(true);
 const[items,setItems]=useState<Row[]>([]),[resolutions,setResolutions]=useState<string[]>([]),[error,setError]=useState<unknown>(),[refresh,setRefresh]=useState(0),finance=['ADMIN','FINANCE'].includes(api.session?.user.role||''),path=`/admin/payments/${payment.id}/reconciliations`;
 useEffect(()=>{setResolutions([]);setItems([]);},[finance,path]);
 const read=async()=>{if(!finance)return;const stamp=++sequence.current;setLoading(true);setError(undefined);try{const r=await api.request<Row>(path);if(stamp!==sequence.current)return;setItems(rows(r));setResolutions((Array.isArray(r.allowedResolutions)?r.allowedResolutions:[]).filter((v:string)=>['APPLY_TO_BILL','REFUNDED'].includes(v)));}catch(e){if(stamp===sequence.current)setError(e);throw e;}finally{if(stamp===sequence.current)setLoading(false);}};
 useEffect(()=>{void read().catch(()=>{});return()=>{sequence.current++;};},[finance,path,refresh,payment.revision]);
 const reload=async()=>{await read();await after?.();};return <>{payment.reconciliationRequired===true?<div className="action-warning" role="alert"><div><strong>到账异常，待核对</strong><p>渠道到账已留存，尚未计入本单履约款项。请财务核对订单、账单及退款状态；异常处理前不能据此交车。</p></div></div>:null}{finance?<section className="domain-section"><h3>异常到账核对记录</h3>{loading?<p role="status">正在核对最新到账处理状态，输入已保留。</p>:null}{error?<ErrorNotice error={error} retry={()=>{void reload().catch(()=>{});}}/>:null}{items.map(r=><section className="domain-version" key={r.id}><Facts items={[["处理方式",r.resolution==='APPLY_TO_BILL'?'计入原账单':'确认已完整退款'],['状态',r.status,'status'],['核对说明',r.note]]}/>{(r.evidenceFileIds||[]).map((id:string,i:number)=><a className="button" key={id} href={endpoint('/admin/files/'+encodeURIComponent(id))} target="_blank" rel="noreferrer">核对依据 {i+1}</a>)}{r.status==='SUBMITTED'&&!own(r.submittedBy)?<Command disabled={loading||!!error} label="独立复核到账处理" path={path+'/'+r.id+'/review'} revision={payment.revision} fields={[{key:'decision',label:'复核结论',kind:'select',required:true,choices:[{value:'APPROVED',label:'通过'},{value:'REJECTED',label:'退回'}]},{key:'note',label:'复核说明',kind:'textarea',required:true}]} after={reload} note="材料上传人和提交人不能复核。计入原账单前会再次验证合同、款项、原交易及退款状态。"/>:null}</section>)}{payment.reconciliationRequired===true&&resolutions.length>0&&!items.some(r=>r.status==='SUBMITTED')?<Command disabled={loading||!!error} label="提交异常到账核对" path={path} revision={payment.revision} fields={[{key:'resolution',label:'核对处理方式',kind:'select',required:true,choices:resolutions.map(value=>({value,label:value==='APPLY_TO_BILL'?'核实后计入原账单':'已完整退款，核对退款结清'}))},{key:'note',label:'核对说明',kind:'textarea',required:true},evidence]} after={reload} note="登记事实与依据，提交给另一名财务复核。仅押金和订阅账单支持核实后计入；其他费用按完整退款核对处理。本操作不会扣款或发起退款。"/>:null}</section>:null}</>;
}
type Queue={key:string;title:string;count:number;ownerRole:string;ownerLabel:string;resource:string;href:string;instruction:string};
export function WorkQueue(){
 const[payments,setPayments]=useState<Row[]>([]),[total,setTotal]=useState(0),[paymentError,setPaymentError]=useState<unknown>(),[queues,setQueues]=useState<Queue[]|null>(null),[error,setError]=useState<unknown>(),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const permissions=api.session?.user.permissions||[],permissionKey=permissions.join('|'),role=api.session?.user.role||'',funds=['ADMIN','OPERATIONS','FINANCE'].includes(role)&&can(permissions,'payments.read');
 useEffect(()=>{
  let active=true;setLoading(true);setError(undefined);setQueues(null);
  api.request<Row>('/admin/dashboard',{permission:'dashboard.read'}).then(result=>{
   const source=result.workbench?.queues;if(!Array.isArray(source))throw new Error('待办汇总暂未返回，请刷新或联系管理员核对服务版本。');
   const visible=source.filter((q:Queue)=>Number.isSafeInteger(q.count)&&q.count>=0&&typeof q.href==='string'&&/^#[a-z][a-z0-9-]*(?:\?[^#]*)?$/.test(q.href)&&can(permissions,q.resource+'.read')&&can(permissions,q.resource+'.write')&&(role==='ADMIN'||role===q.ownerRole||(role==='OPERATIONS'&&q.ownerRole==='SUPPORT')));
   if(active)setQueues(visible);
  }).catch(reason=>{if(active)setError(reason);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[role,permissionKey,refresh]);
 useEffect(()=>{
  setPayments([]);setTotal(0);setPaymentError(undefined);if(!funds)return;let active=true;
  api.request<Row>('/admin/payments?reconciliationRequired=true&pageSize=5&page=1').then(r=>{if(active){setPayments(rows(r).filter(v=>v.reconciliationRequired===true));setTotal(Number(r.total)||0);}}).catch(reason=>{if(active)setPaymentError(reason);});return()=>{active=false;};
 },[funds,role,refresh]);
 const pending=queues?.filter(q=>q.count>0)||[];
 return <section className="domain-section" aria-label="本岗位待办"><div className="section-heading"><h2>本岗位待办</h2><button className="text-button" onClick={()=>setRefresh(v=>v+1)} disabled={loading}>刷新待办</button></div><p className="muted">按负责岗位汇总待处理记录；进入详情后核对当前版本和独立审核条件。</p>{loading?<p role="status">正在读取本岗位待办…</p>:error?<ErrorNotice error={error} retry={()=>setRefresh(v=>v+1)}/>:queues&&pending.length===0?<p className="muted">当前本岗位暂无待处理事项。</p>:<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,260px),1fr))',gap:12}}>{pending.map(q=><section className="domain-version" key={q.key} style={{margin:0,minWidth:0}}><a className="button" href={q.href} style={{whiteSpace:'normal',textAlign:'left',width:'100%',justifyContent:'space-between'}}><span>{q.title}</span><strong>{q.count} 项</strong></a><p className="muted">负责岗位：{q.ownerLabel}</p><p style={{fontSize:13,lineHeight:1.7,overflowWrap:'anywhere'}}>{q.instruction}</p></section>)}</div>}
 {funds?<section className="domain-section"><h3>到账异常核对</h3><a className="button" href="#payments?reconciliationRequired=true">到账异常核对{total?` · ${total}笔`:''}</a>{paymentError?<ErrorNotice error={paymentError} retry={()=>setRefresh(v=>v+1)}/>:payments.length?<><p>以下款项尚未计入本单履约款项，需财务核对后继续。</p>{payments.map(p=><p key={p.id}><a href={`#payments?record=${encodeURIComponent(p.id)}`}>查看到账异常</a>　{money(p.amount)}</p>)}</>:<p className="muted">暂无待核对的异常到账。</p>}</section>:null}{['ADMIN','OPERATIONS'].includes(role)&&can(permissions,'insurance-policies.read')?<a className="button" href="#insurance-renewals">查看续保与保障补核验待办</a>:null}</section>;
}
