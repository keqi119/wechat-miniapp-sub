import {useEffect,useId,useRef,useState,type DragEvent,type MouseEvent} from 'react';
import {api,ApiError,can,date} from './core';
import {useCommandDisabled} from './domain-ui';
import {documentCategories,documentCardCategories,documentSize,documentTypes,prepareDocumentFile,validDocumentPath,checkedDocuments,checkedUpload,checkedRemoval,type DocumentCategory,type DocumentItem,type DocumentList,type UploadReceipt,type RemoveReceipt,type VehicleDocumentView} from './vehicle-document-model';
import './vehicle-document-cards.css';
export type {VehicleDocumentView} from './vehicle-document-model';
type QueueItem={id:string;key:string;file:File;category:DocumentCategory;sourceRelativePath:string;sha256?:string;status:'等待'|'上传中'|'待确认'|'已完成'|'已暂停'};
type UploadAttempt={kind:'upload';item:QueueItem;body:FormData;from:{revision:number;vehicleRevision:number};accepted:boolean;uncertain?:boolean;receipt?:UploadReceipt};
type RemoveAttempt={kind:'remove';item:DocumentItem;body:{revision:number;vehicleRevision:number;idempotencyKey:string};accepted:boolean;uncertain?:boolean;receipt?:RemoveReceipt};
type Attempt=UploadAttempt|RemoveAttempt;
type Phase='ready'|'working'|'retry'|'readback'|'conflict'|'paused';
const message=(error:unknown)=>error instanceof Error?error.message:'操作失败，请稍后重试。';
const isFiles=(event:DragEvent)=>Array.from(event.dataTransfer.types||[]).includes('Files');
export function VehicleDocuments({vehicleId,refreshKey=0,view='certificates',onUpdated}:{vehicleId:string;refreshKey?:number;view?:VehicleDocumentView;onUpdated?:()=>void}){
 const value=api.session,signature=JSON.stringify([value?.user.id,value?.user.role,value?.user.permissions]),scope=useRef({value,signature,epoch:0});
 if(scope.current.value!==value||scope.current.signature!==signature)scope.current={value,signature,epoch:scope.current.epoch+1};
 if(!['ADMIN','OPERATIONS'].includes(value?.user.role||''))return <p className="vehicle-workspace-empty">当前岗位无权查看车辆原件。</p>;
 return <VehicleDocumentsBody key={`${vehicleId}|${view}|${scope.current.epoch}`} vehicleId={vehicleId} refreshKey={refreshKey} view={view} onUpdated={onUpdated}/>;
}
function VehicleDocumentsBody({vehicleId,refreshKey,view,onUpdated}:{vehicleId:string;refreshKey:number;view:VehicleDocumentView;onUpdated?:()=>void}){
 const disabled=useCommandDisabled(),uid=useId(),path='/admin/vehicles/'+encodeURIComponent(vehicleId)+'/documents';
 const [data,setData]=useState<DocumentList>(),[reading,setReading]=useState(true),[busy,setBusy]=useState(false),[readFailed,setReadFailed]=useState(false),[denied,setDenied]=useState(false),[error,setError]=useState<unknown>(),[notice,setNotice]=useState(''),[phase,setPhase]=useState<Phase>('ready'),[queue,setQueue]=useState<QueueItem[]>([]),[confirm,setConfirm]=useState<DocumentItem>(),[dragged,setDragged]=useState<DocumentCategory>();
 const alive=useRef(false),controller=useRef(new AbortController()),session=useRef(api.session),sequence=useRef(0),running=useRef(false),dataRef=useRef<DocumentList|undefined>(undefined),pending=useRef<Attempt|undefined>(undefined),queueRef=useRef<QueueItem[]>([]),phaseRef=useRef<Phase>('ready'),disabledRef=useRef(disabled),failedRef=useRef(false),readingRef=useRef(true),confirmRef=useRef<DocumentItem|undefined>(undefined),updated=useRef(onUpdated),inputs=useRef<Partial<Record<DocumentCategory,HTMLInputElement>>>({}),depth=useRef<Partial<Record<DocumentCategory,number>>>({}),seenRefresh=useRef(refreshKey);
 disabledRef.current=disabled;updated.current=onUpdated;
 const current=()=>alive.current&&session.current===api.session&&!controller.current.signal.aborted;
 const writable=()=>current()&&!disabledRef.current&&['ADMIN','OPERATIONS'].includes(api.session?.user.role||'')&&can(api.session?.user.permissions||[],'vehicles.write');
 const mode=(value:Phase)=>{phaseRef.current=value;if(current())setPhase(value);};
 const syncQueue=()=>{if(current())setQueue([...queueRef.current]);};
 const mark=(id:string,status:QueueItem['status'])=>{queueRef.current=queueRef.current.map(x=>x.id===id?{...x,status}:x);syncQueue();};
 const loseAccess=(cause:unknown)=>{
  if(!alive.current)return true;
  if(session.current===api.session&&!(cause instanceof ApiError&&([401,403].includes(cause.status)||cause.code==='SESSION_CHANGED')))return false;
  controller.current.abort();dataRef.current=undefined;pending.current=undefined;queueRef.current=[];confirmRef.current=undefined;setData(undefined);setQueue([]);setConfirm(undefined);setNotice('');setDenied(true);return true;
 };
 const load=async()=>{
  const seq=++sequence.current;if(current()){readingRef.current=true;setReading(true);}
  try{const result=checkedDocuments(await api.request<DocumentList>(path,{signal:controller.current.signal}));if(!current()||seq!==sequence.current)throw new Error('当前原件读取已失效');dataRef.current=result;setData(result);failedRef.current=false;setReadFailed(false);return result;}
  catch(cause){if(seq===sequence.current&&!loseAccess(cause)&&current()){failedRef.current=true;setReadFailed(true);setError(cause);}throw cause;}
  finally{if(current()&&seq===sequence.current){readingRef.current=false;setReading(false);}}
 };
 useEffect(()=>{alive.current=true;controller.current=new AbortController();void load().catch(()=>{});return()=>{alive.current=false;sequence.current++;controller.current.abort();pending.current=undefined;queueRef.current=[];confirmRef.current=undefined;};},[path]);
 useEffect(()=>{if(seenRefresh.current===refreshKey)return;seenRefresh.current=refreshKey;void load().catch(()=>{});},[refreshKey]);
 const refresh=async()=>{if(running.current)return;setError(undefined);try{await load();}catch(cause){if(current())setError(cause);}};
 const recheckConflict=async()=>{if(running.current)return;setError(undefined);try{await load();if(current()){mode('ready');setNotice('资料已重新核对，请重新拖入待传文件或再次确认删除。');}}catch(cause){if(current())setError(cause);}};
 const run=async()=>{
  if(running.current||!current()||!pending.current?.accepted&&!writable())return;
  if(!pending.current&&(readingRef.current||failedRef.current||!dataRef.current))return;
  running.current=true;setBusy(true);setError(undefined);setNotice('');mode('working');let confirmed=false;
  try{
   while(current()){
    if(!pending.current){
     const item=queueRef.current.find(x=>x.status!=='已完成'&&x.status!=='已暂停');if(!item)break;
     if(!writable()){mode('paused');break;}
     if(!dataRef.current||failedRef.current)throw new Error('请先重新读取车辆资料。');
     if(!item.sha256){const digest=await crypto.subtle.digest('SHA-256',await item.file.arrayBuffer());if(!current())return;item.sha256=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');}
     if(!writable()||failedRef.current||readingRef.current){mode('paused');break;}
     const version=dataRef.current;if(!version)throw new Error('请先重新读取车辆资料。');
     const body=new FormData();body.set('file',item.file);body.set('revision',String(version.revision));body.set('vehicleRevision',String(version.vehicleRevision));body.set('idempotencyKey',item.key);body.set('category',item.category);body.set('sourceRelativePath',item.sourceRelativePath);
     pending.current={kind:'upload',item,body,from:{revision:version.revision,vehicleRevision:version.vehicleRevision},accepted:false};
    }
    const attempt=pending.current;if(!attempt)break;
    if(!attempt.accepted){
     if(!writable()){mode('paused');break;}
     if(attempt.kind==='upload')mark(attempt.item.id,'上传中');
     try{
      const value=await api.request<UploadReceipt|RemoveReceipt>(attempt.kind==='upload'?path:path+'/'+encodeURIComponent(attempt.item.id)+'/remove',{method:'POST',body:attempt.body,signal:controller.current.signal,permission:'vehicles.write'});
      attempt.accepted=true;
      if(attempt.kind==='upload')attempt.receipt=checkedUpload(value as UploadReceipt,{sourceRelativePath:attempt.item.sourceRelativePath,category:attempt.item.category,sha256:attempt.item.sha256!,size:attempt.item.file.size,mimeType:attempt.item.file.type},attempt.from);
      else attempt.receipt=checkedRemoval(value as RemoveReceipt,attempt.item.id,attempt.body);
     }catch(cause){if(cause instanceof ApiError&&cause.code==='INVALID_RESPONSE'&&cause.status>=200&&cause.status<300)attempt.accepted=true;throw cause;}
    }
    if(!current())return;
    const result=await load();if(!current())return;
    const from=attempt.kind==='upload'?attempt.from:attempt.body;
    if(result.revision<from.revision+1||result.vehicleRevision<from.vehicleRevision)throw new Error('原件版本尚未确认本次操作。');
    if(attempt.kind==='upload'){
     const item=result.items.find(x=>x.sourceRelativePath===attempt.item.sourceRelativePath);
     if(!item||item.category!==attempt.item.category||item.name!==attempt.item.file.name||item.mimeType!==attempt.item.file.type||item.size!==attempt.item.file.size||item.sha256!==attempt.item.sha256||attempt.receipt&&item.id!==attempt.receipt.id)throw new Error('上传已受理，列表尚未确认此原件。');
     mark(attempt.item.id,'已完成');setNotice('资料已上传并确认。');
    }else{
     if(result.items.some(x=>x.id===attempt.item.id))throw new Error('删除已受理，列表仍待确认。');
     setNotice('资料已删除并确认。');
    }
    pending.current=undefined;confirmed=true;
    if(attempt.kind==='remove')break;
   }
   if(current()&&phaseRef.current==='working')mode('ready');
  }catch(cause){
   if(loseAccess(cause))return;if(!current())return;
   const attempt=pending.current;
   if(attempt?.accepted){attempt.uncertain=true;mode('readback');if(attempt.kind==='upload')mark(attempt.item.id,'待确认');setError(new Error('请求已受理，请重新读取结果确认。'+message(cause)));}
   else if(cause instanceof ApiError&&cause.status>=400&&cause.status<500&&cause.code!=='INVALID_RESPONSE'){
    pending.current=undefined;queueRef.current=queueRef.current.map(x=>x.status==='已完成'?x:{...x,status:'已暂停'});syncQueue();mode('conflict');setError(new Error(cause.status===409?'版本已变化，请核对最新资料后重新操作。':message(cause)+(attempt?.kind==='remove'?' 请重新读取资料后核对。':' 请修正后重新拖入文件。')));if(cause.status===409)await load().catch(readError=>{if(current())setError(readError);});
   }else if(attempt){attempt.uncertain=true;mode('retry');if(attempt.kind==='upload')mark(attempt.item.id,'待确认');setError(new Error('结果尚未确认，请按原请求重试。'+message(cause)));}
   else{mode('paused');setError(cause);}
  }finally{running.current=false;if(current()){setBusy(false);if(confirmed)updated.current?.();}}
 };
 const canSelect=()=>writable()&&!confirmRef.current&&!pending.current?.uncertain&&!['retry','readback','paused'].includes(phaseRef.current)&&(!readingRef.current||phaseRef.current==='working')&&!failedRef.current&&!!dataRef.current&&pending.current?.kind!=='remove';
 const enqueue=(files:File[],category:DocumentCategory)=>{
  if(!canSelect())return;
  try{
   if(!files.length)return;
   const prepared=files.map(file=>{const normalized=prepareDocumentFile(file),key=crypto.randomUUID(),sourceRelativePath='manual-uploads/'+key+'/'+normalized.name;if(!validDocumentPath(sourceRelativePath))throw new Error('文件名过长或含有无效路径字符。');return{id:key,key,file:normalized,category,sourceRelativePath,status:'等待' as const};});
   if(phaseRef.current==='conflict'||queueRef.current.every(x=>x.status==='已完成'||x.status==='已暂停'))queueRef.current=[];
   queueRef.current.push(...prepared);syncQueue();setError(undefined);setNotice('');if(!running.current)void run();
  }catch(cause){setError(cause);}
 };
 const remove=async()=>{
  const item=confirmRef.current,version=dataRef.current;if(!item||!version||!writable()||running.current||readingRef.current||failedRef.current||pending.current)return;
  pending.current={kind:'remove',item,body:{revision:version.revision,vehicleRevision:version.vehicleRevision,idempotencyKey:crypto.randomUUID()},accepted:false};confirmRef.current=undefined;setConfirm(undefined);void run();
 };
 const select=(category:DocumentCategory)=>{if(canSelect())inputs.current[category]?.click();};
 const enter=(event:DragEvent<HTMLElement>,category:DocumentCategory)=>{if(!isFiles(event))return;event.preventDefault();event.stopPropagation();depth.current[category]=(depth.current[category]||0)+1;if(canSelect())setDragged(category);};
 const leave=(event:DragEvent<HTMLElement>,category:DocumentCategory)=>{if(!isFiles(event))return;event.preventDefault();event.stopPropagation();depth.current[category]=Math.max(0,(depth.current[category]||0)-1);if(!depth.current[category])setDragged(value=>value===category?undefined:value);};
 const drop=(event:DragEvent<HTMLElement>,category:DocumentCategory)=>{if(!isFiles(event))return;event.preventDefault();event.stopPropagation();depth.current[category]=0;setDragged(undefined);enqueue(Array.from(event.dataTransfer.files||[]),category);};
 const blank=(event:MouseEvent<HTMLElement>,category:DocumentCategory)=>{if((event.target as HTMLElement).closest('a,button,input,[role="button"],[role="alertdialog"]'))return;select(category);};
 const locked=disabled||busy||reading||readFailed||phase!=='ready'||!!confirm||!can(api.session?.user.permissions||[],'vehicles.write');
 const selectionLocked=!canSelect(),allCategories=documentCardCategories(view);
 if(denied)return <p role="alert">车辆原件访问权限已失效，请重新核对登录权限。</p>;
 return <section className="vehicle-documents vehicle-material-cards" aria-label={view==='certificates'?'权证分类资料':view==='insurance'?'保险资料原件':view==='baas'?'电池资料原件':'待分类资料'}>
  {error?<p role="alert" className="error">{message(error)}</p>:null}{notice?<p role="status">{notice}</p>:null}{reading&&!busy?<p role="status">正在读取原件…</p>:null}
  {phase==='retry'||phase==='readback'||phase==='paused'?<div className="vehicle-document-recovery"><span>{phase==='paused'?'剩余上传已暂停，请核对车辆资料后继续。':phase==='readback'?'已受理，仅重新读取确认结果。':'原文件与请求已保留。'}</span>{phase==='paused'&&readFailed?<button className="button" disabled={busy||reading} onClick={()=>void refresh()}>重新读取资料</button>:<button className="button" disabled={busy||disabled&&phase!=='readback'} onClick={()=>void run()}>{phase==='readback'?'重新读取结果':phase==='paused'?'继续剩余上传':'重试原请求'}</button>}</div>:phase==='conflict'?<button className="button" disabled={busy||reading} onClick={()=>void recheckConflict()}>重新核对资料</button>:readFailed?<button className="button" disabled={busy||reading} onClick={()=>void refresh()}>重新读取资料</button>:null}
  {queue.some(x=>x.status!=='已完成')?<ol className="vehicle-document-progress" aria-label="资料上传进度">{queue.map(item=><li key={item.id}>{item.file.name}<span>{item.status}</span></li>)}</ol>:null}
  {data?<div className={'vehicle-document-card-grid'+(allCategories.length===1?' is-single':'')}>{allCategories.map(category=>{
   const rows=data.items.filter(item=>item.category===category),title=documentCategories[category];
   return <article key={category} data-document-category={category} className={'vehicle-document-type-card'+(dragged===category?' is-dragover':'')+(selectionLocked?' is-locked':'')} onClick={event=>blank(event,category)} onDragEnter={event=>enter(event,category)} onDragLeave={event=>leave(event,category)} onDragOver={event=>{if(isFiles(event)){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=canSelect()?'copy':'none';}}} onDrop={event=>drop(event,category)}>
    <header><h3>{title}<small>{rows.length} 份</small></h3><span className="vehicle-document-drop-hint" role="button" tabIndex={selectionLocked?-1:0} aria-label={'选择'+title+'资料'} aria-disabled={selectionLocked} onClick={()=>select(category)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select(category);}}}>拖拽至此，或点击选择</span></header>
    <input className="vehicle-document-hidden-input" tabIndex={-1} aria-label={title+'文件选择'} ref={element=>{if(element)inputs.current[category]=element;else delete inputs.current[category];}} type="file" multiple accept={Object.keys(documentTypes).join(',')} disabled={selectionLocked} onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';enqueue(files,category);}}/>
    {rows.length?<ul className="vehicle-document-list">{rows.map(item=><li key={item.id}><a className="vehicle-document-file" href={api.vehicleDocumentOpenUrl(vehicleId,item.id)} target="_blank" rel="noopener noreferrer" title={`${item.name}\n${item.sourceRelativePath}\n归档于 ${date(item.createdAt)}`}><span className="vehicle-document-kind" aria-hidden="true">{documentTypes[item.mimeType]}</span><span className="vehicle-document-name">{item.name}</span><span className="vehicle-document-size">{documentSize(item.size)}</span></a><button type="button" className="vehicle-document-delete" disabled={locked} aria-label={'删除 '+item.name} onClick={()=>{confirmRef.current=item;setConfirm(item);setError(undefined);setNotice('');}}>删除</button>{confirm?.id===item.id?<div role="alertdialog" aria-label={'确认删除 '+item.name} className="vehicle-document-confirm" onClick={event=>event.stopPropagation()}><p>确认从本车资料中删除“{item.name}”？已归档的历史记录仍会保留。</p><button type="button" className="button" onClick={()=>{confirmRef.current=undefined;setConfirm(undefined);}}>取消删除</button><button type="button" className="button danger" disabled={disabled||busy||reading||readFailed} onClick={()=>void remove()}>确认删除</button></div>:null}</li>)}</ul>:<p className="vehicle-document-empty">暂无资料</p>}
   </article>;
  })}</div>:null}
 </section>;
}
