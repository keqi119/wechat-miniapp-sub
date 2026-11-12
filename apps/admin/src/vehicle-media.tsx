import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {api,ApiError,can} from './core';
import './vehicle-media.css';

export type MediaProps={vehicleId:string;refreshKey?:number;onUpdated?:()=>void;onFrozenChange?:(frozen:boolean)=>void};
export type MediaFile={id:string;name:string;mimeType:string;size:number;sha256:string;url:string};
export type Gallery={vehicleId:string;vehicleRevision:number;coverFileId:string|null;mediaFileIds:string[];items:MediaFile[]};
export type Inspection={id:string;vehicleId:string;revision:number;title:string;provider:string|null;inspectedAt:string|null;description:string;imageFileIds:string[];images:MediaFile[]};
export type InspectionList={vehicleId:string;items:Inspection[]};
export const mediaError=(e:unknown)=>e instanceof Error?e.message:'操作失败，请稍后重试';
export const mediaPath=(vehicleId:string)=>'/admin/vehicles/'+encodeURIComponent(vehicleId);
export const mediaOperator=()=>['ADMIN','OPERATIONS'].includes(api.session?.user.role||'');
export const mediaWritable=(permission='vehicles.write')=>mediaOperator()&&can(api.session?.user.permissions||[],permission);
export const accessFailure=(e:unknown)=>e instanceof ApiError&&(e.status===401||e.status===403||e.code==='SESSION_CHANGED');
export const definiteFailure=(e:unknown)=>e instanceof ApiError&&e.status>=400&&e.status<500&&e.code!=='INVALID_RESPONSE';
export function checkImage(file:File){if(!['image/png','image/jpeg'].includes(file.type)||file.size===0||file.size>10*1024*1024)throw new Error('请选择非空的 JPEG / PNG 图片，每张最多 10 MiB。');}
export function checkGallery(value:Gallery,vehicleId:string){
 if(value?.vehicleId!==vehicleId||!Number.isSafeInteger(value.vehicleRevision)||value.vehicleRevision<0||!Array.isArray(value.items)||!Array.isArray(value.mediaFileIds)||value.mediaFileIds.length>20||new Set(value.mediaFileIds).size!==value.mediaFileIds.length||value.mediaFileIds.some(id=>!value.items.some(file=>file.id===id))||value.coverFileId&&!value.items.some(file=>file.id===value.coverFileId))throw new ApiError('照片回执与当前车辆不一致，请核对结果',0,'INVALID_RESPONSE');return value;
}
export function checkInspections(value:InspectionList,vehicleId:string){if(value?.vehicleId!==vehicleId||!Array.isArray(value.items)||value.items.some(x=>x.vehicleId!==vehicleId||!x.id||!Number.isSafeInteger(x.revision)||!Array.isArray(x.images)||!Array.isArray(x.imageFileIds)))throw new ApiError('查验资料与当前车辆不一致',0,'INVALID_RESPONSE');return value;}
/** Remount sensitive state even when staff permissions change without changing the ID. */
export function MediaScope({vehicleId,privateLabel,children}:{vehicleId:string;privateLabel?:string;children:ReactNode}){
 const session=api.session,signature=JSON.stringify([session?.user.id,session?.user.role,session?.user.permissions]),scope=useRef({session,signature,epoch:0});
 if(scope.current.session!==session||scope.current.signature!==signature)scope.current={session,signature,epoch:scope.current.epoch+1};
 if(privateLabel&&!mediaOperator())return <p>当前岗位无权查看{privateLabel}。</p>;
 return <div key={`${vehicleId}:${scope.current.epoch}`}>{children}</div>;
}
export function useMediaResource<T>(path:string,check:(value:T)=>T,refreshKey=0){
 const[data,setData]=useState<T>(),[reading,setReading]=useState(true),[error,setError]=useState<unknown>(),[failed,setFailed]=useState(false),[denied,setDenied]=useState(false);
 const session=useRef(api.session),controller=useRef(new AbortController()),alive=useRef(false),sequence=useRef(0),checker=useRef(check);checker.current=check;
 const current=useCallback(()=>alive.current&&session.current===api.session&&!controller.current.signal.aborted,[]);
 const failure=useCallback((e:unknown)=>{if(!alive.current)return;if(accessFailure(e)){setData(undefined);setDenied(true);controller.current.abort();}setError(e);setFailed(true);},[]);
 const load=useCallback(async()=>{const seq=++sequence.current;setReading(true);try{const result=checker.current(await api.request<T>(path,{signal:controller.current.signal}));if(!current()||seq!==sequence.current)throw new Error('本次读取已失效');setData(result);setFailed(false);setError(undefined);return result;}catch(e){if(seq===sequence.current&&(current()||accessFailure(e)))failure(e);throw e;}finally{if(current()&&seq===sequence.current)setReading(false);}},[path,current,failure]);
 useEffect(()=>{alive.current=true;controller.current=new AbortController();void load().catch(()=>{});return()=>{alive.current=false;sequence.current++;controller.current.abort();};},[load,refreshKey]);
 return{data,setData,reading,error,setError,failed,denied,load,current,failure,controller};
}
export function PrivateImage({vehicleId,file,kind,onError}:{vehicleId:string;file:MediaFile;kind:'photos'|'inspection-files';onError?:(e:unknown)=>void}){
 const[url,setUrl]=useState(''),[error,setError]=useState(''),[open,setOpen]=useState(false),[retry,setRetry]=useState(0),callback=useRef(onError);callback.current=onError;
 useEffect(()=>{const controller=new AbortController(),session=api.session;let url='';setUrl('');setError('');setOpen(false);
  void(async()=>{const path=file.url.replace(/^\/api(?=\/)/,'');const allowed=[mediaPath(vehicleId)+'/'+kind+'/'+encodeURIComponent(file.id)];if(kind==='photos')allowed.push('/admin/files/'+encodeURIComponent(file.id));if(!allowed.includes(path)||!['image/jpeg','image/png'].includes(file.mimeType))throw new Error('图片预览地址或格式不匹配');const blob=await api.readPrivateFile(path,file.mimeType,controller.signal);if(controller.signal.aborted||session!==api.session)return;url=URL.createObjectURL(blob);setUrl(url);})().catch(e=>{if(!controller.signal.aborted){if(accessFailure(e))callback.current?.(e);if(session===api.session)setError(mediaError(e));}});
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 },[vehicleId,file.id,file.url,file.mimeType,retry]);
 return <div className="vehicle-media-image">{url?<button type="button" className="vehicle-media-thumbnail" aria-label={'查看原图 '+file.name} onClick={()=>setOpen(true)}><img src={url} alt={file.name}/></button>:error?<button type="button" className="button" onClick={()=>setRetry(x=>x+1)}>重试预览 {file.name}</button>:<span>加载图片…</span>}{error?<small role="alert">{error}</small>:null}{open&&url?<div className="vehicle-media-lightbox" role="dialog" aria-label={'原图 '+file.name} aria-modal="true" onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}><button autoFocus type="button" className="button" onClick={()=>setOpen(false)}>关闭原图</button><img src={url} alt={file.name}/></div>:null}</div>;
}
export function SharedVehicleGallery({vehicleId}:{vehicleId:string}){return <MediaScope vehicleId={vehicleId}><SharedGalleryBody vehicleId={vehicleId}/></MediaScope>;}
function SharedGalleryBody({vehicleId}:{vehicleId:string}){
 const resource=useMediaResource<Gallery>(mediaPath(vehicleId)+'/photos',value=>checkGallery(value,vehicleId));
 return <aside className="vehicle-media-shared"><a href={`#vehicles?${new URLSearchParams({record:vehicleId,view:'photos'})}`}>查看共用车辆照片</a><span>{resource.data?`${resource.data.mediaFileIds.length} 张照片 · 同车商品共用相册与封面`:'同车商品共用相册与封面'}</span>{resource.error?<small role="alert">{mediaError(resource.error)}</small>:null}{resource.data?.items.find(file=>file.id===resource.data?.coverFileId)?<PrivateImage vehicleId={vehicleId} kind="photos" file={resource.data.items.find(file=>file.id===resource.data?.coverFileId)!} onError={resource.failure}/>:null}</aside>;
}
