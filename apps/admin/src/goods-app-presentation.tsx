import {useCallback,useEffect,useRef,useState} from 'react';
import {api,ApiError,can,money} from './core';
import {goodsAccess,type Goods} from './goods-model';
import {GoodsAppDisplayStatus} from './goods-app-display';
import {VehiclePhotos} from './vehicle-photos';
import {PrivateImage,accessFailure,definiteFailure,mediaError,checkGallery,type Gallery} from './vehicle-media';
import './goods-app-presentation.css';

type Materials={title:string;description:string;conditionDisclosure:string};
type PublicPlan={id:string;listingId:string;productVersionId:string;title:string;monthlyFeeAmount:number;monthlyFeeText:string;termMonths:number;mileageText:string;energyText:string;notes:string;excessMileagePriceAmount:number;depositText:string;benefits:string[];benefitDetails:{benefitVersionId:string;name:string;description:string;provider:string;conditions:string;totalQuantity?:number;unit?:string}[];inspections?:{id:string;title:string;description:string;images:string[]}[];available:boolean};
export type GoodsAppPreview={listingId:string;listingRevision:number;vehicleId:string;vehicleRevision:number;mode:'LIVE'|'DRAFT_PREVIEW';appDisplay:unknown;materials:Materials;vehicle:{id:string;name:string;brand:string;city:string;tagline:string;registrationText:string;mileageText:string;bodyType:string;rangeText:string;statusText:string;available:boolean;coverFileId:string|null;mediaFileIds:string[]};selectedPlan:PublicPlan;report:{summary:string;items:{label:string;value:string}[];notice:string}};
type Receipt={listingId:string;listingRevision:number;vehicleId:string;vehicleRevision:number;materials:Materials};
const integer=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
function checkPreview(raw:GoodsAppPreview,record:Goods){
 if(raw?.listingId!==record.id||raw.vehicleId!==record.vehicleId||raw.vehicle?.id!==record.vehicleId||!integer(raw.listingRevision)||!integer(raw.vehicleRevision)||raw.selectedPlan?.id!==record.subscriptionPlanId||raw.selectedPlan.listingId!==record.id||raw.selectedPlan.productVersionId!==record.productVersionId||!integer(raw.selectedPlan.monthlyFeeAmount)||!integer(raw.selectedPlan.excessMileagePriceAmount)||!['LIVE','DRAFT_PREVIEW'].includes(raw.mode)||!raw.materials||Object.values(raw.materials).some(v=>typeof v!=='string')||!Array.isArray(raw.vehicle.mediaFileIds)||!Array.isArray(raw.report?.items)||!Array.isArray(raw.selectedPlan.benefits)||!Array.isArray(raw.selectedPlan.benefitDetails)||raw.mode==='DRAFT_PREVIEW'&&(raw.vehicle.available||raw.selectedPlan.available))throw new ApiError('展示预览与当前车辆、商品或产品版本不一致',0,'INVALID_RESPONSE');
 return raw;
}
export function GoodsAppPresentation({record,disabled=false,inline=false,onFrozenChange,onUpdated}:{record:Goods;disabled?:boolean;inline?:boolean;onFrozenChange?:(value:boolean)=>void;onUpdated?:(value:GoodsAppPreview)=>void}){
 const [epoch,setEpoch]=useState(0);useEffect(()=>{const changed=()=>setEpoch(n=>n+1);window.addEventListener('admin-session-change',changed);return()=>window.removeEventListener('admin-session-change',changed);},[]);
 const access=goodsAccess(api.session?.user.role,api.session?.user.permissions||[]);
 return access.read?<PresentationBody key={`${record.id}:${epoch}`} record={record} disabled={disabled} inline={inline} onFrozenChange={onFrozenChange} onUpdated={onUpdated}/>:null;
}
function PresentationBody({record,disabled,inline,onFrozenChange,onUpdated}:{record:Goods;disabled:boolean;inline:boolean;onFrozenChange?: (value:boolean)=>void;onUpdated?:(value:GoodsAppPreview)=>void}){
 const [open,setOpen]=useState<'preview'|'editor'|undefined>(inline?'preview':undefined),[data,setData]=useState<GoodsAppPreview>(),[values,setValues]=useState<Materials>({title:'',description:'',conditionDisclosure:''}),[reading,setReading]=useState(false),[error,setError]=useState<unknown>(),[notice,setNotice]=useState(''),[phase,setPhase]=useState<'idle'|'sending'|'unknown'|'readback'>('idle'),[photoFrozen,setPhotoFrozen]=useState(false),[photosVisited,setPhotosVisited]=useState(false),[denied,setDenied]=useState(false);
 const alive=useRef(true),session=useRef(api.session),controller=useRef(new AbortController()),sequence=useRef(0),inflight=useRef(false),pending=useRef<{body:Readonly<Record<string,unknown>>;receipt?:Receipt;committed?:boolean}|undefined>(undefined),callback=useRef(onFrozenChange);callback.current=onFrozenChange;
 const frozen=phase!=='idle'||photoFrozen,canEdit=goodsAccess(api.session?.user.role,api.session?.user.permissions||[]).write&&can(api.session?.user.permissions||[],'vehicles.write'),canPhotos=can(api.session?.user.permissions||[],'vehicles.read');
 const current=()=>alive.current&&api.session===session.current&&!controller.current.signal.aborted;
 useEffect(()=>{alive.current=true;controller.current=new AbortController();return()=>{alive.current=false;sequence.current++;controller.current.abort();callback.current?.(false);};},[]);
 useEffect(()=>{callback.current?.(frozen);},[frozen]);
 const load=async(reset=true)=>{
  const seq=++sequence.current;setReading(true);
  try{const result=checkPreview(await api.request<GoodsAppPreview>(`/admin/goods/${encodeURIComponent(record.id)}/app-preview`,{signal:controller.current.signal,permission:'goods.read'}),record);if(!current()||seq!==sequence.current)return;
   setData(result);if(reset)setValues(result.materials);setError(undefined);return result;
  }catch(e){if(current()&&seq===sequence.current){setError(e);if(accessFailure(e)){setDenied(true);setData(undefined);pending.current=undefined;setPhase('idle');}}throw e;}
  finally{if(current()&&seq===sequence.current)setReading(false);}
 };
 useEffect(()=>{if(inline&&!frozen){setOpen('preview');void load().catch(()=>{});}},[inline,record.id,record.revision]);
 const show=(mode:'preview'|'editor')=>{if(frozen||disabled)return;setOpen(mode);setNotice('');if(mode==='editor')setPhotosVisited(true);void load().catch(()=>{});};
 const save=async()=>{
  if(inflight.current||!current()||!canEdit||disabled||denied||photoFrozen||!data)return;
  inflight.current=true;setError(undefined);setNotice('');
  try{
   if(!pending.current){if(!values.title.trim())throw new Error('请填写商品展示标题');pending.current={body:Object.freeze({...values,title:values.title.trim(),revision:data.listingRevision,vehicleRevision:data.vehicleRevision,idempotencyKey:crypto.randomUUID()})};}
   const attempt=pending.current;setPhase(attempt.committed?'readback':'sending');
   if(!attempt.committed){
    let result:Receipt;try{result=await api.request<Receipt>(`/admin/goods/${encodeURIComponent(record.id)}/presentation`,{method:'PATCH',body:attempt.body,signal:controller.current.signal,permission:'goods.write'});attempt.committed=true;}catch(e){if(e instanceof ApiError&&e.code==='INVALID_RESPONSE'&&e.status>=200&&e.status<300)attempt.committed=true;throw e;}if(!current())return;
    if(result?.listingId!==record.id||result.vehicleId!==record.vehicleId||result.listingRevision!==Number(attempt.body.revision)+1||result.vehicleRevision!==Number(attempt.body.vehicleRevision)+1||!result.materials||(['title','description','conditionDisclosure'] as const).some(k=>result.materials[k]!==attempt.body[k]))throw new ApiError('展示资料回执不完整，请核对原请求',0,'INVALID_RESPONSE');
    attempt.receipt=result;
   }
   setPhase('readback');const result=await load();if(!current()||!result)return;
   if(result.listingRevision<(attempt.receipt?.listingRevision??Number(attempt.body.revision)+1)||result.vehicleRevision<(attempt.receipt?.vehicleRevision??Number(attempt.body.vehicleRevision)+1))throw new Error('已保存，最新展示资料尚未确认，请重新读取。');
   pending.current=undefined;setPhase('idle');setNotice('展示资料已保存。');onUpdated?.(result);
  }catch(e){if(!current())return;setError(e);if(accessFailure(e)){pending.current=undefined;setPhase('idle');setDenied(true);setData(undefined);}else if(pending.current?.committed)setPhase('readback');else if(definiteFailure(e)){pending.current=undefined;setPhase('idle');if(e instanceof ApiError&&e.status===409)await load(false).catch(()=>{});}else if(pending.current)setPhase('unknown');}
  finally{inflight.current=false;}
 };
 const photosUpdated=useCallback(()=>{void load(false).then(value=>{if(value)onUpdated?.(value);}).catch(()=>{});},[record.id]);
 if(denied)return <p role="alert">展示资料访问权限已失效，请重新核对登录权限。</p>;
 return <section className={'goods-app-presentation'+(inline?' goods-app-presentation-inline':'')} aria-label={inline?'App商品预览':undefined}>
  <div className="goods-actions">{inline?<h2>App商品预览</h2>:null}<button className="button" disabled={disabled||frozen||reading} onClick={()=>show('preview')}>{inline?'刷新预览':'App展示预览'}</button>{canEdit?<button className="button" disabled={disabled||frozen||reading} onClick={()=>show('editor')}>编辑展示资料</button>:null}</div>
  {open?<section className="goods-presentation-panel" aria-label={open==='preview'?'App展示预览':'编辑展示资料'}><header><h3>{open==='preview'?'App展示预览':'编辑展示资料'}</h3><button className="text-button" disabled={frozen||reading} onClick={()=>setOpen(undefined)}>收起</button></header>
   {error?<p role="alert">{mediaError(error)}</p>:null}{notice?<p role="status">{notice}</p>:null}{reading?<p role="status">正在核对展示资料…</p>:null}
   {!data&&!reading?<button className="button" onClick={()=>void load().catch(()=>{})}>重新读取展示预览</button>:null}
   {data&&open==='preview'?<><p className="goods-presentation-note">{data.mode==='LIVE'?'以下内容来自小程序当前读取的公开数据。':'未对客开放：以下为当前商品资料预览，不代表商品已对客上架或可以申请。'}</p><GoodsAppDisplayStatus value={data.appDisplay}/><div className="goods-preview-columns"><div className="goods-preview-vehicle"><h3>{data.vehicle.name}</h3><small>{data.vehicle.brand} · {data.vehicle.city}</small><p>{data.vehicle.tagline||'暂无车辆介绍'}</p>{canPhotos?<PreviewPhotos vehicleId={record.vehicleId} coverFileId={data.vehicle.coverFileId} mediaFileIds={data.vehicle.mediaFileIds}/>:<p>当前账号无权查看车辆照片。</p>}<dl><div><dt>上牌时间</dt><dd>{data.vehicle.registrationText}</dd></div><div><dt>表显里程</dt><dd>{data.vehicle.mileageText}</dd></div><div><dt>车身形式</dt><dd>{data.vehicle.bodyType||'未提供'}</dd></div></dl><h4>{data.report.summary}</h4>{data.report.items.map((r,i)=><p key={i}><span>{r.label}：</span>{r.value||'未提供'}</p>)}<small>{data.report.notice}</small></div><div className="goods-preview-plan"><h3>{data.selectedPlan.title}</h3><strong className="goods-preview-price">{data.selectedPlan.monthlyFeeText}<small> / 月</small></strong><p>{data.selectedPlan.termMonths} 个月 · {data.selectedPlan.mileageText}</p><dl><div><dt>超里程</dt><dd>{money(data.selectedPlan.excessMileagePriceAmount)} / km</dd></div><div><dt>能源说明</dt><dd>{data.selectedPlan.energyText}</dd></div><div><dt>押金</dt><dd>{data.selectedPlan.depositText}</dd></div></dl>{data.selectedPlan.benefitDetails.length?data.selectedPlan.benefitDetails.map(b=><p key={b.benefitVersionId}><strong>{b.name}</strong> {b.description}<small>提供方：{b.provider} · {b.conditions}</small></p>):data.selectedPlan.benefits.map((b,i)=><p key={i}>{b}</p>)}<h4>费用与使用条件</h4><p className="goods-preview-terms">{data.selectedPlan.notes}</p>{data.selectedPlan.inspections?.map(i=><div key={i.id}><h4>{i.title}</h4><p>{i.description}</p></div>)}<p className="goods-presentation-note">套餐价格与条款来自已发布产品版本，在此只读。提交的是订阅意向申请，最终交付以确认方案及合同为准。</p></div></div></>:null}
   {data&&open==='editor'?<><p className="goods-presentation-note">车辆介绍、车况披露、相册与封面由本车所有商品共享。此处保存不会上架产品方案或对客商品，套餐价格与条款保持产品版本约定。</p><form onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={disabled||frozen||reading||!canEdit}><label>商品展示标题<input value={values.title} maxLength={500} onChange={e=>setValues({...values,title:e.target.value})}/></label><div className="goods-presentation-texts"><label>车辆介绍<textarea aria-label="车辆介绍" value={values.description} maxLength={5000} rows={4} onChange={e=>setValues({...values,description:e.target.value})}/></label><label>车况披露<textarea aria-label="车况披露" value={values.conditionDisclosure} maxLength={10000} rows={4} onChange={e=>setValues({...values,conditionDisclosure:e.target.value})}/></label></div></fieldset><div className="goods-actions"><button className="button primary" disabled={disabled||reading||phase==='sending'||photoFrozen||!canEdit}>{phase==='unknown'?'重试原展示请求':phase==='readback'?'重新读取展示资料':phase==='sending'?'正在保存…':'保存展示资料'}</button>{phase==='unknown'?<span>结果待确认，重试保持原内容与请求标识。</span>:phase==='readback'?<span>已保存，仅重新读取结果。</span>:null}</div></form></>:null}
   {photosVisited?<fieldset className="goods-presentation-boundary" disabled={phase!=='idle'} hidden={open!=='editor'}><VehiclePhotos vehicleId={record.vehicleId} onUpdated={photosUpdated} onFrozenChange={setPhotoFrozen}/></fieldset>:null}
  </section>:null}
 </section>;
}
function PreviewPhotos({vehicleId,coverFileId,mediaFileIds}:{vehicleId:string;coverFileId:string|null;mediaFileIds:string[]}){
 const [gallery,setGallery]=useState<Gallery>(),[error,setError]=useState<unknown>();
 useEffect(()=>{const controller=new AbortController();api.request<Gallery>(`/admin/vehicles/${encodeURIComponent(vehicleId)}/photos`,{signal:controller.signal,permission:'vehicles.read'}).then(value=>{if(!controller.signal.aborted)setGallery(checkGallery(value,vehicleId));}).catch(e=>{if(!controller.signal.aborted)setError(e);});return()=>controller.abort();},[vehicleId]);
 const ids=[...new Set([...(coverFileId?[coverFileId]:[]),...mediaFileIds])];
 return <div className="goods-preview-photos">{error?<p role="alert">{mediaError(error)}</p>:null}{!ids.length?<p>车辆图片待补充</p>:ids.map(id=>{const file=gallery?.items.find(f=>f.id===id);return file?<div key={id}><PrivateImage vehicleId={vehicleId} kind="photos" file={file}/><small>{id===coverFileId?'商品封面':file.name}</small></div>:<span key={id}>照片读取中…</span>;})}</div>;
}
