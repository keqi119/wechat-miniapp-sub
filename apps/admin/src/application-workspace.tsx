import {useEffect,useState} from 'react';
import {ArrowRight,CheckCircle2,Clock3,AlertCircle} from 'lucide-react';
import {api,type Entity} from './core';
import {detailFor,type Action} from './resources';
import type {CreditReview} from './credit';
import {DetailFrame,DetailValues,ErrorNotice,Status} from './ui';
import {ApplicationCreditReview} from './credit-ui';
import {ApplicationRiskPanel,CustomerQualificationPanel} from './customer-risk';
import {CustomerProfilePanel} from './customer-profile';
import {applicationProgress,applicationActionReceipt} from './application-progress';
import {detailSummary} from './detail-layout';
import type {Row} from './domain-ui';
import './application-workspace.css';
import {syncProcessSection} from './process-navigation';
import {VirtualApplicationWorkspace} from './virtual-application';

const stateNames:Record<string,string>={done:'已完成',current:'当前阶段',pending:'待前置完成',blocked:'待处理',unknown:'待核实'};
const taskStateNames:Record<string,string>={...stateNames,pending:'待办理'};
type FactsState={key:string;applicationId:string;customerId:unknown;qualification:Row;risk?:Row};
type WorkspaceProps={application:Entity;creditReview?:CreditReview;creditError?:unknown;detailError?:unknown;detailRefreshing?:boolean;refreshKey:number;onRefresh:()=>void;actions:Action[];onAction:(action:Action)=>void;receiptAction?:string};
export function ApplicationWorkspace(props:WorkspaceProps){return props.application.virtualAcceptance?<VirtualApplicationWorkspace {...props}/>:<OrdinaryApplicationWorkspace {...props}/>;}
function OrdinaryApplicationWorkspace({application,creditReview,creditError,detailError,detailRefreshing=false,refreshKey,onRefresh,actions,onAction,receiptAction}:WorkspaceProps){
 const [tab,setTab]=useState(()=>{const view=new URLSearchParams(window.location.hash.split('?')[1]).get('view');return ['overview','customer-profile','credit','risk','details'].includes(view||'')?view!:'overview';}),[facts,setFacts]=useState<FactsState>(),[error,setError]=useState<unknown>(),[localReceipt,setLocalReceipt]=useState('');
 useEffect(()=>{const changed=()=>{const view=new URLSearchParams(window.location.hash.split('?')[1]).get('view');if(view&&['overview','customer-profile','credit','risk','details'].includes(view))setTab(view);};window.addEventListener('hashchange',changed);window.addEventListener('process-location',changed);return()=>{window.removeEventListener('hashchange',changed);window.removeEventListener('process-location',changed);};},[]);
 const plan=application.finalPlan as Row|undefined,key=`${application.id}:${application.revision}:${refreshKey}`;
 useEffect(()=>{
  const controller=new AbortController();setError(undefined);
  Promise.all([api.request<Row>(`/admin/customers/${encodeURIComponent(String(application.customerId))}/qualifications`,{signal:controller.signal}),plan?api.request<Row>(`/admin/applications/${encodeURIComponent(application.id)}/risk-reviews`,{signal:controller.signal}):Promise.resolve(undefined)])
   .then(([qualification,risk])=>{if(!controller.signal.aborted)setFacts({key,applicationId:application.id,customerId:application.customerId,qualification,risk});})
   .catch(cause=>{if(!controller.signal.aborted)setError(cause);});
  return()=>controller.abort();
 },[key,application.id,application.customerId,!!plan]);
 const current=facts?.key===key?facts:undefined,displayFacts=facts?.applicationId===application.id&&facts.customerId===application.customerId?facts:undefined,readError=detailError||creditError||error;
 const loadState=readError?'error':detailRefreshing||!current||!creditReview?'loading':'ready';
 const progress=applicationProgress({application,credit:creditReview,qualification:current?.qualification,risk:current?.risk,loadState,actorId:api.session?.user.id});
 const receipt=(localReceipt||receiptAction)?applicationActionReceipt(localReceipt||receiptAction!):undefined;
 const recordReceipt=(action:string)=>{setLocalReceipt(action);setTab('overview');syncProcessSection('overview');};
 const committed=(action:string)=>{recordReceipt(action);onRefresh();};
 const select=(next:string)=>{setTab(next);syncProcessSection(next);requestAnimationFrame(()=>document.querySelector('.application-workspace .detail-panel-scroll')?.scrollTo({top:0}));};
 const go=(target:string)=>{
  if(target==='refresh'){onRefresh();return;}
  if(target==='order'){const order=application.order as Row|undefined;if(order?.id)window.location.hash=`orders?record=${encodeURIComponent(order.id)}`;return;}
  if(target==='accept'||target==='plan'){
   const action=actions.find(item=>target==='plan'?item.path==='final-plan':item.path==='review'&&item.fixed?.decision==='IN_REVIEW');
   if(action&&loadState==='ready'&&(target!=='plan'||progress.canGeneratePlan)){onAction(target==='plan'?{...action,label:plan?'更新待审方案':'生成待审方案'}:action);return;}
  }
  select(({profile:'customer-profile',credit:'credit',plan:'risk',risk:'risk',customer:'overview'} as Record<string,string>)[target]||'overview');
 };
 const secondary=actions.filter(action=>action.path==='review'&&(action.fixed?.decision!=='IN_REVIEW'||progress.showAccept&&application.status==='NEEDS_INFO'));
 const planAction=actions.find(action=>action.path==='final-plan'),creditAction=actions.find(action=>action.path==='credit-verifications');
 const planLabel=plan?'更新待审方案':'生成待审方案';
 const overview=<>
  <section className="application-progress" aria-label="申请办理进度">
   {receipt?<div className="application-receipt" role="status"><strong>{receipt.title}</strong><p>{receipt.description}</p><small>{loadState==='error'?'操作已提交，最新进度暂未读到，请刷新核对。':loadState==='loading'?'操作已提交，正在读取最新进度。':`最新进度：${progress.current.title}`}</small></div>:null}
   <div className="application-stage-heading"><span>当前阶段</span><h3>{progress.current.title}</h3><p>{progress.current.description}</p></div>
   {readError?<ErrorNotice error={readError} retry={onRefresh}/>:null}
   {progress.blockers.length?<section className="application-blockers" aria-label="当前阻断事项"><h4>当前阻断事项</h4>{progress.blockers.map(block=><div className="application-blocker" key={block.key}><AlertCircle size={16}/><div><strong>{block.title}</strong><p>{block.description}</p>{block.target&&block.actionLabel?<button type="button" className="text-button" onClick={()=>go(block.target)}>{block.actionLabel}<ArrowRight size={13}/></button>:null}</div></div>)}</section>:null}
   {progress.next?<section className="application-next" aria-label="下一步操作"><div><strong>下一步</strong><p>{progress.next.description}</p></div>{progress.next.target==='customer'?<span className="application-waiting">等待客户本人操作</span>:<button type="button" className="button primary" disabled={loadState==='loading'} onClick={()=>go(progress.next!.target)}>{progress.next.label}<ArrowRight size={15}/></button>}</section>:null}
   <ol className="application-stages" aria-label="申请办理阶段">{progress.stages.map((stage,index)=><li className={`stage-${stage.state}`} key={stage.key} aria-current={stage.state==='current'?'step':undefined}><span>{stage.state==='done'?<CheckCircle2 size={17}/>:String(index+1).padStart(2,'0')}</span><strong>{stage.label}</strong><small>{stateNames[stage.state]||'待核实'}</small></li>)}</ol>
   <section className="application-preparation" aria-label="审核准备事项"><h4>审核准备</h4><p>身份与驾驶资格、信用核验可并行办理。信用有效后可生成待审方案；资格、信用和当前方案齐备后，才能通过本单风控。</p><div className="application-tasks">{progress.tasks.map(task=><article className={`task-${task.state}`} key={task.key}><div><strong>{task.title}</strong><span>{task.state==='done'?<CheckCircle2 size={15}/>:<Clock3 size={15}/>} {taskStateNames[task.state]||'待核实'}</span></div><p>{task.description}</p>{task.target&&task.actionLabel?<button type="button" className="text-button" onClick={()=>go(task.target)}>{task.actionLabel}<ArrowRight size={13}/></button>:null}</article>)}</div></section>
  </section>
  <section className="application-summary"><h4>本次申请</h4><DetailValues entity={detailSummary(application)} resource="applications" labels={plan?.contractMode==='ELECTRONIC'?{startDate:'计划交付日期'}:undefined}/></section>
 </>;
 return <DetailFrame className="application-workspace" status={<><Status value={application.status} resource="applications"/><strong className="application-status-title">{progress.current.title}</strong></>} actions={<>{secondary.map(action=><button type="button" className={`button ${action.kind==='danger'?'danger':''}`} key={action.label} disabled={loadState!=='ready'} onClick={()=>onAction(action)}>{action.fixed?.decision==='IN_REVIEW'?'继续审核':action.label}</button>)}</>} emptyActionMessage="按下方进度办理。受理、生成方案和风控通过是不同步骤；客户确认后才形成正式订单。" onRefresh={onRefresh} activeTab={tab} onTabChange={setTab} tabs={[
  {key:'overview',label:'处理概览',content:overview},
  {key:'customer-profile',label:'客户资料',content:<><section className="application-section-intro"><h3>身份与驾驶资格</h3><p>先核对已上传证件并提交资格资料，再由符合权限的其他人员独立审核。提交资料不代表审核通过。</p></section><CustomerQualificationPanel customerId={String(application.customerId)} controlled={{data:displayFacts?.qualification,error:readError,loading:loadState==='loading'}} after={onRefresh} onCommitted={recordReceipt} showSubmit={false}/><CustomerProfilePanel resource="applications" recordId={application.id} refreshKey={refreshKey} onQualificationSaved={()=>committed('qualification-submit')}/></>},
  {key:'credit',label:'信用核验',content:<><section className="application-section-intro"><h3>本申请信用核验</h3><p>客户独立授权后录入信用档位，用于本次押金计算。有效信用核验完成后，可生成待审方案。</p>{creditAction?<button type="button" className="button primary" disabled={loadState!=='ready'} onClick={()=>onAction(creditAction)}>{creditAction.label}</button>:null}</section><ApplicationCreditReview review={creditReview} error={creditError} refresh={onRefresh}/></>},
  {key:'risk',label:'方案风控',content:<><section className="application-section-intro"><h3>{plan?'本次待审方案':'准备待审方案'}</h3><p>{plan?'更新方案后须重新审核本版，旧审核结论不能用于新版本。':'先完成有效信用核验，再填写商业条款生成候选方案。'}</p>{planAction?<button type="button" className="button" disabled={loadState!=='ready'||!progress.canGeneratePlan} onClick={()=>onAction({...planAction,label:planLabel})}>{planLabel}</button>:null}</section><ApplicationRiskPanel application={application} after={onRefresh} controlled={{data:displayFacts?.risk,qualification:displayFacts?.qualification,error:readError,loading:loadState==='loading'}} onCommitted={recordReceipt}/></>},
  {key:'details',label:'详细资料',content:<DetailValues entity={detailFor('applications',application)} resource="applications" labels={plan?.contractMode==='ELECTRONIC'?{startDate:'计划交付日期'}:undefined}/>},
 ]}/>;
}
