import {useEffect,useRef,useState,type DragEvent} from 'react';
import {api,ApiError} from './core';
import {useCommandDisabled} from './domain-ui';
import {MediaScope,PrivateImage,accessFailure,checkGallery,checkImage,definiteFailure,mediaError,mediaPath,mediaWritable,useMediaResource,type Gallery,type MediaProps} from './vehicle-media';

type UploadItem={file:File;key:string;status:'等待'|'上传中'|'已完成'|'待确认'};
type Attempt={method:'POST'|'PATCH';body:FormData|Record<string,unknown>;receipt?:Gallery};
export function VehiclePhotos(props:MediaProps){return <MediaScope vehicleId={props.vehicleId}><PhotosBody {...props}/></MediaScope>;}
function PhotosBody({vehicleId,refreshKey=0,onUpdated,onFrozenChange}:MediaProps){
 const attempt=useRef<Attempt|undefined>(undefined),acceptedRefresh=useRef(refreshKey),freezeCallback=useRef(onFrozenChange);freezeCallback.current=onFrozenChange;
 if(!attempt.current)acceptedRefresh.current=refreshKey;
 const boundary=useCommandDisabled(),path=mediaPath(vehicleId)+'/photos',r=useMediaResource<Gallery>(path,value=>checkGallery(value,vehicleId),acceptedRefresh.current);
 const[queue,setQueue]=useState<UploadItem[]>([]),[busy,setBusy]=useState(false),[phase,setPhase]=useState<'ready'|'retry'|'readback'|'conflict'>('ready'),[notice,setNotice]=useState('');
 const queueRef=useRef<UploadItem[]>([]),inflight=useRef(false),input=useRef<HTMLInputElement>(null),dragDepth=useRef(0);
 const[dragged,setDragged]=useState(false);
 const frozen=busy||!!attempt.current;
 useEffect(()=>{freezeCallback.current?.(frozen);},[frozen]);
 useEffect(()=>()=>freezeCallback.current?.(false),[]);
 const mark=(index:number,status:UploadItem['status'])=>{queueRef.current=queueRef.current.map((x,i)=>i===index?{...x,status}:x);setQueue(queueRef.current);};
 const select=(files:File[])=>{if(!files.length||!canSelect())return;r.setError(undefined);setNotice('');try{files.forEach(checkImage);if(files.length+(r.data?.mediaFileIds.length||0)>20)throw new Error('每车最多 20 张照片，请减少本次选择。');queueRef.current=files.map(file=>({file,key:crypto.randomUUID(),status:'等待'}));setQueue(queueRef.current);setPhase('ready');void run();}catch(e){queueRef.current=[];setQueue([]);r.setError(e);}};
 const run=async(patch?:Record<string,unknown>)=>{
  if(inflight.current||boundary||!mediaWritable()||r.denied||r.reading||r.failed&&phase!=='readback')return;
  inflight.current=true;setBusy(true);r.setError(undefined);setNotice('');let index=-1;
  try{
   if(patch)attempt.current={method:'PATCH',body:patch};
   do{
    if(!r.current())return;
    index=queueRef.current.findIndex(x=>x.status!=='已完成');
    if(!attempt.current){if(index<0)break;const item=queueRef.current[index];if(!r.data)throw new Error('请先读取车辆照片');const body=new FormData();body.set('file',item.file);body.set('revision',String(latest.current?.vehicleRevision??r.data.vehicleRevision));body.set('idempotencyKey',item.key);attempt.current={method:'POST',body};}
    const pending=attempt.current;if(pending.method==='POST'&&index>=0)mark(index,'上传中');
    if(!pending.receipt){pending.receipt=checkGallery(await api.request<Gallery>(path,{method:pending.method,body:pending.body,signal:r.controller.current.signal,permission:'vehicles.write'}),vehicleId);if(!r.current())return;r.setData(pending.receipt);latest.current=pending.receipt;}
    setPhase('readback');const result=await r.load();if(!r.current())return;
    if(result.vehicleRevision<pending.receipt.vehicleRevision||pending.receipt.mediaFileIds.some(id=>!result.items.some(file=>file.id===id)))throw new Error('已保存，但列表尚未确认本次照片，请重新读取结果。');
    latest.current=result;const wasPatch=pending.method==='PATCH';attempt.current=undefined;setPhase('ready');if(wasPatch){setNotice('车辆照片设置已保存。');break;}if(index>=0)mark(index,'已完成');
   }while(queueRef.current.some(x=>x.status!=='已完成'));
   if(r.current())onUpdated?.();
  }catch(e){if(accessFailure(e)){attempt.current=undefined;queueRef.current=[];setQueue([]);r.failure(e);return;}if(r.current()){
   r.setError(e);
   if(accessFailure(e)){attempt.current=undefined;queueRef.current=[];setQueue([]);r.failure(e);}
   else if(attempt.current?.receipt){setPhase('readback');if(index>=0)mark(index,'待确认');}
   else if(definiteFailure(e)){attempt.current=undefined;setPhase('conflict');if(index>=0)mark(index,'等待');if(e instanceof ApiError&&e.status===409)await r.load().catch(()=>{});}
   else{setPhase('retry');if(index>=0)mark(index,'待确认');}
  }}finally{inflight.current=false;if(r.current())setBusy(false);}
 };
 const latest=useRef<Gallery|undefined>(undefined);if(r.data&&(!latest.current||r.data.vehicleRevision>=latest.current.vehicleRevision))latest.current=r.data;
 const locked=boundary||!mediaWritable()||busy||r.reading||r.failed||phase!=='ready',gallery=r.data;
 const selectionLocked=locked||!gallery||!!attempt.current;
 const canSelect=()=>!selectionLocked&&!inflight.current&&!attempt.current&&r.current()&&!input.current?.matches(':disabled');
 const choose=()=>{if(canSelect())input.current?.click();};
 const fileDrag=(event:DragEvent<HTMLElement>)=>Array.from(event.dataTransfer.types).includes('Files');
 const update=(ids:string[],cover:string|null)=>{if(locked||!gallery)return;void run({revision:gallery.vehicleRevision,idempotencyKey:crypto.randomUUID(),mediaFileIds:ids,coverFileId:cover});};
 const ordered=gallery?[...gallery.mediaFileIds,...(gallery.coverFileId&&!gallery.mediaFileIds.includes(gallery.coverFileId)?[gallery.coverFileId]:[])].map(id=>gallery.items.find(x=>x.id===id)!):[];
 if(r.denied)return <p role="alert">车辆照片访问权限已失效，请重新核对登录权限。</p>;
 return <section className={'vehicle-media-panel vehicle-photo-drop-card'+(dragged&&!selectionLocked?' is-dragover':'')} aria-label="车辆照片"
  onClick={event=>{if(!(event.target as HTMLElement).closest('a,button,input,[role="button"],[role="dialog"],.vehicle-media-card'))choose();}}
  onDragEnter={event=>{if(!fileDrag(event))return;event.preventDefault();event.stopPropagation();dragDepth.current++;if(canSelect())setDragged(true);}}
  onDragLeave={event=>{if(!fileDrag(event))return;event.preventDefault();event.stopPropagation();dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragged(false);}}
  onDragOver={event=>{if(!fileDrag(event))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=canSelect()?'copy':'none';}}
  onDrop={event=>{if(!fileDrag(event))return;event.preventDefault();event.stopPropagation();dragDepth.current=0;setDragged(false);select(Array.from(event.dataTransfer.files));}}>
  <header className="vehicle-media-heading"><div><h2>车辆照片 <small>{ordered.length} 张</small></h2><p>本车所有商品共用照片与封面。最多 20 张，每张 JPEG / PNG 不超过 10 MiB。</p></div><div className="vehicle-photo-card-tools"><span className="vehicle-photo-drop-hint" role="button" tabIndex={selectionLocked?-1:0} aria-label="上传车辆照片" aria-disabled={selectionLocked} onClick={choose} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose();}}}>拖拽至此，或点击选择</span><button type="button" className="text-button" disabled={busy||r.reading||!!attempt.current} onClick={()=>void r.load().catch(()=>{})}>刷新车辆照片</button></div></header>
  <input ref={input} hidden tabIndex={-1} aria-label="选择车辆照片" type="file" multiple accept="image/jpeg,image/png" disabled={selectionLocked} onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';select(files);}}/>
  {r.error?<p role="alert" className="vehicle-media-form-error">{mediaError(r.error)}</p>:null}{notice?<p role="status">{notice}</p>:null}{r.reading?<p role="status">正在读取照片…</p>:null}
  <div className="vehicle-media-grid">{ordered.map((file,index)=><article className="vehicle-media-card" key={file.id}><PrivateImage vehicleId={vehicleId} file={file} kind="photos" onError={r.failure}/><strong>{file.name}</strong><small>{gallery?.coverFileId===file.id?'当前封面':`第 ${index+1} 张`}{!gallery?.mediaFileIds.includes(file.id)?' · 历史独立封面':''}</small><div className="vehicle-media-actions"><button className="button" disabled={locked||gallery?.coverFileId===file.id} aria-label={'设为封面 '+file.name} onClick={()=>update(ordered.map(x=>x.id),file.id)}>设为封面</button><button className="button" disabled={locked||index===0} aria-label={'上移 '+file.name} onClick={()=>{const ids=ordered.map(x=>x.id);[ids[index-1],ids[index]]=[ids[index],ids[index-1]];update(ids,gallery!.coverFileId);}}>上移</button><button className="button" disabled={locked||index===ordered.length-1} aria-label={'下移 '+file.name} onClick={()=>{const ids=ordered.map(x=>x.id);[ids[index+1],ids[index]]=[ids[index],ids[index+1]];update(ids,gallery!.coverFileId);}}>下移</button><button className="button" disabled={locked} aria-label={'移除 '+file.name} onClick={()=>update(ordered.filter(x=>x.id!==file.id).map(x=>x.id),gallery?.coverFileId===file.id?null:gallery!.coverFileId)}>移除绑定</button></div></article>)}</div>
  {gallery&&!ordered.length?<div className="vehicle-photo-empty"><strong>拖拽车辆照片到此处</strong><span>支持多张同时上传，也可点击卡片选择照片</span></div>:null}
  {queue.length?<div className="vehicle-photo-progress"><p role="status">已完成 {queue.filter(x=>x.status==='已完成').length} / {queue.length}</p>{queue.some(item=>item.status!=='已完成')?<ol className="vehicle-media-progress" aria-label="车辆照片上传进度">{queue.map(item=><li key={item.key}>{item.file.name} · {item.status}</li>)}</ol>:null}</div>:null}
  {phase==='retry'||phase==='readback'||phase==='conflict'?<div className="vehicle-media-actions">{phase!=='conflict'?<button type="button" className="button primary" disabled={boundary||!mediaWritable()||busy||r.reading||!gallery||r.failed&&phase!=='readback'} onClick={()=>void run()}>{phase==='readback'?'重新读取结果':'按原请求重试'}</button>:<button className="button" type="button" disabled={busy} onClick={()=>{queueRef.current=[];setQueue([]);setPhase('ready');if(input.current)input.current.value='';}}>放弃剩余上传并重新选择</button>}</div>:null}
 </section>;
}
