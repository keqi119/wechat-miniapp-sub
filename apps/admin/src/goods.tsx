import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Plus,RefreshCw,Search} from 'lucide-react';
import {api,ApiError,money,type Page,type Session} from './core';
import {CommandIdentity} from './domain-commands';
import {useCommandDisabled} from './domain-ui';
import {Drawer,ErrorNotice,Loading} from './ui';
import {ResourceListLayout} from './resource-list-layout';
import {RecordWorkspaceShell} from './record-workspace-shell';
import {listLocationState,syncListLocation,openRecordLocation,closeRecordLocation,rememberListPosition,restoreListPosition,processReturnTarget,returnToProcess} from './process-navigation';
import {goodsAccess,goodsCreatePayload,goodsDisplayPayload,goodsStatusLabel,publishedGoodsVersions,type Goods,type GoodsVehicle,type GoodsVersion} from './goods-model';
import {GoodsBatch} from './goods-batch';
import {GoodsInspectionSelection} from './goods-inspection-selection';
import {SharedVehicleGallery} from './vehicle-media';
import {VehiclePublishReadiness} from './vehicle-publish-readiness';
import {GoodsAppDisplayStatus} from './goods-app-display';
import {GoodsAppPresentation} from './goods-app-presentation';
import './goods.css';

type Mode='create'|'edit'|'publish'|'withdraw';
type DisplayValues={visible:boolean;recommended:boolean;sortOrder:string};
const defaults:DisplayValues={visible:true,recommended:false,sortOrder:'0'};
const vehicleLabel=(vehicle:GoodsVehicle)=>`${vehicle.title} · ${vehicle.plateNumber||'未登记车牌'}`;
const versionLabel=(version:GoodsVersion)=>`${version.name} · 第 ${version.version} 版`;
function GoodsStatus({status}:{status:string}){return <span className={`status ${status==='PUBLISHED'?'success':status==='DRAFT'?'warning':'neutral'}`}>{goodsStatusLabel(status)}</span>;}
type PendingGoodsCommand={path:string;method:'POST'|'PATCH';body:Record<string,unknown>;session:Session|null;vehicleId:string;versionId:string;recordId?:string;status:Goods['status'];committed?:boolean};
function checkedGoodsReceipt(value:unknown,command:PendingGoodsCommand):Goods{
 const row=value as Goods|undefined,integer=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=2147483647,text=(s:unknown)=>typeof s==='string'&&!!s.trim();
 if(!row||!text(row.id)||!integer(row.revision)||row.status!==command.status||command.recordId&&row.id!==command.recordId||row.vehicleId!==command.vehicleId||row.productVersionId!==command.versionId||row.vehicle?.id!==command.vehicleId||!text(row.vehicle.title)||row.productVersion?.id!==command.versionId||!text(row.productVersion.name)||!integer(row.productVersion.version)||!text(row.subscriptionPlanId)||row.plan?.id!==row.subscriptionPlanId||!integer(row.plan.months)||!integer(row.plan.monthlyFeeAmount)||!integer(row.plan.mileagePerMonthKm)||!integer(row.plan.excessMileagePriceAmount)||typeof row.plan.energyDescription!=='string'||typeof row.plan.conditions!=='string'||!Array.isArray(row.plan.benefits)||row.plan.benefits.some(item=>typeof item!=='string')||typeof row.visible!=='boolean'||typeof row.recommended!=='boolean'||!integer(row.sortOrder))throw new ApiError('商品操作回执不完整或来源不一致，请核对原请求结果',0,'INVALID_RESPONSE');
 for(const key of ['visible','recommended','sortOrder'] as const)if(Object.hasOwn(command.body,key)&&row[key]!==command.body[key])throw new ApiError('商品展示设置回执不一致，请核对原请求结果',0,'INVALID_RESPONSE');
 return row;
}
async function readCommittedGoods(command:PendingGoodsCommand):Promise<Goods>{
 const current=()=>{if(api.session!==command.session)throw new ApiError('登录会话已变化，请在当前账号重新核对原记录',0,'SESSION_CHANGED');};current();
 let id=command.recordId;
 if(!id){
  const matches:Goods[]=[],ids=new Set<string>();let total:number|undefined,seen=0;
  for(let page=1;;page++){
   current();const params=new URLSearchParams({vehicleId:command.vehicleId,page:String(page),pageSize:'100'}),next=await api.request<Page<Goods>>('/admin/goods?'+params,{permission:'goods.read'});current();
   if(!Array.isArray(next.items)||next.page!==page||next.pageSize!==100||!Number.isSafeInteger(next.total)||next.total<0||total!==undefined&&next.total!==total)throw new Error('已提交，方案检索结果尚未完整，请重新读取。');total=next.total;
   for(const row of next.items){if(!row.id||ids.has(row.id)||row.vehicleId!==command.vehicleId||row.vehicle?.id!==command.vehicleId)throw new Error('已提交，方案来源尚未核实，请重新读取。');ids.add(row.id);seen++;if(row.productVersionId===command.versionId)matches.push(row);}
   if(seen>total||seen<total&&!next.items.length)throw new Error('已提交，方案分页尚未完整，请重新读取。');if(seen===total)break;
  }
  if(matches.length!==1)throw new Error('原操作已提交，尚未唯一核对到本车和产品版本的方案；请继续读取，不会重复创建。');id=matches[0].id;
 }
 current();const raw=await api.request<Goods>('/admin/goods/'+encodeURIComponent(id),{permission:'goods.read'});current();
 if(!['DRAFT','PUBLISHED','WITHDRAWN'].includes(raw?.status))throw new Error('方案当前状态尚未核实，请重新读取。');
 const expected=Number(command.body.revision)+1;if(command.recordId&&raw.revision<expected)throw new Error('原操作已提交，方案当前版本尚未更新，请重新读取。');
 const later=raw.revision>(command.recordId?expected:0),checked=later?{...command,status:raw.status,body:{revision:command.body.revision}}:command;
 return checkedGoodsReceipt(raw,{...checked,recordId:id});
}

export function GoodsPage(){
 const access=goodsAccess(api.session?.user.role,api.session?.user.permissions||[]);
 return access.read?<GoodsWorkspace access={access}/>:<p>当前账号无权查看商品。</p>;
}
function GoodsWorkspace({access}:{access:ReturnType<typeof goodsAccess>}){
 const userId=api.session?.user.id||'',initial=listLocationState(window.location.hash);
 const [query,setQuery]=useState(initial),[draftKeyword,setDraftKeyword]=useState(initial.keyword),[selected,setSelected]=useState(()=>new URLSearchParams(window.location.hash.split('?')[1]).get('record')||'');
 const [page,setPage]=useState<Page<Goods>>(),[listError,setListError]=useState<unknown>(),[listLoading,setListLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const [record,setRecord]=useState<Goods>(),[detailError,setDetailError]=useState<unknown>(),[detailLoading,setDetailLoading]=useState(false),[detailRefresh,setDetailRefresh]=useState(0);
 const [form,setForm]=useState<Mode>(),[receipt,setReceipt]=useState('');
 const [batch,setBatch]=useState(false),[presentationFrozen,setPresentationFrozen]=useState(false),[formFrozen,setFormFrozen]=useState(false);const detailFrozen=presentationFrozen||formFrozen;
 const active=useRef(selected),alive=useRef(true);active.current=selected;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{const read=()=>{const next=listLocationState(window.location.hash),id=new URLSearchParams(window.location.hash.split('?')[1]).get('record')||'';setQuery(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);setDraftKeyword(next.keyword);if(active.current!==id){active.current=id;setForm(undefined);setReceipt('');}setSelected(id);};window.addEventListener('hashchange',read);window.addEventListener('process-location',read);return()=>{window.removeEventListener('hashchange',read);window.removeEventListener('process-location',read);};},[]);
 useEffect(()=>{const controller=new AbortController();setListLoading(true);setListError(undefined);setPage(undefined);const params=new URLSearchParams({keyword:query.keyword,page:String(query.page),pageSize:'12',...(query.status?{status:query.status}:{})});
  api.request<Page<Goods>>(`/admin/goods?${params}`,{signal:controller.signal,permission:'goods.read'}).then(value=>{if(!controller.signal.aborted)setPage(value);}).catch(error=>{if(!controller.signal.aborted)setListError(error);}).finally(()=>{if(!controller.signal.aborted)setListLoading(false);});return()=>controller.abort();
 },[query,refresh]);
 useEffect(()=>{setRecord(undefined);setDetailError(undefined);setForm(undefined);if(!selected){setDetailLoading(false);return;}const controller=new AbortController();setDetailLoading(true);
  api.request<Goods>(`/admin/goods/${encodeURIComponent(selected)}`,{signal:controller.signal,permission:'goods.read'}).then(value=>{if(!controller.signal.aborted){if(value.id!==selected)throw new Error('返回商品与当前详情不一致');setRecord(value);}}).catch(error=>{if(!controller.signal.aborted)setDetailError(error);}).finally(()=>{if(!controller.signal.aborted)setDetailLoading(false);});return()=>controller.abort();
 },[selected,detailRefresh]);
 useEffect(()=>{if(!selected&&!listLoading)return restoreListPosition(userId);},[selected,listLoading,userId,query]);
 const change=(patch:Partial<typeof query>)=>{rememberListPosition(userId);const next={...query,...patch};setQuery(next);syncListLocation(next);};
 const open=(id:string)=>{rememberListPosition(userId);openRecordLocation(id);};
 const completed=(value:Goods,mode:Mode,target:string)=>{if(!alive.current||active.current!==target)return;const newer=!!record&&value.revision>record.revision+1||mode==='publish'&&value.status!=='PUBLISHED'||mode==='withdraw'&&value.status!=='WITHDRAWN'||mode==='create'&&value.status!=='DRAFT';setForm(undefined);setRefresh(n=>n+1);setReceipt(newer?'原操作已提交，已读取当前方案状态，请以当前标注核对。':mode==='create'?'商品草稿已保存，请核对后明确发布。':mode==='publish'?'产品方案已上架；仍须在车辆商品展示页单独上架对客商品。':mode==='withdraw'?'产品方案已下架，既有订单约定保持。':'展示设置已保存。');if(mode==='create')open(value.id);else {setRecord(value);setDetailError(undefined);}};
 const back=()=>{if(detailFrozen)return;if(processReturnTarget(window.location.hash))returnToProcess(userId);else closeRecordLocation();};
 if(selected)return <RecordWorkspaceShell title="商品详情" subtitle={selected} status={record?<GoodsStatus status={record.status}/>:undefined} onBack={back} actions={<button className="button" disabled={detailLoading||detailFrozen} onClick={()=>setDetailRefresh(n=>n+1)}><RefreshCw size={16}/>刷新详情</button>}>
  {detailError?<ErrorNotice error={detailError}/>:detailLoading||!record||record.id!==selected?<Loading/>:<div className="goods-detail" onClickCapture={event=>{if(detailFrozen&&event.target instanceof Element&&event.target.closest('a[href]'))event.preventDefault();}}>
   {receipt?<p role="status" className="goods-receipt">{receipt}</p>:null}
   <SharedVehicleGallery vehicleId={record.vehicleId}/>
   <fieldset disabled={detailFrozen} className="goods-presentation-boundary"><GoodsInspectionSelection record={record} onUpdated={value=>{setRecord(value);setRefresh(n=>n+1);}}/></fieldset>
   <dl className="goods-facts"><div><dt>车辆</dt><dd>{vehicleLabel(record.vehicle)}</dd></div><div><dt>VIN</dt><dd>{record.vehicle.vin||'—'}</dd></div><div><dt>产品版本</dt><dd>{versionLabel(record.productVersion)}</dd></div><div><dt>商品来源</dt><dd>{record.source==='LEGACY_MIGRATED'?'既有商品':'显式组合'}</dd></div><div><dt>月费</dt><dd>{money(record.plan.monthlyFeeAmount)}</dd></div><div><dt>租期</dt><dd>{record.plan.months} 个月</dd></div><div><dt>每月里程</dt><dd>{record.plan.mileagePerMonthKm} km</dd></div><div><dt>超里程单价</dt><dd>{money(record.plan.excessMileagePriceAmount)} / km</dd></div><div><dt>能源</dt><dd>{record.plan.energyDescription}</dd></div><div><dt>权益</dt><dd>{record.plan.benefits?.join('；')||'按产品约定'}</dd></div><div><dt>展示设置</dt><dd>{record.visible?'允许展示':'设为隐藏'}</dd></div><div><dt>App 展示</dt><dd><GoodsAppDisplayStatus value={record.appDisplay}/></dd></div><div><dt>推荐 / 排序</dt><dd>{record.recommended?'推荐':'不推荐'} / {record.sortOrder}</dd></div></dl><p className="goods-conditions">{record.plan.conditions}</p>
   <GoodsAppPresentation record={record} disabled={!!form} onFrozenChange={setPresentationFrozen} onUpdated={value=>{setRecord(old=>old?{...old,revision:value.listingRevision,vehicle:{...old.vehicle,title:value.materials.title},appDisplay:value.appDisplay as Goods['appDisplay']}:old);setRefresh(n=>n+1);}}/>
   {access.write&&['DRAFT','PUBLISHED','WITHDRAWN'].includes(record.status)?<div className="goods-actions"><button className="button" disabled={detailFrozen} onClick={()=>setForm('edit')}>调整展示</button>{record.status==='PUBLISHED'?<button className="button danger" disabled={detailFrozen} onClick={()=>setForm('withdraw')}>下架产品方案</button>:<button className="button primary" disabled={detailFrozen} onClick={()=>setForm('publish')}>上架产品方案</button>}</div>:null}
   {form&&form!=='create'?<GoodsForm key={`${record.id}:${record.revision}:${form}`} mode={form} record={record} onFrozenChange={setFormFrozen} onClose={()=>setForm(undefined)} onComplete={value=>completed(value,form,selected)}/>:null}
  </div>}
 </RecordWorkspaceShell>;
 return <><ResourceListLayout title="车辆基本套餐" description="配置车辆基本套餐。产品方案上架与商品对客上架分别办理。App 实际状态以展示预览和当前原因核对。" count={page?.total} actions={<>{access.create?<><button className="button primary" onClick={()=>setForm('create')}><Plus size={16}/>新增商品</button><button className="button primary" onClick={()=>setBatch(true)}>批量上架 / 下架产品方案</button></>:null}<button className="button" disabled={listLoading} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={16}/>刷新</button></>} toolbar={<div className="table-toolbar"><form className="search-field" onSubmit={event=>{event.preventDefault();change({keyword:draftKeyword.trim(),page:1});}}><Search size={16}/><input aria-label="搜索商品" placeholder="车辆、产品名称或编号" value={draftKeyword} onChange={event=>setDraftKeyword(event.target.value)}/><button className="search-submit" type="submit" aria-label="执行搜索"><Search size={15}/></button></form><label className="status-filter">商品状态<select aria-label="商品状态" value={query.status} onChange={event=>change({status:event.target.value,page:1})}><option value="">全部</option>{['DRAFT','PUBLISHED','WITHDRAWN'].map(status=><option key={status} value={status}>{goodsStatusLabel(status)}</option>)}</select></label></div>} pagination={<div className="table-pagination"><span>共 {page?.total??'—'} 条 / 每页 12 条</span><div><button className="button" disabled={query.page===1||listLoading} onClick={()=>change({page:query.page-1})}>上一页</button><span>{query.page}</span><button className="button" disabled={!page||query.page*12>=page.total||listLoading} onClick={()=>change({page:query.page+1})}>下一页</button></div></div>}>
  {listLoading?<Loading/>:listError?<ErrorNotice error={listError} retry={()=>setRefresh(n=>n+1)}/>:page?.items.length?<div className="table-scroll"><table><thead><tr>{['车辆','产品版本','月费','每月里程','产品方案上架','展示设置','App 展示','操作'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{page.items.map(item=><tr key={item.id}><td><button className="row-link" onClick={()=>open(item.id)}>{item.vehicle.title}</button><small className="goods-secondary">{item.vehicle.plateNumber||'未登记车牌'}</small></td><td>{versionLabel(item.productVersion)}{item.source==='LEGACY_MIGRATED'?<small className="goods-secondary">既有商品</small>:null}</td><td>{money(item.plan.monthlyFeeAmount)}</td><td>{item.plan.mileagePerMonthKm} km</td><td><GoodsStatus status={item.status}/></td><td>{item.visible?'允许展示':'设为隐藏'}{item.recommended?' · 推荐':''}</td><td><GoodsAppDisplayStatus value={item.appDisplay}/></td><td><button className="text-button" onClick={()=>open(item.id)}>详情</button>{api.session?.user.permissions.some(permission=>permission==='*'||permission==='vehicles.read')?<a className="text-button" href={`#vehicles?${new URLSearchParams({record:item.vehicleId,view:'listing'})}`}>按车管理</a>:null}</td></tr>)}</tbody></table></div>:<div className="module-empty"><h2>{query.keyword||query.status?'未找到符合条件的商品':'暂无商品'}</h2><p>选择车辆与已发布产品版本，保存并核对商品草稿。</p></div>}
 </ResourceListLayout>{form==='create'?<GoodsForm mode="create" onFrozenChange={setFormFrozen} onClose={()=>setForm(undefined)} onComplete={value=>completed(value,'create','')}/>:null}{batch?<GoodsBatch onClose={()=>setBatch(false)} onDone={()=>setRefresh(n=>n+1)}/>:null}</>;
}

export function GoodsForm({mode,record,fixedVehicleId,onClose,onComplete,onFrozenChange}:{mode:Mode;record?:Goods;fixedVehicleId?:string;onClose:()=>void;onComplete:(value:Goods)=>void;onFrozenChange?:(value:boolean)=>void}){
 const boundaryDisabled=useCommandDisabled();
 const[publicationReady,setPublicationReady]=useState(false);
 const [values,setValues]=useState<DisplayValues>(record?{visible:record.visible,recommended:record.recommended,sortOrder:String(record.sortOrder)}:defaults),[vehicleId,setVehicleId]=useState(fixedVehicleId||''),[versionId,setVersionId]=useState(''),[reason,setReason]=useState('');
 const [vehicles,setVehicles]=useState<GoodsVehicle[]>([]),[versions,setVersions]=useState<GoodsVersion[]>([]),[choicesLoading,setChoicesLoading]=useState(mode==='create'),[choiceError,setChoiceError]=useState<unknown>(),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false),[conflicted,setConflicted]=useState(false),[unknown,setUnknown]=useState(false),[readback,setReadback]=useState(false);
 const requiresPublication=record?.vehicle.catalogPublished===true&&(mode==='publish'&&record.visible||mode==='edit'&&record.status==='PUBLISHED'&&!record.visible&&values.visible);
 const identity=useRef(new CommandIdentity()),pending=useRef<PendingGoodsCommand|null>(null),inflight=useRef(false),alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const freezeCallback=useRef(onFrozenChange);freezeCallback.current=onFrozenChange;useEffect(()=>{freezeCallback.current?.(busy||unknown||readback);},[busy,unknown,readback]);useEffect(()=>()=>freezeCallback.current?.(false),[]);
 useEffect(()=>{if(mode!=='create')return;const controller=new AbortController();
  async function all<T>(path:string,permission:string):Promise<T[]>{const rows:T[]=[];for(let page=1;;page++){const result=await api.request<Page<T>>(`${path}?page=${page}&pageSize=100`,{signal:controller.signal,permission});if(controller.signal.aborted)return[];rows.push(...result.items);if(!Array.isArray(result.items)||!Number.isSafeInteger(result.total)||result.total<rows.length)throw new Error('候选数据不完整，请重新读取');if(rows.length===result.total)return rows;if(!result.items.length)throw new Error('候选分页不完整，请重新读取');}}
  Promise.all([fixedVehicleId?api.request<GoodsVehicle>(`/admin/vehicles/${encodeURIComponent(fixedVehicleId)}`,{signal:controller.signal,permission:'vehicles.read'}).then(vehicle=>{if(vehicle.id!==fixedVehicleId)throw new Error('返回车辆与当前车辆不一致');return[vehicle];}):all<GoodsVehicle>('/admin/vehicles','vehicles.read'),all<{id:string;versions:GoodsVersion[]}>('/admin/products','products.read')]).then(([cars,products])=>{if(!controller.signal.aborted){setVehicles(cars);setVersions(publishedGoodsVersions(products));}}).catch(error=>{if(!controller.signal.aborted)setChoiceError(error);}).finally(()=>{if(!controller.signal.aborted)setChoicesLoading(false);});return()=>controller.abort();
 },[mode,fixedVehicleId]);
 const submit=async(event:FormEvent)=>{event.preventDefault();if(inflight.current||conflicted||boundaryDisabled&&!pending.current||requiresPublication&&!pending.current&&!publicationReady)return;inflight.current=true;setBusy(true);setError(undefined);
  try{
   if(!pending.current){
    const path=mode==='create'?'/admin/goods':`/admin/goods/${encodeURIComponent(record!.id)}${mode==='edit'?'':'/'+mode}`;
    if(mode==='create'&&!vehicles.some(vehicle=>vehicle.id===vehicleId))throw new Error('请选择当前可读取的车辆');
    const body=mode==='create'?goodsCreatePayload({...values,vehicleId,productVersionId:versionId},versions):{revision:record!.revision,...(mode==='edit'?goodsDisplayPayload(values):reason.trim()?{reason:reason.trim()}:{})};
    pending.current={path,method:mode==='edit'?'PATCH':'POST',body:Object.freeze({...body,idempotencyKey:identity.current.for(path,body)}),session:api.session,vehicleId:mode==='create'?vehicleId:record!.vehicleId,versionId:mode==='create'?versionId:record!.productVersionId,recordId:record?.id,status:mode==='create'?'DRAFT':mode==='publish'?'PUBLISHED':mode==='withdraw'?'WITHDRAWN':record!.status};
   }
   const command=pending.current;
   if(api.session!==command.session)throw new ApiError('登录会话已变化，请在当前账号重新核对原记录',0,'SESSION_CHANGED');
   let value:Goods;if(command.committed)value=await readCommittedGoods(command);else{let raw:unknown;try{raw=await api.request<unknown>(command.path,{method:command.method,permission:'goods.write',body:command.body});command.committed=true;}catch(e){if(e instanceof ApiError&&e.code==='INVALID_RESPONSE'&&e.status>=200&&e.status<300)command.committed=true;throw e;}value=checkedGoodsReceipt(raw,command);}
   if(alive.current&&api.session===command.session){pending.current=null;setUnknown(false);setReadback(false);onComplete(value);}
  }catch(error){if(alive.current){setError(error);if(error instanceof ApiError&&(error.code==='SESSION_CHANGED'||[401,403].includes(error.status))){pending.current=null;setUnknown(false);setReadback(false);setConflicted(true);}else if(pending.current?.committed){setUnknown(false);setReadback(true);}else if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.code!=='INVALID_RESPONSE'){pending.current=null;setUnknown(false);setReadback(false);if(error.status===409)setConflicted(true);}else setUnknown(!!pending.current);}}
  finally{inflight.current=false;if(alive.current)setBusy(false);}
 };
 const locked=busy||unknown||readback,close=()=>{if(!inflight.current&&!pending.current)onClose();};
 const title={create:fixedVehicleId?'新增产品卡槽':'新增商品',edit:'调整展示',publish:'上架产品方案',withdraw:'下架产品方案'}[mode],submitLabel={create:'保存草稿',edit:'保存展示设置',publish:'确认上架产品方案',withdraw:'确认下架产品方案'}[mode];
 const form=<form className="goods-form" onSubmit={submit}>
  {requiresPublication&&record?<VehiclePublishReadiness vehicleId={record.vehicleId} goodsId={record.id} goodsRevision={record.revision} onReady={ready=>{if(alive.current)setPublicationReady(ready);}}/>:null}
  {mode==='create'?choicesLoading?<Loading label="读取车辆与产品版本"/>:choiceError?<ErrorNotice error={choiceError}/>:<>{fixedVehicleId?<p className="goods-form-note">车辆：{vehicles[0]?vehicleLabel(vehicles[0]):fixedVehicleId}</p>:<label>车辆<select aria-label="车辆" required disabled={locked} value={vehicleId} onChange={event=>setVehicleId(event.target.value)}><option value="">请选择车辆</option>{vehicles.map(vehicle=><option key={vehicle.id} value={vehicle.id}>{vehicleLabel(vehicle)}</option>)}</select></label>}<label>产品版本<select aria-label="产品版本" required disabled={locked} value={versionId} onChange={event=>setVersionId(event.target.value)}><option value="">请选择已发布版本</option>{versions.map(version=><option key={version.id} value={version.id}>{versionLabel(version)}</option>)}</select></label><p className="goods-form-note">创建后为草稿，不会自动上架。月费与权益按选定产品版本生成。</p></>:null}
  {mode==='create'||mode==='edit'?<><div className="goods-checks"><label><input type="checkbox" disabled={locked} checked={values.visible} onChange={event=>setValues({...values,visible:event.target.checked})}/>允许在 App 展示（需对客商品已上架）</label><label><input type="checkbox" disabled={locked} checked={values.recommended} onChange={event=>setValues({...values,recommended:event.target.checked})}/>推荐产品方案</label></div><label>排序值<input type="number" min="0" max="2147483647" step="1" required disabled={locked} value={values.sortOrder} onChange={event=>setValues({...values,sortOrder:event.target.value})}/></label></>:<><p>{mode==='publish'?`上架产品方案 ${record?vehicleLabel(record.vehicle):''} / ${record?versionLabel(record.productVersion):''}。${record?.visible?'仅上架本产品方案，对客商品仍须在车辆商品展示页顶部单独上架。':'当前方案设置为隐藏，上架方案后仍不对客展示。'}`:'下架后停止新申请，既有订单继续使用已确认的条款。'}</p><label>操作说明<textarea maxLength={500} disabled={locked} value={reason} onChange={event=>setReason(event.target.value)}/></label></>}
  {error?<ErrorNotice error={error}/>:null}{unknown?<p role="status">操作结果尚未确认，请保留本表单并重试原请求，不要重复新建。</p>:readback?<p role="status">原操作已提交，仅通过读取核对结果，不会重复提交。</p>:null}{conflicted?<p role="status">请关闭本表单并刷新详情，核对最新商品后重新操作。</p>:null}<div className="goods-actions"><button className="button" type="button" disabled={locked} onClick={close}>取消</button><button className="button primary" disabled={busy||conflicted||!unknown&&!readback&&(boundaryDisabled||choicesLoading||!!choiceError||requiresPublication&&!publicationReady)}>{busy?'正在保存…':readback?'重新读取方案结果':unknown?'重试原请求':submitLabel}</button></div>
 </form>;
 return mode==='create'?<Drawer title={title} onClose={close}>{form}</Drawer>:<section className="goods-command" aria-label={title}><h2>{title}</h2>{form}</section>;
}
