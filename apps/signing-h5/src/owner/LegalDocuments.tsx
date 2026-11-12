import {useCallback,useRef,useState} from 'react';
import {Modal} from './Common';
import type {LegalClient,LegalTask} from './legal-client';
import {legalDocumentTitle,legalDocumentView,legalFilePath,legalPreviewKey} from './legal-documents';
import type {LegalFileVariant} from './legal-documents';
import {LegalPdfReader} from './LegalPdfReader';
import {dateTime} from './model';

function SignerSlots({task}:{task:LegalTask}){
 return <div className="legal-signers" aria-label="各方签署状态">{legalDocumentView(task).parties.map(p=><div className={`legal-signer${p.signed?' is-signed':''}`} key={p.role}><span className="legal-signer-mark" aria-hidden="true">{p.signed?'✓':'○'}</span><span><strong>{p.label}</strong><span>{p.status}</span></span></div>)}</div>;
}
export function LegalDocumentList({tasks,selected,busy,onSelect}:{tasks:LegalTask[];selected?:string;busy:boolean;onSelect:(id:string)=>void}){
 return <div className="legal-document-list">{tasks.map(task=>{
  const view=legalDocumentView(task);
  return <button type="button" key={task.id} className="legal-document-card" disabled={busy} aria-pressed={selected===task.id} aria-label={`查看${legalDocumentTitle(task.kind)}，${view.state}`} onClick={()=>onSelect(task.id)}>
   <span className="legal-document-heading"><strong>{legalDocumentTitle(task.kind)}</strong><span className={`legal-document-state${view.archived?' is-archived':''}`}>{view.state}</span></span>
   <SignerSlots task={task}/><span className="legal-document-hint">{view.hint}</span><span className="legal-document-open">{selected===task.id?'正在查看':'查看文件与办理'} <span aria-hidden="true">↗</span></span>
  </button>;
 })}</div>;
}
export function LegalTaskDetail({task,api,ownerId,sessionBinding,busy,onAction,onExpired}:{task:LegalTask;api:LegalClient;ownerId:string;sessionBinding:string;busy:boolean;onAction:(path:string,body:unknown)=>Promise<void>;onExpired:()=>void}){
 const [preview,setPreview]=useState<{variant:LegalFileVariant;attempt:number}|null>(null),[readyKey,setReadyKey]=useState(''),[accepted,setAccepted]=useState(false),[cancelOpen,setCancelOpen]=useState(false),[reason,setReason]=useState('');
 const attempt=useRef(0),confirming=useRef(false),currentPreview=useRef('');
 const view=legalDocumentView(task),title=legalDocumentTitle(task.kind),base=`/owners/${ownerId}/electronic-documents/${task.id}`;
 const role=task.frozenSources.parties.PLATFORM?.id===ownerId?'PLATFORM':'OWNER';
 const actionable=!view.allSigned&&!['SIGNED','ARCHIVED','CANCELLED','EXPIRED'].includes(task.status)&&task.nextAction.role===role;
 const canSign=actionable&&['SIGN','QUERY'].includes(task.nextAction.kind);
 const canAccept=actionable&&task.kind.startsWith('COOPERATION')&&role==='OWNER'&&task.parties.some(p=>p.role===role&&p.mode==='AUTO'&&p.status==='PENDING');
 const selection=preview?`${legalPreviewKey(sessionBinding,ownerId,task,preview.variant)}:${preview.attempt}`:'';
 currentPreview.current=selection;
 const canConsent=!!selection&&preview?.variant==='source'&&readyKey===selection;
 const closePreview=useCallback(()=>{setPreview(null);setReadyKey('');setAccepted(false);},[]);
 const closeCancel=useCallback(()=>{setCancelOpen(false);setReason('');},[]);
 function read(variant:LegalFileVariant){setAccepted(false);setReadyKey('');setPreview({variant,attempt:++attempt.current});}
 async function confirmCancel(){
  if(busy||confirming.current||reason.trim().length<2)return;
  confirming.current=true;const value=reason.trim();closeCancel();
  try{await onAction(`${base}/revoke-grant`,{revision:task.revision,reason:value,idempotencyKey:crypto.randomUUID()});}finally{confirming.current=false;}
 }
 return <section className="state-card legal-task-detail" aria-label={`${title}文件详情`}>
  <div className="legal-document-heading"><div><span className="record-kind">当前文件</span><h2 id="legal-current-document" tabIndex={-1}>{title}</h2></div><span className={`legal-document-state${view.archived?' is-archived':''}`}>{view.state}</span></div>
  <p className="legal-detail-hint">{view.hint}</p>
  {(task.legalCompletedAt||task.archivedAt)&&<div className="legal-document-dates">{task.legalCompletedAt&&<span>签署完成 {dateTime(task.legalCompletedAt)}</span>}{task.archivedAt&&<span>归档完成 {dateTime(task.archivedAt)}</span>}</div>}
  {task.stopStatus!=='NONE'&&<p className="partner-note">本文件已停止继续派发，已有签署结果由平台核对；签后文件可能仅用于证据保全。</p>}
  <div className="legal-document-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>read('source')}>阅读文件原件</button>{task.finalFileAvailable&&<button type="button" className="secondary" disabled={busy} onClick={()=>read('signed')}>查看签后文件</button>}<button type="button" className="secondary" disabled={busy} onClick={()=>void onAction(`${base}/sync`,{revision:task.revision,idempotencyKey:crypto.randomUUID()})}>状态刷新</button></div>
  {preview&&<LegalPdfReader key={selection} api={api} path={legalFilePath(ownerId,task.id,preview.variant)} title={title} variant={preview.variant} onClose={closePreview} onExpired={onExpired} onReady={ready=>{if(currentPreview.current!==selection)return;setReadyKey(ready?selection:'');if(!ready)setAccepted(false);}}/>}
  {(canSign||canAccept)&&<div className="legal-sign-confirm"><label className="check"><input type="checkbox" disabled={busy||!canConsent} checked={accepted&&canConsent} onChange={e=>setAccepted(e.target.checked)}/>本人已阅读本版完整 PDF 并同意签署</label>{!canConsent&&<p className="fineprint">请先打开文件原件，待 PDF 显示后阅读并勾选同意。</p>}<div className="legal-document-actions">{canSign&&<button type="button" className="primary" disabled={busy||!canConsent||!accepted} onClick={()=>void onAction(`${base}/sign`,{revision:task.revision,sourceSha256:task.sourceSha256,accepted:true,idempotencyKey:crypto.randomUUID()})}>本人逐份签署</button>}{canAccept&&<button type="button" className="primary" disabled={busy||!canConsent||!accepted} onClick={()=>void onAction(`${base}/accept`,{revision:task.revision,sourceSha256:task.sourceSha256,accepted:true,idempotencyKey:crypto.randomUUID()})}>本人逐份确认合作文本</button>}</div></div>}
  {task.grant&&!task.grant.revokedAt&&role==='OWNER'&&<div className="legal-cancel-action"><button type="button" className="text-button danger" disabled={busy} onClick={()=>{setReason('');setCancelOpen(true);}}>取消用印授权</button></div>}
  {task.grant?.revokedAt&&<p className="partner-note">用印授权已取消。已有文件与签署记录保留。</p>}
  {cancelOpen&&<Modal label="取消用印授权" close={closeCancel} closeLabel="关闭取消授权"><p>确认取消本项用印授权。已有文件与签署记录仍保留。</p><label className="field">取消原因<textarea autoFocus value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000} placeholder="请填写取消原因（至少 2 个字）"/></label><div className="legal-document-actions"><button type="button" className="secondary" onClick={closeCancel}>暂不取消</button><button type="button" className="primary" disabled={busy||reason.trim().length<2} onClick={()=>void confirmCancel()}>确认取消授权</button></div></Modal>}
 </section>;
}
