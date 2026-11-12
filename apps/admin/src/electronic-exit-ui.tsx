import {useState} from 'react';
import {api,can,money,date} from './core';
import {assetSessionKey} from './asset-shared';
import {BusinessForm} from './electronic-business-form';
import {ElectronicRefundReview} from './electronic-refund-review';
import {readFields,type BusinessField,type BusinessValues} from './domain-commands';
import {useSwapRead,SwapMutationForm} from './swap-workspace';
import {ErrorNotice,Loading} from './ui';
import {exitRead,exitProposal,exitReview,exitCanPropose,exitState,businessInstant,type ExitKind} from './electronic-exit-model';

const choices=(rows:string[][])=>rows.map(([value,label])=>({value,label}));
const evidence=(key:string,label='事实证据'):BusinessField=>({key,label,kind:'files',required:true,uploadFields:{purpose:'evidence'}});
const reason:BusinessField={key:'reason',label:'协商原因及约定',kind:'textarea',required:true};
const fields04:BusinessField[]=[reason,{key:'responsibility',label:'责任情形',kind:'select',required:true,choices:choices([['CUSTOMER','客户原因'],['OWNER','出租方原因'],['PLATFORM','平台原因'],['MIXED','共同原因'],['NO_FAULT','无过错协商']])},evidence('neverDeliveredEvidenceFileIds','未实际交付的核验证据'),{key:'costs',label:'有约定及证据的可扣费用（无扣费则留空）',kind:'rows',fields:[{key:'kind',label:'费用依据',kind:'select',required:true,choices:choices([['PERFORMED_INDEPENDENT_SERVICE','已履行的独立服务'],['PROVEN_NECESSARY_LOSS','有证据的必要损失']])},{key:'amount',label:'金额（元）',kind:'money',required:true},{key:'paymentId',label:'原收款记录编号',required:true},{key:'creditorOwnerId',label:'有权收取费用的主体编号',required:true},{key:'description',label:'费用事项',required:true},{key:'agreement',label:'已约定的收费依据',kind:'textarea',required:true},{key:'responsibility',label:'责任认定',required:true},{key:'performedAt',label:'实际发生时间（北京时间）',kind:'datetime-local',required:true},evidence('evidenceFileIds','履行及损失证据')]}];
const fields06:BusinessField[]=[reason,{key:'reasonKind',label:'终止原因',kind:'select',required:true,choices:choices([['PERSONAL','客户个人原因'],['OWNER_BREACH','出租方违约'],['PLATFORM_BREACH','平台违约'],['STATUTORY','法定原因'],['MIXED','共同原因'],['NO_FAULT','无过错协商']])},{key:'plannedReturnAt',label:'计划还车时间（北京时间）',kind:'datetime-local',required:true},{key:'returnPlace',label:'约定还车地点',required:true},evidence('evidenceFileIds')];
const reviewFields:BusinessField[]=[{key:'decision',label:'复核结论',kind:'select',required:true,choices:choices([['VERIFIED','通过'],['REJECTED','退回']])},{key:'note',label:'核对意见',kind:'textarea',required:true}];
export function ElectronicExitPanel(props:{orderId:string;kind:ExitKind;disabled?:boolean;after:()=>Promise<void>}){return <ExitBody key={assetSessionKey()+props.orderId+props.kind} {...props}/>;}
function ExitBody({orderId,kind,disabled=false,after}:{orderId:string;kind:ExitKind;disabled?:boolean;after:()=>Promise<void>}){
 const base='/admin/orders/'+encodeURIComponent(orderId)+'/'+kind,read=useSwapRead<any>(base,'orders.read'),[action,setAction]=useState(''),[busy,setBusy]=useState(false);
 let d;let invalid:unknown;try{if(read.data)d=exitRead(read.data,orderId);}catch(e){invalid=e;}
 const writable=can(api.session?.user.permissions||[],'orders.write')&&['ADMIN','OPERATIONS'].includes(api.session?.user.role||'');
 const reload=async()=>{await read.reload();await after();};
 const blocked=disabled||read.disabled||!!invalid;
 if(!d)return read.error||invalid?<ErrorNotice error={read.error||invalid} retry={()=>void read.reload().catch(()=>{})}/>:<Loading label="正在核对协议与本单事实"/>;
 const c=d.case,propose=exitCanPropose(d),review=c?.state==='PROPOSED',permitted=writable&&(action==='propose'?propose:review),path=action==='review'?'/admin/'+(kind==='cancellation04'?'cancellations04':'terminations')+'/'+encodeURIComponent(c?.id||'')+'/review':base;
 const title=kind==='cancellation04'?'交付前取消 · 04':'协商终止 · 06';
 return <section className="esign-card"><div className="row between"><h3>{title}</h3><button className="button" disabled={busy||read.loading} onClick={()=>void read.reload().catch(()=>{})}>状态刷新</button></div>
 <p>{kind==='cancellation04'?'用于三方已签订阅合同、车辆尚未实际交付时的协商取消。':'用于实际用车后的协商终止。租金截止与最终结算依据实际还车事实核定。'}</p>
 {read.error||invalid?<ErrorNotice error={read.error||invalid}/>:null}{d.blockers.length?<ul>{d.blockers.map((b,i)=><li key={i}>{b.message||b.code||'办理条件待核对'}</li>)}</ul>:null}
 {c?<><h4>{exitState(c.state)}</h4><dl className="renewal-summary"><div><dt>协商原因</dt><dd>{c.reason}</dd></div>{kind==='cancellation04'?<div><dt>本方案应退净额</dt><dd>{money(c.netRefundAmount)}</dd></div>:<><div><dt>计划还车</dt><dd>{date(c.plannedReturnAt)}</dd></div><div><dt>约定地点</dt><dd>{c.returnPlace}</dd></div></>}{c.effectiveAt?<div><dt>协议生效时间</dt><dd>{date(c.effectiveAt)}</dd></div>:null}</dl>{Array.isArray(c.costs)&&c.costs.length?<ul>{c.costs.map((cost:any,i:number)=><li key={i}>{cost.description} · {money(cost.amount)} · {cost.agreement}</li>)}</ul>:null}<p><a href={'#orders?record='+encodeURIComponent(orderId)+'&view=contracts'}>查看本单合同与协议</a></p></>:<p>尚无已提交方案。</p>}
 {writable&&c&&d.reviewSource?.proposal?.evidence?.length?<details><summary>核对本版本原始证据</summary>{d.reviewSource.proposal.evidence.map((e:any,i:number)=><p key={e.id}><a href={'/api/admin/'+(kind==='cancellation04'?'cancellations04':'terminations')+'/'+encodeURIComponent(c.id)+'/files/'+encodeURIComponent(e.id)} target="_blank" rel="noreferrer">查看依据 {i+1}</a></p>)}</details>:null}
 {kind==='termination'&&d.settlementSource?<section className="esign-card"><h4>实际还车金额核对</h4><p>实际收车：{date(d.settlementSource.actualReceiptAt)} · 计租截止：{date(d.settlementSource.amounts?.stopAt)}</p><p>未使用期间租金 {money(d.settlementSource.amounts?.remainingRentAmount)} · 约定补偿 {money(d.settlementSource.amounts?.compensationAmount)} · 押金余额 {money(d.settlementSource.depositBalanceAmount)}</p><p>{d.settlementSource.responses?.current?.decision==='CONFIRM'?'客户已确认本版金额':d.settlementSource.responses?.current?.decision==='OBJECT'?'客户提出异议，须人工核对':'待客户在小程序核对实际金额'}</p>{d.settlementSource.responses?.history?.map((r:any)=><p key={r.id}>{r.decision==='CONFIRM'?'确认':'异议'} · {date(r.respondedAt)} · {r.reason}</p>)}</section>:null}
 {c&&['EFFECTIVE','ARCHIVED','DEPENDENCIES_RELEASED','AMOUNT_CONFIRMED'].includes(c.state)&&['ADMIN','OPERATIONS','FINANCE'].includes(api.session?.user.role||'')?<ElectronicRefundReview orderId={orderId} disabled={blocked||busy}/>:null}
 <p>方案复核后由客户确认，再进入三方电子签署。收退款和实际交还分别办理。</p>
 {writable?<div className="asset-form-actions">{propose?<button className="button primary" disabled={blocked||busy} onClick={()=>setAction('propose')}>编制{title.split(' · ')[0]}方案</button>:null}{review?<button className="button primary" disabled={blocked||busy} onClick={()=>setAction('review')}>复核本版本方案</button>:null}</div>:null}
 {action?<><h4>{action==='review'?'复核本版本方案':'编制新方案'}</h4>{!busy?<button className="text-button" onClick={()=>setAction('')}>收起办理</button>:null}<SwapMutationForm key={action} path={path} permission="orders.write" disabled={blocked||!permitted} build={raw=>{
  if(action==='review')return exitReview(d,raw);
  const result=exitProposal(kind,d,raw);
  if(kind==='cancellation04')result.costs=(raw.costs as any[]||[]).map(v=>({...v,performedAt:businessInstant(v.performedAt)}));
  return result;
 }} after={async()=>{await reload();setAction('');}} reload={reload} onFrozenChange={setBusy}>{submit=><BusinessForm fields={action==='review'?reviewFields:kind==='cancellation04'?fields04:fields06} submit={submit} disabled={blocked||!permitted||busy} label={action==='review'?'确认复核':'提交方案'}/>}</SwapMutationForm></>:null}
 </section>;
}
