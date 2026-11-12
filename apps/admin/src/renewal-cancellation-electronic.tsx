import {useState,useCallback} from 'react';
import {api,can,money,date} from './core';
import {useSwapRead,SwapMutationForm} from './swap-workspace';
import {ElectronicRefundReview} from './electronic-refund-review';
import {BusinessForm} from './electronic-business-form';
import {ErrorNotice,Loading} from './ui';
import {type BusinessField} from './domain-commands';
const f=(key:string,label:string,kind:BusinessField['kind']='text'):BusinessField=>({key,label,kind,required:true,...(kind==='files'?{uploadFields:{purpose:'evidence'}}:{})});
import {businessInstant as instant} from './electronic-exit-model';
const claimFields=[f('customerIntention','客户同意取消的意思表示','textarea'),f('customerAt','客户实际同意时间（北京时间）','datetime-local'),f('customerFiles','客户同意的原始证据','files'),f('personName','出租方有权人员姓名'),f('personReference','出租方人员身份依据编号'),f('authorityScope','该人员授权范围','textarea'),f('authorityFrom','授权开始时间（北京时间）','datetime-local'),f('authorityUntil','授权截止时间（北京时间）','datetime-local'),f('authorityFiles','出租方权限证据','files'),f('lessorIntention','出租方同意取消的意思表示','textarea'),f('lessorAt','出租方实际同意时间（北京时间）','datetime-local'),f('lessorFiles','出租方同意的原始证据','files'),f('note','核实说明','textarea')];
const labels:Record<string,string>={CLAIM:'待核实合意',NEED_MORE:'待补证据',REJECTED:'证据未通过',VERIFIED:'已核实期前取消约定',CORRECTED:'新期已停止，待资金核清',FINANCE_CLOSED:'资金核清已完成'};
export function ElectronicRenewalCancellation({changeId,disabled=false,reloadParent,onFrozenChange}:{changeId:string;disabled?:boolean;reloadParent:()=>Promise<void>;onFrozenChange?:(v:boolean)=>void}){
 const [opened,setOpened]=useState(false);return <section className="esign-card"><h3>取消未开始的续期</h3><p>依据原续期协议核验客户与出租方的期前取消约定；新增实际收款全额退还，不收取消费。</p>{!opened?<button className="button" disabled={disabled} onClick={()=>setOpened(true)}>办理续期取消</button>:<CancellationBody changeId={changeId} disabled={disabled} reloadParent={reloadParent} onFrozenChange={onFrozenChange}/>}</section>;
}
function CancellationBody({changeId,disabled,reloadParent,onFrozenChange}:{changeId:string;disabled:boolean;reloadParent:()=>Promise<void>;onFrozenChange?:(v:boolean)=>void}){
 const base='/admin/order-renewals/'+encodeURIComponent(changeId)+'/cancellation-v31',read=useSwapRead<any>(base),[action,setAction]=useState(''),[paymentId,setPaymentId]=useState(''),[dependencyHash,setDependencyHash]=useState(''),[busy,setBusy]=useState(false),v=read.data;
 const frozenChanged=useCallback((value:boolean)=>{setBusy(value);onFrozenChange?.(value);},[onFrozenChange]);
 const valid=v&&v.changeId===changeId&&/^[a-f0-9]{64}$/.test(v.businessSourceHash)&&Number.isInteger(v.revision)&&Array.isArray(v.history)&&Array.isArray(v.refundSources)&&Array.isArray(v.dependencies),blocked=disabled||read.disabled||!valid;
 const role=api.session?.user.role||'',write=can(api.session?.user.permissions||[],'order-changes.write'),ops=write&&['ADMIN','OPERATIONS'].includes(role),finance=write&&['ADMIN','FINANCE'].includes(role);
 const reload=async()=>{await read.reload();await reloadParent();};
 if(!v)return read.error?<ErrorNotice error={read.error} retry={()=>void read.reload().catch(()=>{})}/>:<Loading/>;
 if(!valid)return <ErrorNotice error={new Error('本次续期取消来源不完整，请重新读取')}/>;
 const allowed=(a:string)=>a==='claim'?ops&&(!v.state||['CLAIM','NEED_MORE','REJECTED'].includes(v.state)):a==='verify'?ops&&v.state==='CLAIM':a==='correct'?ops&&v.state==='VERIFIED':a==='request-refund'?finance&&['CORRECTED','FINANCE_CLOSED'].includes(v.state):a==='close-finance'?finance&&v.financialStatus==='READY_TO_CLOSE':a==='dispose-dependency'?ops&&['CORRECTED','FINANCE_CLOSED'].includes(v.state):false;
 const choose=(a:string,id='')=>{setAction(a);setPaymentId(id);};
 const fields:BusinessField[]=action==='claim'?claimFields:action==='verify'?[{key:'decision',label:'核验结论',kind:'select',required:true,choices:[{value:'VERIFIED',label:'证据充分，通过'},{value:'NEED_MORE',label:'资料待补齐'},{value:'REJECTED',label:'不成立，退回'}]},f('note','核验意见','textarea')]:action==='correct'?[]:action==='dispose-dependency'?[{key:'disposition',label:'后续安排处理方式',kind:'select',required:true,choices:[{value:'NO_SEPARATE_LIABILITY',label:'核实无独立责任'},{value:'REFERRED_FINANCIAL_REVIEW',label:'转人工财务复核'}]},f('responsibleStaffId','负责处理的员工编号'),f('dueAt','办理期限（北京时间）','datetime-local'),f('evidenceFileIds','处理依据','files'),f('note','处理说明','textarea')]:[f('note','办理说明','textarea')];
 return <><h4>{labels[v.state]||'尚未登记取消约定'}</h4><p>原续期：{v.source?.startDate||'—'} 至 {v.source?.endDate||'—'}；双方同意时间：{date(v.agreedAt)}</p>{read.error?<ErrorNotice error={read.error}/>:null}
 {v.claims?.length?<details><summary>核对已留存的双方意思表示及权限证据</summary>{v.claims.map((c:any)=><section key={c.factId}><p>客户：{c.claim.customer.intention} · {date(c.claim.customer.occurredAt)}</p><p>出租方：{c.claim.lessor.personName} · {c.claim.lessor.intention} · {date(c.claim.lessor.occurredAt)}</p><p>授权范围：{c.claim.lessor.authorityScope}；{date(c.claim.lessor.authorityFrom)} 至 {date(c.claim.lessor.authorityUntil)}</p>{c.evidence?.map((e:any)=><p key={e.id}><a href={'/api'+base+'/files/'+encodeURIComponent(e.id)} target="_blank" rel="noreferrer">查看原始证据</a></p>)}</section>)}</details>:null}
 {v.signingUnresolved?<p className="action-warning">原电子任务仍有未核实的签署，请在合同与协议中核对原交易停止状态。</p>:null}
 <div className="asset-form-actions"><button className="button" disabled={busy||read.loading} onClick={()=>void read.reload().catch(()=>{})}>状态刷新</button>{(['claim','verify','correct'] as const).filter(allowed).map(a=><button className="button primary" key={a} disabled={blocked||busy} onClick={()=>choose(a)}>{{claim:'登记期前取消约定',verify:'核验双方证据',correct:'依据已核实约定停止新增租期'}[a]}</button>)}</div>
 {v.refundSources.map((p:any)=><div className="esign-card" key={p.paymentId}><p>新增收款 {p.paymentId} · 尚需退还 {money(p.remainingAmount)}</p><p>退款申请由财务核对原付款、客户确认的应退金额与退款依据后独立复核；未核清前不出款。</p>{p.refunds?.map((r:any)=><p key={r.id}><a href={'#refunds?record='+encodeURIComponent(r.id)}>查看原退款审批</a> · {r.status}</p>)}{allowed('request-refund')&&p.remainingAmount>0&&!p.refunds?.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status))?<button className="button" disabled={blocked||busy} onClick={()=>choose('request-refund',p.paymentId)}>申请剩余实收全额退款</button>:null}</div>)}
 {['CORRECTED','FINANCE_CLOSED'].includes(v.state)?<ElectronicRefundReview orderId={v.orderId} disabled={blocked||busy}/>:null}
 {v.dependencies.map((d:any)=><div className="esign-card" key={d.hash}><p>待核对后续安排：{d.kind||d.type||'关联记录'} · {d.id||d.changeId||''}</p><p>{d.disposition?.disposition||'尚未处理'}</p>{allowed('dispose-dependency')?<button className="button" disabled={blocked||busy} onClick={()=>{setDependencyHash(d.hash);choose('dispose-dependency');}}>留存处理依据</button>:null}</div>)}
 {allowed('close-finance')?<button className="button" disabled={blocked||busy} onClick={()=>choose('close-finance')}>确认资金核清完成</button>:null}
 {action?<SwapMutationForm key={action+paymentId+dependencyHash} path={base+'/'+action} disabled={blocked||!allowed(action)} build={raw=>{
  const bound={businessSourceHash:v.businessSourceHash,revision:v.revision,headId:v.headId,headHash:v.headHash};
  if(action==='claim'){if(!v.source?.customerId||!v.source?.ownerId)throw Error('双方主体来源缺失');return{...bound,claim:{customer:{subjectId:v.source.customerId,intention:raw.customerIntention,occurredAt:instant(raw.customerAt),fileIds:raw.customerFiles},lessor:{ownerId:v.source.ownerId,personName:raw.personName,personReference:raw.personReference,authorityScope:raw.authorityScope,authorityFrom:instant(raw.authorityFrom),authorityUntil:instant(raw.authorityUntil),authorityFileIds:raw.authorityFiles,intention:raw.lessorIntention,occurredAt:instant(raw.lessorAt),fileIds:raw.lessorFiles},note:raw.note}};}
  if(action==='correct')return bound;
  if(action==='verify')return{...bound,...raw};
  if(action==='dispose-dependency')return{...bound,...raw,dependencyHash,dueAt:instant(raw.dueAt)};
  return{...bound,sourceHash:v.financialSourceHash,note:raw.note,...(action==='request-refund'?{paymentId}:{})};
 }} after={async()=>{await reload();setAction('');}} reload={reload} onFrozenChange={frozenChanged}>{submit=><BusinessForm fields={fields} submit={submit} disabled={blocked||busy||!allowed(action)} label="确认提交"/>}</SwapMutationForm>:null}
 </>;
}
