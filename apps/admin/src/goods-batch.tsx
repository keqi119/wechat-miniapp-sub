import {useEffect,useRef,useState} from 'react';
import {api,ApiError,type Page} from './core';
import {Drawer,ErrorNotice,Loading} from './ui';
import {goodsStatusLabel,publishedGoodsVersions,type Goods,type GoodsVehicle,type GoodsVersion} from './goods-model';
import {applicableVehicles,batchAction} from './goods-batch-model';

type Vehicle=GoodsVehicle&{modelDefinitionId?:string|null};
type Version=GoodsVersion&{vehicleIds:string[];modelDefinitionIds:string[]};
type Pending={path:string;body:Record<string,unknown>;vehicleId:string;expected:'DRAFT'|'PUBLISHED'|'WITHDRAWN';recordId?:string};
type Row={vehicle:Vehicle;goods?:Goods;result?:string};

async function all<T extends {id:string}>(path:string,permission:string,signal:AbortSignal):Promise<T[]>{
 const rows:T[]=[],ids=new Set<string>();let total:number|undefined;
 for(let page=1;page<=10000;page++){
  const q=new URLSearchParams({page:String(page),pageSize:'100'}),value=await api.request<Page<T>>(`${path}?${q}`,{permission,signal});
  if(!Array.isArray(value.items)||!Number.isSafeInteger(value.total)||value.total<0||total!==undefined&&total!==value.total)throw new Error('分页数据发生变化，请重新读取');
  total=value.total;for(const row of value.items){if(!row.id||ids.has(row.id))throw new Error('分页数据不完整或重复，请重新读取');ids.add(row.id);rows.push(row);}
  if(rows.length===total)return rows;if(rows.length>total||!value.items.length)throw new Error('分页数据不完整，请重新读取');
 }
 throw new Error('数据超过可读取范围，请联系管理员');
}
function receipt(raw:unknown,pending:Pending,versionId:string):Goods{
 const row=raw as Goods;
 if(!row||!row.id||row.vehicleId!==pending.vehicleId||row.productVersionId!==versionId||row.status!==pending.expected||!Number.isSafeInteger(row.revision)||row.revision<0||pending.recordId&&row.id!==pending.recordId)throw new ApiError('商品回执不完整，请重试原请求核对结果',0,'INVALID_RESPONSE');
 return row;
}
export function GoodsBatch({onClose,onDone}:{onClose:()=>void;onDone:()=>void}){
 const [versions,setVersions]=useState<Version[]>([]),[vehicles,setVehicles]=useState<Vehicle[]>([]),[goods,setGoods]=useState<Goods[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState<unknown>();
 const [versionId,setVersionId]=useState(''),[selected,setSelected]=useState<string[]>([]),[rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[stopped,setStopped]=useState(false);
 const session=useRef(api.session),pending=useRef<Pending|null>(null),run=useRef<{mode:'publish'|'withdraw';index:number;rows:Row[]}|null>(null),inflight=useRef(false),alive=useRef(true);
 useEffect(()=>{const abort=new AbortController();alive.current=true;
  Promise.all([all<Vehicle>('/admin/vehicles','vehicles.read',abort.signal),all<{id:string;versions:Version[]}>('/admin/products','products.read',abort.signal),all<Goods>('/admin/goods','goods.read',abort.signal)]).then(([cars,products,list])=>{if(abort.signal.aborted)return;if(api.session!==session.current)throw new Error('登录会话已变化，请重新打开');setVehicles(cars);setVersions(publishedGoodsVersions(products) as Version[]);setGoods(list);}).catch(e=>{if(!abort.signal.aborted)setError(e);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
  return()=>{alive.current=false;abort.abort();};
 },[]);
 const version=versions.find(v=>v.id===versionId);let candidates:Vehicle[]=[];
 try{if(version)candidates=applicableVehicles(version,vehicles);}catch{/* render error below */}
 const rowsForVersion=()=>candidates.map(vehicle=>{const matches=goods.filter(g=>g.vehicleId===vehicle.id&&g.productVersionId===versionId);if(matches.length>1)throw new Error('同车同产品存在多条商品，请先核对');return{vehicle,goods:matches[0]};});
 const update=()=>{if(alive.current&&run.current)setRows(run.current.rows.map(r=>({...r})));};
 const close=()=>{if(!inflight.current&&!pending.current){onDone();onClose();}};
 async function execute(mode:'publish'|'withdraw'){
  if(inflight.current||!alive.current)return;
  if(api.session!==session.current){pending.current=null;setUnknown(false);setStopped(true);setError(new Error('登录会话已变化，请关闭并重新核对'));return;}
  const reconciling=!!pending.current;
  inflight.current=true;setBusy(true);setError(undefined);
  try{
   if(!run.current){if(!version||version.status!=='PUBLISHED')throw new Error('请选择已发布产品版本');const selectedSet=new Set(selected),chosen=rowsForVersion().filter(r=>selectedSet.has(r.vehicle.id));if(!chosen.length||chosen.length!==selectedSet.size)throw new Error('请选择有效的适用车辆');run.current={mode,index:0,rows:chosen};update();}
   const job=run.current;
   while(job.index<job.rows.length){
    if(!alive.current)return;
    if(api.session!==session.current)throw new ApiError('登录会话已变化，请重新核对',0,'SESSION_CHANGED');
    const row=job.rows[job.index],action=batchAction(job.mode,row.goods?.status);
    if(action==='skip'){row.result=job.mode==='publish'?'方案已上架，跳过':'方案未上架，跳过';job.index++;update();continue;}
    if(!pending.current){const path=action==='create'?'/admin/goods':`/admin/goods/${encodeURIComponent(row.goods!.id)}/${action}`;
     const body=action==='create'?{vehicleId:row.vehicle.id,productVersionId:versionId,visible:true,recommended:false,sortOrder:0,revision:0}:{revision:row.goods!.revision};
     pending.current={path,body:{...body,idempotencyKey:crypto.randomUUID()},vehicleId:row.vehicle.id,expected:action==='create'?'DRAFT':action==='publish'?'PUBLISHED':'WITHDRAWN',recordId:row.goods?.id};}
    const p=pending.current,answer=receipt(await api.request(p.path,{method:'POST',permission:'goods.write',body:p.body}),p,versionId);
    if(!alive.current)return;
    if(api.session!==session.current)throw new ApiError('登录会话已变化，请重新核对',0,'SESSION_CHANGED');
    pending.current=null;setUnknown(false);row.goods=answer;
    if(action==='create')row.result='方案草稿已创建，待上架';
    else{row.result=action==='publish'?'方案已上架':'方案已下架';job.index++;}
    update();if(reconciling)break;
   }
   setStopped(true);onDone();
  }catch(e){
   if(!alive.current)return;setError(e);
   if(e instanceof ApiError&&e.code==='SESSION_CHANGED'){pending.current=null;setStopped(true);setUnknown(false);}
   else if(e instanceof ApiError&&e.status>=400&&e.status<500&&e.code!=='INVALID_RESPONSE'){pending.current=null;setStopped(true);setUnknown(false);}
   else if(pending.current)setUnknown(true);else setStopped(true);
   update();onDone();
  }finally{inflight.current=false;if(alive.current)setBusy(false);}
 }
 const locked=busy||unknown||!!run.current, invalidScope=!!version&&(!Array.isArray(version.vehicleIds)||!Array.isArray(version.modelDefinitionIds));
 return <Drawer title="批量上架 / 下架产品方案" onClose={close}>
  {loading?<Loading label="读取产品、车辆与商品"/>:<div className="goods-form">
   <label>生效产品版本<select aria-label="生效产品版本" disabled={locked||stopped} value={versionId} onChange={e=>{setVersionId(e.target.value);setSelected([]);setRows([]);setError(undefined);}}><option value="">请选择已发布产品</option>{versions.map(v=><option key={v.id} value={v.id}>{v.name} · 第 {v.version} 版</option>)}</select></label>
   {invalidScope?<p role="alert">产品适用范围不完整，请刷新并核对产品。</p>:version?<><p>适用车辆 {candidates.length} 辆，已选 {selected.length} 辆。按指定车辆和适用车型共同匹配。</p>
    <label><input type="checkbox" aria-label="全选产品适用车辆" disabled={locked||stopped||!candidates.length} checked={!!candidates.length&&selected.length===candidates.length} onChange={e=>setSelected(e.target.checked?candidates.map(v=>v.id):[])}/>全选产品适用车辆</label>
    <div className="table-scroll"><table><thead><tr><th>选择</th><th>车辆</th><th>车牌 / VIN</th><th>产品方案状态</th></tr></thead><tbody>{candidates.map(v=>{const matches=goods.filter(g=>g.vehicleId===v.id&&g.productVersionId===versionId);return <tr key={v.id}><td><input type="checkbox" aria-label={`选择车辆 ${v.plateNumber||v.title}`} disabled={locked||stopped} checked={selected.includes(v.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,v.id]:old.filter(id=>id!==v.id))}/></td><td>{v.title}</td><td>{v.plateNumber||'未登记车牌'} / {v.vin||'未登记VIN'}</td><td>{matches.length>1?'重复记录，需核对':matches[0]?goodsStatusLabel(matches[0].status):'未建产品方案'}</td></tr>;})}</tbody></table></div>
    <p>仅上架或下架产品方案，不改变车辆商品的对客开关。已有方案保留展示设置，既有订单不变。</p></>:null}
   {rows.length?<section aria-label="批量办理结果"><h3>办理结果</h3><ul>{rows.map(r=><li key={r.vehicle.id}>{r.vehicle.plateNumber||r.vehicle.title}：{r.result||'未处理'}</li>)}</ul></section>:null}
   {error?<ErrorNotice error={error}/>:null}{unknown?<p role="status">当前请求结果尚未确认，请保留面板并重试原请求；重试只核对原操作，后续车辆尚未处理。</p>:null}
   {stopped?<p role="status">本次办理已结束或停止，请核对各车辆结果；如需继续请关闭并重新读取。</p>:null}
   <div className="goods-actions"><button type="button" className="button" disabled={busy||unknown} onClick={close}>关闭</button>{unknown?<button type="button" className="button primary" disabled={busy} onClick={()=>void execute(run.current!.mode)}>重试原请求</button>:<><button type="button" className="button primary" disabled={locked||stopped||invalidScope||!selected.length} onClick={()=>void execute('publish')}>批量上架所选方案</button><button type="button" className="button" disabled={locked||stopped||invalidScope||!selected.length} onClick={()=>void execute('withdraw')}>批量下架所选方案</button></>}</div>
  </div>}
 </Drawer>;
}
