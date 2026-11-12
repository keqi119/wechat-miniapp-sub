import {useEffect,useRef,useState} from 'react';
import {OwnerApiError,OwnerClient} from './client';
import {ActionFeedback,Notice,useDismissFeedback} from './Common';
import {dateTime,money,providerUrl} from './model';
import {checkedContract,contractBasePath,contractConfirmationKey,contractDomain,contractFilePath,contractKindLabel,contractPath,contractPresentation,contractSignPayload,contractTaskKey,isHandover} from './workspace';
import type {BusinessContract,ContractDomain,ContractGroup,ContractList,FeedbackMap} from './workspace';

const groups:{id:ContractGroup|'all';label:string}[]=[{id:'all',label:'全部'},{id:'pending',label:'待处理'},{id:'processing',label:'处理中'},{id:'completed',label:'已完成'},{id:'closed',label:'已关闭'}];
const errorText=(error:unknown)=>error instanceof Error?error.message:'操作结果未确认，请主动查询本份合同。';
const partyText=(status:string|undefined)=>({SIGNED:'已签署',PENDING:'待签署',UNKNOWN:'结果待确认',REJECTED:'已拒签',EXPIRED:'签署已过期',CANCELLED:'已取消'}[status||'']||'尚未签署');
const domains:ContractDomain[]=['OWNER_CONTRACT','PLATFORM_HANDOVER'];
const domainLabel=(domain:ContractDomain)=>domain==='PLATFORM_HANDOVER'?'宁达交接单':'出租方合同';
function ContractRecord({ownerId,item,expanded,body,busy,manualEnabled,uncertain,feedback,onOpen,onSync,onSign}:{ownerId:string;item:BusinessContract;expanded:boolean;body?:BusinessContract;busy:boolean;manualEnabled:boolean;uncertain:boolean;feedback?:FeedbackMap[string];onOpen:()=>void;onSync:()=>void;onSign:(contract:BusinessContract,key:string,accepted:boolean)=>Promise<boolean>}){
 const [accepted,setAccepted]=useState(false);const contract=body||item,key=contractConfirmationKey(contract),presentation=contractPresentation(contract),handover=isHandover(contract),noun=handover?'交接单':'合同';
 useEffect(()=>{setAccepted(false);},[key,expanded]);
 return <article className="contract-card" data-contract-id={item.id} data-document-domain={contractDomain(item)}>
  <div className="section-title"><h3>{item.vehicleTitle||(handover?contractKindLabel(contract):'企业汽车订阅合同')}</h3><span className={`tag ${presentation.group==='completed'?'done':''}`}>{presentation.label}</span></div>
  <p className="fineprint">{contractKindLabel(contract)} · {handover?'宁达法人逐份手动签署':'逐单手动签署'}</p>
  <dl className="facts"><div><dt>订单编号</dt><dd>{item.orderId||'待核实'}</dd></div>{!handover&&<><div><dt>月费／期数</dt><dd>{item.monthlyFeeAmount===null?'待核实':money(item.monthlyFeeAmount)}／{item.months===null?'待核实':`${item.months} 个月`}</dd></div><div><dt>押金</dt><dd>{item.depositAmount===null?'待核实':money(item.depositAmount)}</dd></div></>}<div><dt>{handover?'客户／宁达':'客户／企业'}</dt><dd>{partyText(contract.parties.find(p=>p.role==='CUSTOMER')?.status)}／{partyText(contract.parties.find(p=>p.role===(handover?'PLATFORM':'OWNER'))?.status)}</dd></div></dl>
  <p className="fineprint">文件准备于 {dateTime(item.createdAt)}{item.archivedAt&&` · 归档于 ${dateTime(item.archivedAt)}`}</p>
  {['pending','processing'].includes(presentation.group)&&contract.blockers.length>0&&<Notice><ul>{contract.blockers.map(reason=><li key={reason}>{reason}</li>)}</ul></Notice>}
  <div className="action-row"><button className="secondary" disabled={busy} aria-expanded={expanded&&!!body} onClick={onOpen}>{expanded&&body?`收起${noun}详情`:`查看${noun}详情`}</button>{contract.canQuery&&<button className="secondary" disabled={busy} onClick={onSync}>查询签署结果</button>}</div>
  {expanded&&body&&<div className="contract-detail">
   <h4>本份{noun}文件</h4><div className="action-row">{contract.sourceAvailable&&<a className="secondary" href={contractFilePath(ownerId,item.id,'source',contractDomain(item))} target="_blank" rel="noopener noreferrer">查看完整{noun} PDF</a>}{contract.signedAvailable&&<a className="secondary" href={contractFilePath(ownerId,item.id,'signed',contractDomain(item))} target="_blank" rel="noopener noreferrer">下载签后{noun}</a>}</div>
   {contract.body&&<details className="contract-body"><summary>阅读本份{noun}正文</summary><div className="document-body">{contract.body}</div></details>}
   <details className="hash-details"><summary>查看文件校验信息</summary><p className="fineprint">{noun}编号：{contract.resourceId}</p><code>{contract.documentHash}</code><p className="fineprint">PDF 摘要</p><code>{contract.sourceSha256||'文件尚未准备'}</code></details>
   {manualEnabled&&contract.canSign&&<div className="contract-confirm"><p>{handover?'请核对完整交接单中的客户、车辆、交接事实和宁达签署方。由宁达法人本人前往法大大签署，继续办理仍使用本份文件和原签署任务。':'请核对完整合同中的出租企业、车辆、费用与期限。点击后由您本人前往法大大签署本份文件。'}</p><label className="check"><input type="checkbox" disabled={busy||uncertain} checked={accepted} onChange={event=>setAccepted(event.target.checked)}/><span>{handover?'我已阅读并核对本份完整交接单，同意由本人作为宁达法人代表上海宁达信息科技有限公司逐份签署。':'我已阅读并核对本份完整合同及费用附件，同意由本人代表本企业逐单签署。'}</span></label><button className="primary full" disabled={busy||uncertain||!accepted} onClick={()=>{setAccepted(false);void onSign(contract,key,accepted);}}>确认本份{noun}并前往签署 <span aria-hidden="true">↗</span></button></div>}
  </div>}
  {uncertain&&<Notice>签署入口请求的结果尚待确认，请先“查询签署结果”。系统不会自动重复发起或切换为自动盖章。</Notice>}
 </article>;
}
export function ContractPanel({ownerId,active,api,onExpired,onEnterprise,isSessionCurrent}:{ownerId:string;active:boolean;api:OwnerClient;onExpired:()=>void;onEnterprise:()=>void;isSessionCurrent:()=>boolean}){
 const [listings,setListings]=useState<Partial<Record<ContractDomain,ContractList>>>({}),[filter,setFilter]=useState<ContractGroup|'all'>('all'),[open,setOpen]=useState<string|null>(null),[details,setDetails]=useState<Record<string,BusinessContract>>({}),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState<FeedbackMap>({}),[uncertain,setUncertain]=useState<Record<string,boolean>>({});
 const dismissFeedback=useDismissFeedback();
 const activeRef=useRef(active);activeRef.current=active;
 const alive=useRef(true),locked=useRef(false),started=useRef(false);const valid=()=>alive.current&&isSessionCurrent();
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function run(key:string,work:()=>Promise<unknown>,context?:string){if(locked.current)return false;dismissFeedback();locked.current=true;setBusy(true);setFeedback(old=>({...old,[key]:{}}));try{await work();return valid();}catch(error){if(valid()){if(error instanceof OwnerApiError&&error.status===401)onExpired();else setFeedback(old=>({...old,[key]:{error:errorText(error),context}}));}return false;}finally{if(valid()){locked.current=false;setBusy(false);}}}
 async function readList(){
  const failures:string[]=[];await Promise.all(domains.map(async domain=>{
   const listKey=`list:${domain}`;
   try{
    const next=await api.request<ContractList>(contractBasePath(ownerId,domain));next.items.forEach(item=>checkedContract(item,domain));
    if(!valid())return;
    setListings(old=>({...old,[domain]:next}));setFeedback(old=>({...old,[listKey]:{}}));
    setDetails(old=>({...Object.fromEntries(Object.entries(old).filter(([,item])=>contractDomain(item)!==domain)),...Object.fromEntries(next.items.flatMap(item=>{const key=contractTaskKey(item),cached=old[key];return cached&&cached.documentHash===item.documentHash&&cached.sourceSha256===item.sourceSha256?[[key,{...cached,...item}]]:[];}))}));
   }catch(error){if(valid()){if(error instanceof OwnerApiError&&error.status===401)onExpired();else{const message=`${domainLabel(domain)}：${errorText(error)}`;failures.push(message);setFeedback(old=>({...old,[listKey]:{error:message}}));}}}
  }));
  if(failures.length&&valid())setFeedback(old=>({...old,list:{error:failures.join('；')}}));
  return failures.length===0;
 }
 useEffect(()=>{if(active&&!started.current){started.current=true;void run('list',readList);}},[active]);
 async function readDetail(item:BusinessContract){return checkedContract(await api.request<BusinessContract>(contractPath(ownerId,item)),contractDomain(item),item.id);}
 async function expand(item:BusinessContract){const taskKey=contractTaskKey(item);if(open===taskKey&&details[taskKey]){setOpen(null);return;}await run(taskKey,async()=>{const next=await readDetail(item);if(valid()){setDetails(old=>({...old,[taskKey]:next}));setOpen(taskKey);}},`${contractKindLabel(item)} · ${item.orderId||item.resourceId}`);}
 async function sync(item:BusinessContract){const taskKey=contractTaskKey(item);await run(taskKey,async()=>{const result=await api.request<{status:string}>(`${contractPath(ownerId,item)}/sync`,{});if(!valid())return;const next=await readDetail(item);if(!valid())return;setDetails(old=>({...old,[taskKey]:next}));const complete=await readList();if(valid()&&complete){const pending=['PENDING','SIGNING','UNKNOWN'].includes(result.status);setUncertain(old=>({...old,[taskKey]:pending&&!next.canSign}));setFeedback(old=>({...old,[taskKey]:{context:`${contractKindLabel(item)} · ${item.orderId||item.resourceId}`,tone:pending?'info':'success',note:pending?'签署结果尚未完成确认，请查询原交易；如继续签署，仍会核验并进入同一份文件。查询不会发起签署或自动盖章。':'已读取本份文件的最新签署结果，请核对双方状态和归档文件。查询不会发起签署或自动盖章。'}}));}},`${contractKindLabel(item)} · ${item.orderId||item.resourceId}`);}
 async function sign(contract:BusinessContract,key:string,accepted:boolean){const taskKey=contractTaskKey(contract);return run(taskKey,async()=>{
  contractSignPayload(contract,key,accepted);const current=await readDetail(contract);if(!valid())return;setDetails(old=>({...old,[taskKey]:current}));const payload=contractSignPayload(current,key,accepted);
  setUncertain(old=>({...old,[taskKey]:true}));const result=await api.request<{url?:string}>(`${contractPath(ownerId,contract)}/sign`,payload);if(!valid())return;
  if(result.url){location.assign(providerUrl(result.url));return;}
  setFeedback(old=>({...old,[taskKey]:{context:`${contractKindLabel(contract)} · ${contract.orderId||contract.resourceId}`,note:'已受理本份文件签署入口请求，请主动查询实际结果。'}}));
 },`${contractKindLabel(contract)} · ${contract.orderId||contract.resourceId}`);}
 const allItems=domains.flatMap(domain=>listings[domain]?.items||[]),loaded=Object.keys(listings).length>0,items=allItems.filter(item=>filter==='all'||contractPresentation(item).group===filter);
 return <section className="owner-section contracts-panel"><div className="section-title"><h2>业务合同</h2><span className="tag">逐单手动签署</span></div><p className="muted">订单生成正式文件后在此查看。合同及交接单由法人本人逐份核对并签署，返回本页后主动查询结果。</p><Notice>当前自动盖章未开放。查询不会发起签署或自动盖章。授权书签署不会代替您确认具体业务文件。</Notice>
  {domains.map(domain=><div key={domain}>{listings[domain]&&!listings[domain]?.manualSigningEnabled&&listings[domain]!.items.length>0&&<Notice>{domainLabel(domain)}签署入口暂未开放，已有文件和签署记录仍可查看。</Notice>}</div>)}
  <div className="contract-toolbar"><div className="contract-filters" aria-label="筛选合同状态">{groups.map(group=><button key={group.id} className={filter===group.id?'selected':''} aria-pressed={filter===group.id} onClick={()=>{dismissFeedback();setFilter(group.id);}}>{group.label}{loaded?` ${allItems.filter(item=>group.id==='all'||contractPresentation(item).group===group.id).length}`:''}</button>)}</div><button className="text-button" disabled={busy} onClick={()=>void run('list',async()=>{const complete=await readList();if(complete&&valid()&&activeRef.current)setFeedback(old=>({...old,list:{note:'已重新读取合同列表，请核对各类文件状态。'}}));})}>刷新合同列表</button></div>
  {Object.entries(feedback).filter(([key])=>!key.startsWith('list:')).map(([key,value])=><ActionFeedback key={key} value={value} busy={busy}/>)}
  {domains.some(domain=>feedback[`list:${domain}`]?.error)&&<button className="secondary" onClick={onEnterprise}>查看企业与证书状态</button>}
  {!loaded?(busy&&<p role="status">正在读取本企业合同及交接单…</p>):!allItems.length?(!busy&&!domains.some(domain=>feedback[`list:${domain}`]?.error)&&<div className="empty compact"><h3>暂无已准备的业务合同</h3><p>运营准备正式合同或交接单后会展示在这里。当前无需重复办理企业认证或授权。</p></div>):!items.length?<div className="empty compact"><p>此状态下暂无合同</p></div>:<div className="contract-list">{items.map(item=>{const taskKey=contractTaskKey(item);return <ContractRecord key={taskKey} ownerId={ownerId} item={item} expanded={open===taskKey} body={details[taskKey]} busy={busy} manualEnabled={!!listings[contractDomain(item)]?.manualSigningEnabled&&!feedback[`list:${contractDomain(item)}`]?.error} uncertain={!!uncertain[taskKey]} feedback={feedback[taskKey]} onOpen={()=>void expand(item)} onSync={()=>void sync(item)} onSign={sign}/>;})}</div>}
 </section>;
}
