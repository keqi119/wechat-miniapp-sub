import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {Badge,Button,Card,Tag} from 'antd';
import {RightOutlined} from '@ant-design/icons';
import {api,can} from './core';
import {ErrorNotice} from './ui';
import {orderSections,orderSectionData,resourceHref} from './modules/navigation';
import {OrderQualificationPanel} from './order-qualification';
import {canReadCustomerProfile} from './customer-profile-model';
import {OrderEntitlements} from './entitlement-ui';
import {OrderUsageAccount} from './usage-ui';
import {RenewalEntry} from './renewal-ui';
import {OrderOfflineActions} from './order-offline';
import {type ProcessAction,type ProcessCheck,type ProcessView} from './process-guide';
import {processHref,syncProcessSection,rememberProcessPosition} from './process-navigation';
import {readOrderProcess,scopedAction,sectionForStep,sectionForAction,processActions,businessRecordHref,type OrderProcess} from './order-process';
import {OrderContractPanel} from './order-contract-panel';
import {OrderFundsPanel,OrderRecordPanel,type OrderFocus} from './order-record-panel';
import {OrderHandoverPanel} from './order-handover-panel';
import {Command,CommandBoundary} from './domain-ui';
import './order-workspace.css';
import {ElectronicExitPanel} from './electronic-exit-ui';
import {ElectronicContractHub} from './electronic-contract-hub';

type Props={entity:Record<string,unknown>;status:ReactNode;actions:ReactNode;emptyActionMessage?:string;onRefresh:()=>void;operations?:ReactNode;renderValues:(value:Record<string,unknown>)=>ReactNode;layout?:'page'|'embedded';detailError?:unknown;detailRefreshing?:boolean};
// A new order gets a new lifetime: pending reads and unsaved forms cannot cross orders.
export function OrderWorkspace(props:Props){return <OrderWorkspaceBody key={`${api.session?.user.id||''}:${String(props.entity.id)}`} {...props}/>;}
function OrderWorkspaceBody({entity,status,actions,emptyActionMessage,onRefresh,operations,renderValues,layout='page',detailError,detailRefreshing=false}:Props){
 const orderId=String(entity.id),offline=entity.contractMode==='OFFLINE',electronic=entity.contractMode==='ELECTRONIC',managed=offline||electronic,uid=useId(),scroll=useRef<HTMLDivElement>(null),tabStrip=useRef<HTMLElement>(null),stageStrip=useRef<HTMLDivElement>(null),positions=useRef<Record<string,number>>({});
 const requestedView=new URLSearchParams(window.location.hash.split('?')[1]).get('view'),initialView=requestedView==='more'?'cancellation':requestedView;
 const [selected,setSelected]=useState(initialView||'overview'),[visited,setVisited]=useState(new Set([initialView||'overview'])),[selectedStep,setSelectedStep]=useState<string>(),[focus,setFocus]=useState<OrderFocus>();
 const [workspace,setWorkspace]=useState<Record<string,any>>(),[error,setError]=useState<unknown>(),[loading,setLoading]=useState(managed),[revision,setRevision]=useState(0),[notice,setNotice]=useState('');
 const requests=useRef(0),controller=useRef<AbortController|null>(null),defaultChosen=useRef(!!initialView),mounted=useRef(true);
 const select=useCallback((key:string)=>{const next=key==='more'?'cancellation':key;if(scroll.current)positions.current[selected]=scroll.current.scrollTop;setSelected(next);setVisited(v=>new Set([...v,next]));syncProcessSection(next);},[selected]);
 useLayoutEffect(()=>{if(scroll.current)scroll.current.scrollTop=positions.current[selected]||0;},[selected]);
 const reload=useCallback(async()=>{
  if(!managed)return;const generation=++requests.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;setLoading(true);setError(undefined);
  try{const value=await api.request<Record<string,any>>(`/admin/orders/${encodeURIComponent(orderId)}/workspace`,{signal:abort.signal});
   if(!mounted.current||generation!==requests.current)return;
   if(value.orderId!==orderId)throw new Error('返回进度与当前订单不一致，请重新读取');
   if(!readOrderProcess(value.process,orderId,value.process?.orderRevision))throw new Error('当前流程资料尚未完整读取，请重新核对');
   setWorkspace(value);setRevision(v=>v+1);
  }catch(e){if(!mounted.current||generation!==requests.current)return;setError(e);throw e;}finally{if(mounted.current&&generation===requests.current)setLoading(false);}
 },[orderId,managed]);
 useEffect(()=>{mounted.current=true;void reload().catch(()=>{});return()=>{mounted.current=false;requests.current++;controller.current?.abort();};},[entity,reload]);
 const process:OrderProcess|null=readOrderProcess(workspace?.process,orderId,workspace?.process?.orderRevision);
 const disabled=detailRefreshing||!!detailError||managed&&(loading||!!error||!process||process.steps.find(s=>s.key===process.currentStep)?.state==='UNKNOWN');
 useEffect(()=>{if(process&&!defaultChosen.current){defaultChosen.current=true;const section=sectionForStep(process.currentStep);setSelected(section);setSelectedStep(process.currentStep);setVisited(v=>new Set([...v,section]));syncProcessSection(section);}},[process]);
 const after=async()=>{await reload();onRefresh();};
 const refresh=()=>{void reload().then(onRefresh).catch(()=>{});};
 const user=api.session?.user,permitted=(permission:string)=>can(user?.permissions||[],permission);
 const canReadCancellation=managed&&['ADMIN','OPERATIONS','FINANCE'].includes(user?.role||'')&&permitted('orders.read');
 const labels:Record<string,string>={overview:'订单基本信息',plan:'订阅方案',contracts:'合同与协议',handover:'车辆交接',services:'用车事务与权益',funds:'财务/收款核销',records:'变更/历史快照'};
 const sectionList=['overview','plan','contracts','handover','services','funds','records'].flatMap(key=>orderSections.filter(s=>s.key===key).map(s=>({...s,label:labels[key]}))).concat(managed?[{key:'settlement',label:'归还结算'},...(canReadCancellation?[{key:'cancellation',label:'取消订单'}]:[])]:[]);
 const sections=canReadCustomerProfile(user?.role)?[sectionList[0],{key:'customer-profile',label:'客户资料'},...sectionList.slice(1)]:sectionList;
 const tab=sections.some(s=>s.key===selected)?selected:'overview';
 const combined={...entity,...(workspace?{contracts:workspace.contracts,bills:workspace.billing,handovers:workspace.handovers,events:workspace.timeline}:{})};
 const doAction=(raw:ProcessAction)=>{
  if(disabled||!process||!raw.enabled)return;const action=scopedAction(raw,process);if(!action){setNotice('此入口尚未核对，请刷新本单后办理。');return;}
  const target=action.target!;setNotice('');
  if(action.key==='OPEN_ELECTRONIC'){select('contracts');return;}
  if(action.key==='OPEN_ORDER'){const section=target.section||'overview';if(sections.some(s=>s.key===section))select(section);return;}
  if(['OPEN_APPLICATION','OPEN_BUSINESS_RECORD','OPEN_ELECTRONIC'].includes(action.key)){
   if(target.resource==='orders'&&target.id===orderId){select(target.section||'overview');return;}
   if(target.resource&&permitted(`${target.resource}.read`)){const href=businessRecordHref(target.resource,target.id,target.section||'profile');if(href){rememberProcessPosition(user?.id||'');window.location.hash=processHref(href,window.location.hash);}}return;
  }
  const section=sectionForAction(action);
  if(section){select(section);setFocus({resource:target.resource||'',id:target.id,key:action.key,section:target.section,sequence:Date.now()});}
 };
 const safeAction=(a:ProcessAction):ProcessAction=>a.kind==='WAIT'?a:{...a,enabled:!disabled&&a.enabled&&!!process&&!!scopedAction(a,process),disabledReason:disabled?'正在核对最新状态，完整读取后可办理。':a.disabledReason};
 const safeCheck=(c:ProcessCheck):ProcessCheck=>({...c,...(c.action?{action:safeAction(c.action)}:{})});
 const guide:ProcessView|undefined=process?{...process,steps:process.steps.map(s=>({...s,actions:s.actions.map(safeAction),checks:s.checks.map(safeCheck)})),blockers:process.blockers.map(safeCheck),attention:process.attention.map(safeCheck),primaryAction:process.primaryAction?safeAction(process.primaryAction):undefined}:undefined;
 const step=guide?.steps.find(s=>s.key===selectedStep&&sectionForStep(s.key)===tab)||guide?.steps.find(s=>s.key===guide.currentStep&&sectionForStep(s.key)===tab)||guide?.steps.find(s=>sectionForStep(s.key)===tab);
 const recheck=process?processActions(process).find(a=>a.key==='RECHECK_DELIVERY'&&a.enabled):undefined;
 const deliveryRecheck=recheck&&permitted('orders.write')?<div className="order-recheck"><Command label="重新核对交付条件" path={`/admin/orders/${encodeURIComponent(orderId)}/recheck-delivery`} revision={process!.orderRevision} disabled={disabled} permission="orders.write" after={after} note="重新核对当前合同、实际净到账与车辆条件；只有全部满足才进入待交付。"/></div>:null;
 const nodeAction=(a:ProcessAction)=><button key={`${a.key}-${a.target?.id||''}`} className="button" disabled={!a.enabled} title={a.disabledReason} onClick={()=>doAction(a)}>{a.label}</button>;
 const checks=(items:ProcessCheck[])=><ul className="order-node-checks">{items.map((c,i)=><li key={`${c.code}-${i}`} className={`state-${c.state}`}><div><strong>{c.label}</strong>{c.ownerLabel?<span>办理方：{c.ownerLabel}</span>:null}</div>{c.description?<p>{c.description}</p>:null}{c.action&&c.action.kind!=='WAIT'?nodeAction(c.action):c.action?<p className="muted">{c.action.label}</p>:null}</li>)}</ul>;
 const content=(key:string)=>{
  if(key==='customer-profile')return <CommandBoundary disabled={disabled}><OrderQualificationPanel orderId={orderId} refreshKey={entity} disabled={disabled} after={after}/></CommandBoundary>;
  if(electronic&&key==='contracts')return <ElectronicContractHub orderId={orderId} disabled={disabled} refreshKey={revision} after={after}/>;
  if(offline&&key==='contracts')return <OrderContractPanel orderId={orderId} process={process} disabled={disabled} focus={focus} refreshKey={revision} after={after}/>;
  if(managed&&key==='funds')return <>{permitted('bills.read')||permitted('payments.read')||permitted('refunds.read')?<OrderFundsPanel orderId={orderId} process={process} disabled={disabled} focus={focus} refreshKey={revision} after={after} renderValues={renderValues}/>:<p className="muted">当前岗位无资金明细权限。</p>}{deliveryRecheck}</>;
  if(managed&&key==='handover')return <>{deliveryRecheck}<OrderHandoverPanel orderId={orderId} process={process} disabled={disabled} focus={focus} refreshKey={revision} after={after} renderValues={renderValues}/>{operations}</>;
  if(electronic&&key==='settlement')return <><ElectronicExitPanel orderId={orderId} kind="termination" disabled={disabled} after={after}/><OrderRecordPanel orderId={orderId} resource="return-settlements" rows={process?.related.settlements||[]} process={process} disabled={disabled} focus={focus} refreshKey={revision} after={after} renderValues={renderValues}/></>;
  if(managed&&key==='settlement')return <OrderRecordPanel orderId={orderId} resource="return-settlements" rows={process?.related.settlements||[]} process={process} disabled={disabled} focus={focus} refreshKey={revision} after={after} renderValues={renderValues}/>;
  if(key==='services')return <CommandBoundary disabled={disabled}>{managed&&permitted('order-changes.read')&&['ADMIN','OPERATIONS','FINANCE'].includes(user?.role||'')?<RenewalEntry orderId={orderId} disabled={disabled}/>:null}{permitted('usage-periods.read')?<OrderUsageAccount orderId={orderId} refreshKey={revision} disabled={disabled}/>:null}{permitted('entitlements.read')?<OrderEntitlements orderId={orderId}/>:null}</CommandBoundary>;
  if(electronic&&key==='cancellation')return <ElectronicExitPanel orderId={orderId} kind="cancellation04" disabled={disabled} after={after}/>;
  if(offline&&key==='cancellation')return canReadCancellation?<OrderOfflineActions order={entity} process={process} after={after} disabled={disabled} refreshKey={revision} renderValues={renderValues} onOpenSection={(section,nextFocus)=>{select(section);if(nextFocus)setFocus(nextFocus);}}/>:<p className="muted">当前岗位没有订单终止办理权限。</p>;
  if(key==='records'&&workspace){const timeline=Array.isArray(workspace.timeline)?workspace.timeline:[];return timeline.length?<ol className="order-timeline">{timeline.map((event:any)=><li key={event.id}><strong>{String(event.label)}</strong><p className="muted">{new Date(event.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</p></li>)}</ol>:<p className="muted">暂无本岗位可见的业务进度记录。</p>;}
  const data=orderSectionData(combined,key);return <>{Object.keys(data).length?renderValues(data):<p className="muted">本分区暂无可展示的资料。</p>}{key==='plan'?<p className="muted">此处为客户确认的方案快照；当前产品改版不会修改本单条款。</p>:null}{key==='handover'?operations:null}</>;
 };
 const stateLabel=(state:string)=>({DONE:'已完成',CURRENT:'当前阶段',BLOCKED:'待处理',WAITING:'未开始',NOT_APPLICABLE:'不适用',UNKNOWN:'待读取'} as Record<string,string>)[state]||'待读取';
 // Presentation groups only: completion is never inferred from a stage's position.
 const stages=[
  {key:'APPLICATION',label:'申请审核',steps:['APPLICATION']},
  {key:'CONTRACT',label:'合同归档',steps:['CONTRACT']},
  {key:'PAYMENT',label:'首期资金',steps:['PAYMENT']},
  {key:'DELIVERY',label:'车辆交付',steps:['DELIVERY']},
  {key:'IN_USE',label:'用车服务',steps:['IN_USE']},
  {key:'RETURN_SETTLEMENT',label:'归还结清',steps:['RETURN','SETTLEMENT']},
 ].map(stage=>{
  const items=stage.steps.map(key=>guide?.steps.find(s=>s.key===key));
  const state=items.some(s=>!s||s.state==='UNKNOWN')?'UNKNOWN':items.some(s=>s?.state==='BLOCKED')?'BLOCKED':items.some(s=>s?.state==='CURRENT')?'CURRENT':items.every(s=>s?.state==='NOT_APPLICABLE')?'NOT_APPLICABLE':items.every(s=>s?.state==='DONE'||s?.state==='NOT_APPLICABLE')?'DONE':'WAITING';
  const current=!!guide&&stage.steps.includes(guide.currentStep);
  const target=current?guide!.currentStep:items.find(s=>s&&s.state!=='DONE'&&s.state!=='NOT_APPLICABLE')?.key||stage.steps[stage.steps.length-1];
  return {...stage,state,current,target};
 });
 // Keep the selected tab/current stage visible on deep links and viewport changes,
 // without scrolling the form body or moving focus.
 useLayoutEffect(()=>{
  const reveal=(container:HTMLElement|null,selector:string)=>{
   const item=container?.querySelector<HTMLElement>(selector);if(!container||!item)return;
   const parent=container.getBoundingClientRect(),child=item.getBoundingClientRect();
   if(child.left<parent.left)container.scrollLeft+=child.left-parent.left;
   else if(child.right>parent.right)container.scrollLeft+=child.right-parent.right;
  };
  const revealCurrent=()=>{reveal(tabStrip.current,'[role=tab][aria-selected=true]');reveal(stageStrip.current,'[aria-current=step]');};
  revealCurrent();window.addEventListener('resize',revealCurrent);return()=>window.removeEventListener('resize',revealCurrent);
 },[tab,guide?.currentStep]);
 const text=(value:unknown)=>typeof value==='string'&&value.trim()?value:undefined;
 const field=(value:unknown,key:string)=>value&&typeof value==='object'&&!Array.isArray(value)?text((value as Record<string,unknown>)[key]):undefined;
 const vehicleId=text(entity.vehicleId)||field(entity.vehicle,'id'),vehicleName=field(entity.vehicle,'title');
 const originalOwners=Array.isArray(workspace?.parties)?workspace.parties.filter((party:unknown)=>field(party,'role')==='OWNER').map((party:unknown)=>field(party,'name')).filter(Boolean):[];
 const identity=[
  {label:text(entity.orderNo)?'订单编号':'订单 ID',value:text(entity.orderNo)||orderId},
  {label:'客户',value:field(entity.customer,'name')||'待核对'},
  {label:vehicleName?'车辆':'车辆编号',value:vehicleName||vehicleId||'待核对',vehicle:true},
  {label:'原合同出租方',value:originalOwners.length===1?originalOwners[0]:'以合同归档为准'},
 ];
 const tabKeyDown=(event:React.KeyboardEvent<HTMLButtonElement>)=>{
  if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;
  event.preventDefault();const items=Array.from(event.currentTarget.closest('[role="tablist"]')!.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const index=items.indexOf(event.currentTarget),next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowRight'?1:-1)+items.length)%items.length;
  items[next]?.focus();items[next]?.click();items[next]?.scrollIntoView({block:'nearest',inline:'nearest'});
 };
 return <div className={`detail-workspace order-workspace order-workspace-${layout}`} data-process-scope={orderId}>
  <section className="order-identity-summary" aria-label="订单身份摘要">
   <dl>{identity.map(item=><div key={item.label}><dt>{item.label}</dt><dd title={item.value}>{item.vehicle&&vehicleId&&permitted('vehicles.read')?<a aria-label={`查看当前车辆 ${vehicleId}`} href={processHref(resourceHref('vehicles',vehicleId,'overview'),window.location.hash)} onClick={()=>rememberProcessPosition(user?.id||'')}>{!vehicleName&&vehicleId.length>20?`${vehicleId.slice(0,12)}…${vehicleId.slice(-6)}`:item.value}</a>:item.vehicle&&!vehicleName&&vehicleId&&vehicleId.length>20?`${vehicleId.slice(0,12)}…${vehicleId.slice(-6)}`:item.value}</dd></div>)}</dl>
   <div className="order-identity-actions">{status}<button className="text-button" data-order-refresh onClick={refresh}>刷新详情</button></div>
  </section>
  {managed?<section className="order-fulfilment" aria-label="订单履约进度">
   <div className="order-fulfilment-heading"><h2>履约进度</h2><span>{loading?'正在核对最新进度':error||detailError?'读取未完成，办理已暂停':'按本单实际履约记录展示'}</span></div>
   <div className="order-stage-scroll" ref={stageStrip}><div className="order-stage-list">{stages.map(stage=><article key={stage.key} className="order-stage" data-order-stage={stage.key} data-state={stage.state} aria-current={stage.current?'step':undefined}>
    <div className="order-stage-heading"><strong className={stage.current?'is-current':undefined}>{stage.label}</strong>{stage.state==='BLOCKED'?<Tag color="red" variant="filled">阻塞</Tag>:null}</div>
    <Badge color={({DONE:'#52c41a',CURRENT:'#1677ff',BLOCKED:'#faad14'} as Record<string,string>)[stage.state]||'#bfbfbf'} text={stateLabel(stage.state)}/>
    <span className="order-stage-time">时间未提供</span>
    <div className="order-stage-actions"><Button type="text" size="small" aria-label={`进入${stage.label}`} title={`进入${stage.label}`} icon={<RightOutlined/>} disabled={!guide} onClick={()=>{setSelectedStep(stage.target);select(sectionForStep(stage.target));}}/></div>
   </article>)}</div></div>
  </section>:null}
  <nav className="order-business-tabs" ref={tabStrip} aria-label="本单业务导航">
   <div role="tablist" aria-orientation="horizontal" aria-label="订单业务分区">{sections.map(section=><button key={section.key} type="button" role="tab" id={`${uid}-${section.key}-tab`} aria-controls={`${uid}-${section.key}-panel`} aria-selected={tab===section.key} tabIndex={tab===section.key?0:-1} data-order-section={section.key} onKeyDown={tabKeyDown} onClick={()=>select(section.key)}>{section.label}</button>)}</div>
  </nav>
  <div className="detail-panel-scroll" ref={scroll} onScroll={()=>{if(scroll.current)positions.current[tab]=scroll.current.scrollTop;}}>
   <Card className="order-business-card" styles={{body:{padding:0}}}>
    <div className="order-section-heading"><h2>{step?.label||sections.find(s=>s.key===tab)?.label}</h2></div>
    {!managed?<div className="order-legacy-actions">{actions}{emptyActionMessage?<p>{emptyActionMessage}</p>:null}</div>:null}
    {loading?<p className="order-process-loading" role="status">正在核对最新进度…</p>:null}{error?<ErrorNotice error={error} retry={refresh}/>:null}{detailError||detailRefreshing?<p className="order-read-warning" role="status">订单基础资料尚未完整读取，已保留填写内容；恢复读取后才能提交。</p>:null}{notice?<p className="order-operation-receipt" role="status">{notice}</p>:null}
    {guide&&step?<section className="order-node-todo" aria-label="当前节点待办"><p>{step.summary}</p><details className="order-node-details"><summary>查看本阶段 {step.checks.length} 项条件与办理入口</summary>{checks(step.checks)}<div className="order-inline-actions">{step.actions.filter(a=>a.kind!=='WAIT').map(nodeAction)}</div></details>{guide.attention.length?<details className="order-attention"><summary>另有 {guide.attention.length} 项需要核对的事项</summary>{checks(guide.attention)}</details>:null}</section>:null}
    <CommandBoundary disabled={disabled} readVersion={revision}>{sections.filter(s=>visited.has(s.key)||s.key===tab).map(s=><section key={s.key} className="detail-tab-panel" role="tabpanel" id={`${uid}-${s.key}-panel`} aria-labelledby={`${uid}-${s.key}-tab`} hidden={s.key!==tab}>{content(s.key)}</section>)}</CommandBoundary>
   </Card>
  </div>
 </div>;
}
