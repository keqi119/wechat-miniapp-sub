import {useRef,useState} from 'react';
import {ArrowRight,CheckCircle2,AlertCircle,Clock3} from 'lucide-react';
import {can,api} from './core';
import {handoverProcess,type ProcessView,type ProcessAction,type ProcessCheck} from './process-guide-model';
import './process-guide.css';
export type {ProcessView,ProcessAction,ProcessCheck,ProcessStep,ProcessState} from './process-guide-model';
const labels={DONE:'已完成',CURRENT:'当前阶段',BLOCKED:'待处理',WAITING:'待办理',NOT_APPLICABLE:'无需办理',UNKNOWN:'待核实'};
const resources=new Set(['orders','applications','offline-archives','insurance-policies','products','benefit-definitions','partners','handovers','handover-tasks','usage-periods','return-settlements','bills','payments','refunds','customers','vehicles']);
export function processDetailHref(action:ProcessAction){const t=action.target;if(action.kind!=='OPEN_DETAIL'||!t?.resource||!resources.has(t.resource))return null;const q=new URLSearchParams();if(t.id)q.set('record',t.id);if(t.section)q.set('view',t.section);if(t.orderId)q.set('orderId',t.orderId);return '#'+t.resource+(q.size?'?'+q.toString():'');}
/** Opens an existing command; never constructs an API mutation from a process projection. */
export function activateProcessAction(action:ProcessAction,element:HTMLElement|null):boolean{
 if(!action.enabled||action.kind==='WAIT'||!element)return false;
 const scope=element.closest<HTMLElement>('[data-process-scope]')||element.closest<HTMLElement>('.detail-workspace')||element.parentElement;
 if(!scope)return false;
 const key=action.target?.section||action.key,target=Array.from(scope.querySelectorAll<HTMLElement>('[data-process-action]')).find(e=>e.dataset.processAction===key);
 if(!target)return false;
 target.closest<HTMLElement>('[data-workspace-version]')?.dispatchEvent(new Event('process-reveal',{bubbles:true}));
 const panel=target.closest<HTMLElement>('[role="tabpanel"]');
 if(panel?.hidden){const tabId=panel.getAttribute('aria-labelledby');if(tabId)document.getElementById(tabId)?.click();}
 requestAnimationFrame(()=>{
  const revealed=Array.from(scope.querySelectorAll<HTMLElement>('[data-process-action]')).find(e=>e.dataset.processAction===key)||target;
  const control=revealed.matches('button,a')?revealed:revealed.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a');
  if(!control||control.matches(':disabled,[disabled]')||control.closest('[aria-disabled="true"],[inert]'))return;
  if(control.tagName==='A'&&!control.getAttribute('href')?.startsWith('#'))return;
  revealed.scrollIntoView({block:'nearest',behavior:'smooth'});control.focus();
  if(control.tagName==='BUTTON'||control.tagName==='A')control.click();
 });return true;
}
export function ProcessGuide({process,title='办理进度',compact=false,selectedStep,onStepSelect,onAction}:{process:ProcessView;title?:string;compact?:boolean;selectedStep?:string;onStepSelect?:(key:string)=>void;onAction?:(action:ProcessAction)=>void}){
 const ref=useRef<HTMLElement>(null),[notice,setNotice]=useState('');
 const steps=Array.isArray(process.steps)?process.steps:[],current=steps.find(s=>s.key===process.currentStep),selected=steps.find(s=>s.key===selectedStep)||current;
 const handle=(action:ProcessAction)=>{setNotice('');if(onAction){onAction(action);return;}if(action.kind==='REFRESH'){const button=ref.current?.closest('.detail-workspace')?.querySelector<HTMLButtonElement>('.detail-command-heading button');if(button){button.click();return;}}if(!activateProcessAction(action,ref.current))setNotice('请在本记录的详细资料中核对对应办理入口；若状态已变化，请刷新详情。');};
 const action=(a:ProcessAction,primary=false)=>{
  const permission=a.target?.resource&&a.kind==='OPEN_DETAIL'?can(api.session?.user.permissions||[],a.target.resource+'.read'):true;
  const enabled=a.enabled&&permission,why=!permission?'当前岗位无权打开此资料，请联系对应办理人员。':a.disabledReason;
  if(a.kind==='WAIT')return <span className="process-wait" title={why}><Clock3 size={15}/>{a.label}</span>;
  const href=!onAction&&enabled?processDetailHref(a):null;
  return <div className="process-action-wrap">{href?<a className={`button ${primary?'primary':''}`} href={href}>{a.label}<ArrowRight size={14}/></a>:<button type="button" className={`button ${primary?'primary':''}`} disabled={!enabled} onClick={()=>handle(a)}>{a.label}<ArrowRight size={14}/></button>}{!enabled&&why?<small>{why}</small>:null}</div>;
 };
 const checks=(items:ProcessCheck[],className:string)=><div className={className}>{items.map((item,i)=><div className={`process-check state-${item.state||'UNKNOWN'}`} key={item.code||i}><span className="process-check-icon">{item.state==='DONE'?<CheckCircle2 size={16}/>:item.state==='BLOCKED'?<AlertCircle size={16}/>:<Clock3 size={16}/>}</span><div><strong>{item.label}</strong>{item.description?<p>{item.description}</p>:null}{item.ownerLabel?<small>办理方：{item.ownerLabel}</small>:null}{item.action?action(item.action):null}</div></div>)}</div>;
 return <section className={`process-guide ${compact?'process-guide-compact':''}`} ref={ref} aria-label={title}><div className="process-heading"><span>{title}</span><strong>{current?.label||'进度待核实'}</strong></div><ol className="process-steps" aria-label={`${title}阶段`}>{steps.map((step,index)=><li key={step.key} className={`state-${step.state} ${selectedStep===step.key?'is-selected':''}`} aria-current={step.key===process.currentStep?'step':undefined}><button type="button" disabled={!onStepSelect} onClick={()=>onStepSelect?.(step.key)} aria-label={`${step.label}，${labels[step.state]||labels.UNKNOWN}`}><span className="process-step-icon">{step.state==='DONE'?<CheckCircle2 size={17}/>:String(index+1).padStart(2,'0')}</span><strong>{step.label}</strong><small>{labels[step.state]||labels.UNKNOWN}</small></button></li>)}</ol><div className="process-current"><p>{(compact?current:selected)?.summary||'正在核对当前记录，完整读取后显示办理顺序。'}</p>{process.primaryAction?action(process.primaryAction,true):null}</div>{!compact?<>{(process.blockers||[]).length?<section className="process-blockers"><h4>当前待办与阻断</h4>{checks(process.blockers,'process-checks')}</section>:null}{selected?.checks?.length?<section className="process-checklist"><h4>{selected.label} · 核对事项</h4>{checks(selected.checks,'process-checks')}</section>:null}{selected?.actions?.filter(a=>a.key!==process.primaryAction?.key).length?<div className="process-secondary-actions">{selected.actions.filter(a=>a.key!==process.primaryAction?.key).map(a=><div key={a.key}>{action(a)}</div>)}</div>:null}{process.attention?.length?<section className="process-attention">{checks(process.attention,'process-checks')}</section>:null}</>:null}{notice?<p className="process-local-notice" role="status">{notice}</p>:null}</section>;
}
export function HandoverProcessGuide({entity,resource='handover-tasks',onAction}:{entity:Record<string,any>;resource?:string;onAction?:(action:ProcessAction)=>void}){return <ProcessGuide process={handoverProcess(entity,resource)} title={resource==='handover-tasks'?'现场任务进度':'车辆交接进度'} onAction={onAction}/>;}
