import {useEffect,useRef,useState} from 'react';
import {api,ApiError,money,type Entity} from './core';
import {resources,resourceAccessible,resourceWritable} from './resources';
import {readOrderProcess} from './order-process';
import {RecordForm,ErrorNotice,Loading} from './ui';
import {mutationPayload} from './form';
import {CommandIdentity} from './domain-commands';

const refundResource=resources.find(r=>r.key==='refunds')!;
const fields=refundResource.fields!.filter(f=>f.key!=='paymentId');
type Facts={payment:Entity;orderId:string;returned:number;pending:number;available:number;fingerprint:string};
const cent=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const mismatch=()=>new Error('支付与订单资金记录不一致，请刷新核对');
async function readFacts(paymentId:string,signal?:AbortSignal):Promise<Facts>{
 const payment=await api.request<Entity>(`/admin/payments/${encodeURIComponent(paymentId)}`,{signal});
 if(payment.id!==paymentId||typeof payment.billId!=='string'||typeof payment.customerId!=='string'||!payment.customerId||!cent(payment.amount)||!Number.isSafeInteger(payment.revision))throw mismatch();
 const bill=await api.request<Entity>(`/admin/bills/${encodeURIComponent(payment.billId)}`,{signal});
 if(bill.id!==payment.billId||typeof bill.orderId!=='string'||!bill.orderId||payment.customerId!==bill.customerId)throw mismatch();
 const [order,workspace]=await Promise.all([api.request<Entity>(`/admin/orders/${encodeURIComponent(bill.orderId)}`,{signal}),api.request<{orderId:string;process:unknown}>(`/admin/orders/${encodeURIComponent(bill.orderId)}/workspace`,{signal})]);
 if(order.id!==bill.orderId||order.customerId!==bill.customerId||workspace.orderId!==order.id)throw mismatch();
 const process=readOrderProcess(workspace.process,order.id,order.revision);
 const bills=process?.related.bills.filter(row=>row.id===bill.id);
 if(bills?.length!==1||bills[0].amount!==bill.amount||bills[0].status!==bill.status||!Array.isArray(bills[0].payments))throw mismatch();
 const matches=(bills[0].payments as Entity[]).filter(row=>row.id===payment.id);
 if(matches.length!==1)throw mismatch();const receipt=matches[0];
 if(receipt.orderId!==order.id||receipt.billId!==bill.id||receipt.status!==payment.status||receipt.amount!==payment.amount||!Array.isArray(receipt.refunds))throw mismatch();
 let returned=0,pending=0;const ids=new Set<string>();
 for(const refund of receipt.refunds as Entity[]){
  if(!refund||typeof refund.id!=='string'||!refund.id||ids.has(refund.id)||refund.orderId!==order.id||refund.paymentId!==payment.id||!cent(refund.amount)||!['PENDING_APPROVAL','PROCESSING','SUCCEEDED','FAILED','REJECTED'].includes(String(refund.status)))throw mismatch();
  ids.add(refund.id);if(refund.status==='SUCCEEDED')returned+=refund.amount;if(['PENDING_APPROVAL','PROCESSING'].includes(String(refund.status)))pending+=refund.amount;
 }
 const available=payment.amount-returned-pending;
 if(!cent(returned)||!cent(pending)||!cent(available))throw mismatch();
 const fingerprint=JSON.stringify({paymentId,billId:bill.id,orderId:order.id,customerId:order.customerId,paymentRevision:payment.revision,orderRevision:order.revision,billRevision:bill.revision,paymentStatus:payment.status,billStatus:bill.status,amount:payment.amount,refunds:(receipt.refunds as Entity[]).map(r=>[r.id,r.status,r.amount]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))});
 return {payment,orderId:order.id,returned,pending,available,fingerprint};
}
type Props={paymentId:string;disabled?:boolean;refreshKey?:number;after:()=>void|Promise<void>};
export function PaymentRefundRequest(props:Props){
 const user=api.session?.user;
 const readable=['payments','bills','orders','refunds'].every(key=>resourceAccessible(resources.find(r=>r.key===key),user?.permissions||[],user?.role));
 if(!readable)return null;
 return <RefundForm key={`${user?.id}-${props.paymentId}`} {...props}/>;
}
function RefundForm({paymentId,disabled=false,refreshKey=0,after}:Props){
 const session=api.session,user=session?.user;
 const writable=['ADMIN','FINANCE'].includes(user?.role||'')&&resourceWritable(refundResource,user?.permissions||[],user?.role);
 const [facts,setFacts]=useState<Facts>(),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(true),[tick,setTick]=useState(0),[open,setOpen]=useState(false),[conflicted,setConflicted]=useState(false),[receipt,setReceipt]=useState('');
 const identity=useRef(new CommandIdentity()),generation=useRef(0),latest=useRef({disabled,writable,session});latest.current={disabled,writable,session};
 useEffect(()=>{const g=++generation.current,c=new AbortController();setBusy(true);setError(undefined);
  readFacts(paymentId,c.signal).then(value=>{if(g===generation.current){setFacts(value);setConflicted(false);}}).catch(e=>{if(g===generation.current&&e.name!=='AbortError')setError(e);}).finally(()=>{if(g===generation.current)setBusy(false);});
  return()=>{generation.current++;c.abort();};
 },[paymentId,refreshKey,tick,session]);
 const fresh=!!facts&&!busy&&!error&&!conflicted&&!disabled&&writable;
 const submit=async(body:Record<string,unknown>)=>{
  if(!fresh||!facts)throw new Error('请先刷新退款资料，核对后再提交');
  if(!cent(body.amount)||body.amount<=0)throw new Error('退款金额必须大于零');
  if(body.amount>facts.available)throw new Error(`退款金额不能超过当前可退金额 ${money(facts.available)}`);
  const g=generation.current,initial=facts;
  const current=()=>g===generation.current&&!latest.current.disabled&&latest.current.writable&&api.session===session&&latest.current.session===session;
  setBusy(true);
  try{
   const freshFacts=await readFacts(paymentId);
   if(!current())throw new Error('当前记录或会话已变化，请重新核对');
   if(freshFacts.fingerprint!==initial.fingerprint){setConflicted(true);throw new ApiError('退款资料已更新，请刷新核对后重新提交',409,'STATE_CONFLICT');}
   if(freshFacts.payment.status!=='SUCCEEDED'||body.amount>freshFacts.available)throw new ApiError('当前支付不允许申请此金额退款，请刷新核对',409,'STATE_CONFLICT');
   const value={paymentId,amount:body.amount,reason:body.reason};
   const payload=mutationPayload('refunds','create',value,identity.current.for('/admin/refunds',value));
   await api.request('/admin/refunds',{method:'POST',body:payload,permission:'refunds.write'});
   if(!current())return;
   identity.current=new CommandIdentity();setOpen(false);setReceipt('退款申请已提交，等待审核。');setTick(v=>v+1);
   try{await after();}catch(e){setError(e);}
  }catch(e){if(current()){if(e instanceof ApiError&&e.status===409)setConflicted(true);else setError(e);}throw e;}
  finally{if(g===generation.current)setBusy(false);}
 };
 return <section className="domain-section" aria-label="原路退款">
  <div className="order-panel-heading"><h3>原路退款</h3><button className="text-button" disabled={busy} onClick={()=>setTick(v=>v+1)}>刷新退款资料</button></div>
  <p className="muted">原支付 <strong>{paymentId}</strong>{facts?<> · 订单 {facts.orderId}</>:null}</p>
  {facts?<><p>支付 {money(facts.payment.amount)} · 已退 {money(facts.returned)} · 审核及处理中 {money(facts.pending)}</p><p>最多可申请 {money(facts.available)}</p></>:null}
  {busy?<Loading label="正在核对原支付及退款余额"/>:null}{error?<ErrorNotice error={error}/>:null}
  {conflicted?<p className="muted">输入已保留，请刷新退款资料后核对最新余额。</p>:null}
  {receipt?<p role="status">{receipt}</p>:null}
  {open?<RecordForm fields={fields} warning="退款将绑定本笔支付，审核通过后按原渠道执行。" submitLabel="提交退款申请" submitDisabled={!fresh||facts?.payment.status!=='SUCCEEDED'||!facts?.available} onSubmit={submit} onCancel={()=>setOpen(false)}/>:writable?<button className="button" disabled={!fresh||facts?.payment.status!=='SUCCEEDED'||!facts?.available} onClick={()=>{setOpen(true);setReceipt('');}}>申请原路退款</button>:<p className="muted">当前岗位仅可查看退款余额。</p>}
 </section>;
}
