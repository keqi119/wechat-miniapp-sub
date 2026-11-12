import {createContext,useCallback,useContext,useEffect,useId,useRef,useState} from 'react';
import type {ReactNode,RefObject} from 'react';
import {documentLabel} from './model';
import type {LegalDocument} from './model';
import type {Feedback} from './workspace';

export function Notice({children,tone='info'}:{children:ReactNode;tone?:'info'|'error'|'success'}){
 return <div className={`notice ${tone}`} role={tone==='error'?'alert':'status'}>{children}</div>;
}
type FeedbackItem={source:string;value:Feedback;body:ReactNode;visible?:boolean};
const FeedbackContext=createContext<{offer:(item:FeedbackItem)=>void;dismiss:()=>void}>({offer:()=>{},dismiss:()=>{}});
export function FeedbackProvider({children}:{children:ReactNode}){
 const [current,setCurrent]=useState<FeedbackItem|null>(null),seen=useRef(new WeakSet<Feedback>());
 const trigger=useRef<HTMLElement|null>(null);
 useEffect(()=>{const remember=(event:MouseEvent)=>{const element=event.target instanceof Element?event.target.closest<HTMLElement>('button,a,input,summary'):null;if(element&&!element.closest('[role="dialog"]'))trigger.current=element;};document.addEventListener('click',remember,true);return()=>document.removeEventListener('click',remember,true);},[]);
 const dismiss=useCallback(()=>setCurrent(null),[]);
 const offer=useCallback((item:FeedbackItem)=>{const fresh=!seen.current.has(item.value);seen.current.add(item.value);setCurrent(old=>item.visible===false?old:fresh||old?.source===item.source&&old.value===item.value?item:old);},[]);
 return <FeedbackContext.Provider value={{offer,dismiss}}>{children}{current&&<div className="owner-app feedback-host"><Modal label="操作反馈" close={dismiss} closeLabel="关闭反馈" restoreTarget={trigger}><div className="feedback-body">{current.body}</div><button className="primary full" onClick={dismiss}>知道了</button></Modal></div>}</FeedbackContext.Provider>;
}
export const useDismissFeedback=()=>useContext(FeedbackContext).dismiss;
export function ActionFeedback({value,busy,canRefresh,onRefresh}:{value?:Feedback;busy:boolean;canRefresh?:boolean;onRefresh?:()=>void}){
 const {offer}=useContext(FeedbackContext),source=useId(),marker=useRef<HTMLSpanElement>(null),refresh=useRef(onRefresh);refresh.current=onRefresh;
 useEffect(()=>{
  if(!value||!value.error&&!value.note)return;
  offer({source,value,visible:!marker.current?.parentElement?.closest('[hidden]'),body:<>{value.context&&<p className="fineprint">{value.context}</p>}{value.error&&<Notice tone="error">{value.error}{value.certificateCode&&<>
  <p>{value.certificateCode==='OWNER_CERT_CHANGED'?'请先重新核验企业与证书状态。原待签授权书不会自动换绑证书；核验后请按提示撤回旧授权，重新确认授权范围。':'请主动重新核验证书，以供应商最新结果为准；查询不会代您签署文件。'}</p>
  <button className="secondary full" disabled={busy||!canRefresh} onClick={()=>refresh.current?.()}>重新核验证书</button>
  {!canRefresh&&<p>当前暂不能查询，请先重新读取企业资料；仍不可用时请联系平台核对。</p>}
 </>}</Notice>}{value.note&&<Notice tone={value.tone||'success'}>{value.note}</Notice>}</>});
 },[value,busy,canRefresh,source,offer]);
 return <span ref={marker} hidden/>;
}
const modalStack=new Map<string,HTMLDivElement>();
export function Modal({label,close,closeLabel,children,restoreTarget}:{label:string;close:()=>void;closeLabel:string;children:ReactNode;restoreTarget?:RefObject<HTMLElement|null>}){
 const panel=useRef<HTMLDivElement>(null),modalId=useId();
 useEffect(()=>{
  const previous=restoreTarget?.current||document.activeElement as HTMLElement|null;document.body.classList.add('modal-open');panel.current?.focus({preventScroll:true});
  if(panel.current)modalStack.set(modalId,panel.current);
  function onKey(event:KeyboardEvent){
   if([...modalStack.keys()].at(-1)!==modalId)return;
   if(event.key==='Escape'){event.preventDefault();close();}
   if(event.key==='Tab'){
    const elements=[...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')||[])],first=elements[0],last=elements.at(-1);
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===panel.current)){event.preventDefault();first?.focus();}
   }
  }
  document.addEventListener('keydown',onKey);return()=>{modalStack.delete(modalId);if(!modalStack.size)document.body.classList.remove('modal-open');document.removeEventListener('keydown',onKey);const remaining=[...modalStack.values()].at(-1);if(remaining)remaining.focus({preventScroll:true});else if(previous?.isConnected&&!previous.closest('[hidden]'))previous.focus({preventScroll:true});};
 },[close]);
 return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={panel}>
  <div className="modal-head"><h2>{label}</h2><button className="icon-button" type="button" onClick={close} aria-label={closeLabel}>×</button></div>{children}
 </div></div>;
}
export function LegalDialog({document:doc,close}:{document:LegalDocument;close:()=>void}){
 return <Modal label={documentLabel(doc.type)} close={close} closeLabel="关闭文案"><p className="eyebrow">当前已发布版本 · v{doc.version}</p><h3>{doc.title}</h3><div className="document-body">{doc.content}</div></Modal>;
}
export function LegalLinks({types,onLegal}:{types:string[];onLegal:(type:string)=>void}){
 return <span>{types.map((type,index)=><span key={type}>{index>0?'、':''}<button className="inline-link" type="button" onClick={()=>onLegal(type)}>{documentLabel(type)}</button></span>)}</span>;
}
