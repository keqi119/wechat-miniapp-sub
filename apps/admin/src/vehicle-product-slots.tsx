import {useEffect,useRef,useState,useCallback,type MouseEvent} from 'react';
import {Plus,RefreshCw} from 'lucide-react';
import {api,money,type Page} from './core';
import {ErrorNotice,Loading} from './ui';
import {GoodsForm} from './goods';
import {CommandBoundary,useCommandDisabled} from './domain-ui';
import {goodsAccess,goodsStatusLabel,type Goods} from './goods-model';
import {GoodsInspectionSelection} from './goods-inspection-selection';
import {SharedVehicleGallery} from './vehicle-media';
import {GoodsAppDisplayStatus} from './goods-app-display';
import {goodsAppDisplayView} from './goods-app-display-model';
import {GoodsAppPresentation} from './goods-app-presentation';
import './vehicle-product-slots.css';
import {VehicleCatalogControl} from './vehicle-catalog-control';
import {VehiclePublishReadiness} from './vehicle-publish-readiness';
import './vehicle-listing-workspace.css';

type Props={vehicleId:string;vehicleStatus?:string;vehicleRevision?:number;refreshKey?:number;active?:boolean;layout?:'workspace';onVehicleUpdated?:()=>void;onFrozenChange?:(value:boolean)=>void};
export function VehicleProductSlots(props:Props){
 const {vehicleId}=props,session=api.session,signature=JSON.stringify([session?.user.id,session?.user.role,session?.user.permissions]),scope=useRef({session,signature,generation:0});
 if(scope.current.session!==session||scope.current.signature!==signature)scope.current={session,signature,generation:scope.current.generation+1};
 const access=goodsAccess(session?.user.role,session?.user.permissions||[]);
 return access.read?<VehicleSlots key={`${vehicleId}:${scope.current.generation}`} {...props} access={access}/>:<p>当前账号无权查看商品。</p>;
}

type SlotForm={mode:'create'|'edit'|'publish'|'withdraw';record?:Goods};
function VehicleSlots({vehicleId,vehicleStatus,vehicleRevision,refreshKey=0,active=true,layout,onVehicleUpdated,access,onFrozenChange}:Props&{access:ReturnType<typeof goodsAccess>}){
 const boundaryDisabled=useCommandDisabled();
 const [frozenIds,setFrozenIds]=useState<Set<string>>(()=>new Set()),frozen=frozenIds.size>0,frozenRef=useRef(false),deferred=useRef(false),freezeCallback=useRef(onFrozenChange);frozenRef.current=frozen;freezeCallback.current=onFrozenChange;
 const reportFrozen=useCallback((id:string,value:boolean)=>setFrozenIds(old=>{if(old.has(id)===value)return old;const next=new Set(old);if(value)next.add(id);else next.delete(id);return next;}),[]);
 useEffect(()=>{freezeCallback.current?.(frozen);},[frozen]);useEffect(()=>()=>freezeCallback.current?.(false),[]);
 const[items,setItems]=useState<Goods[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState<unknown>(),[refresh,setRefresh]=useState(0),[form,setForm]=useState<SlotForm>(),[receipt,setReceipt]=useState(''),[selected,setSelected]=useState('');
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  if(frozenRef.current||!active){deferred.current=true;return;}
  const controller=new AbortController();setLoading(true);setError(undefined);setItems([]);
  async function read(){
   if(!vehicleId.trim())throw new Error('缺少当前车辆编号');
   const rows:Goods[]=[],ids=new Set<string>();let total:number|undefined;
   for(let page=1;;page++){
    const query=new URLSearchParams({vehicleId,page:String(page),pageSize:'20'}),result=await api.request<Page<Goods>>(`/admin/goods?${query}`,{signal:controller.signal,permission:'goods.read'});
    if(controller.signal.aborted)return;
    if(!Array.isArray(result.items)||!Number.isSafeInteger(result.total)||result.total<0||result.page!==page||result.pageSize!==20||total!==undefined&&result.total!==total)throw new Error('本车商品分页已变化，请刷新后重新核对');
    total=result.total;
    for(const item of result.items){if(!item.id||ids.has(item.id)||item.vehicleId!==vehicleId||item.vehicle?.id!==vehicleId||!['DRAFT','PUBLISHED','WITHDRAWN'].includes(item.status))throw new Error('返回商品与当前车辆不一致');ids.add(item.id);rows.push(item);}
    if(rows.length>total||rows.length<total&&!result.items.length)throw new Error('本车商品分页不完整，请刷新后重新核对');
    if(rows.length===total){setItems(rows);setSelected(old=>rows.some(row=>row.id===old)?old:rows[0]?.id||'');return;}
   }
  }
  read().catch(e=>{if(!controller.signal.aborted)setError(e);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
 },[vehicleId,refresh,vehicleStatus,refreshKey,active]);
 useEffect(()=>{if(!frozen&&deferred.current){deferred.current=false;setRefresh(n=>n+1);}},[frozen]);
 const completed=(value:Goods)=>{
  if(!alive.current)return;
  if(value.vehicleId!==vehicleId||form?.record&&value.id!==form.record.id){setError(new Error('操作回执与当前商品不一致，请刷新核对'));setForm(undefined);return;}
  const newer=!!form?.record&&value.revision>form.record.revision+1||form?.mode==='publish'&&value.status!=='PUBLISHED'||form?.mode==='withdraw'&&value.status!=='WITHDRAWN'||form?.mode==='create'&&value.status!=='DRAFT';
  setReceipt(newer?'原操作已提交，已读取当前方案状态，请以当前标注核对。':form?.mode==='create'?'产品方案草稿已保存，核对后可上架方案。':form?.mode==='publish'?'产品方案已上架。对客商品仍须在本页顶部单独上架。':form?.mode==='withdraw'?'产品方案已下架，既有订单约定保持。':'产品方案展示设置已保存。');
  setForm(undefined);setRefresh(n=>n+1);
 };
 const workspace=layout==='workspace',chosen=items.find(item=>item.id===selected),version=refreshKey+refresh;
 const appVisiblePlanCount=loading||error||items.some(row=>goodsAppDisplayView(row.appDisplay).label==='App 展示待核对')?undefined:items.filter(row=>row.appDisplay?.visible).length;
 const formView=form?<GoodsForm key={`${form.mode}:${form.record?.id||'new'}:${form.record?.revision||0}`} mode={form.mode} record={form.record} fixedVehicleId={vehicleId} onFrozenChange={value=>reportFrozen('form',value)} onClose={()=>setForm(undefined)} onComplete={completed}/>:null;
 const heading=<header className="vehicle-product-slots-heading"><div><h2>产品卡槽</h2><p>{workspace?'选择产品方案，在右侧核对 App 展示。':'同一车辆可配置多个产品方案。方案上架与商品对客上架分别办理。'}</p></div><div className="goods-actions"><button className="button" disabled={loading||!!form||frozen} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={16}/>刷新卡槽</button>{access.create?<button className="button primary" disabled={boundaryDisabled||loading||!!error||!!form||frozen} onClick={()=>setForm({mode:'create'})}><Plus size={16}/>新增产品卡槽</button>:null}</div></header>;
 const preview=(item:Goods,inline=false)=><GoodsAppPresentation key={item.id} record={item} inline={inline} disabled={boundaryDisabled||!!form||frozen&&!frozenIds.has(item.id)} onFrozenChange={value=>reportFrozen(item.id,value)} onUpdated={value=>{setItems(old=>old.map(row=>row.id===item.id?{...row,revision:value.listingRevision,vehicle:{...row.vehicle,title:value.materials.title},appDisplay:value.appDisplay as Goods['appDisplay']}:row));if(workspace){setRefresh(n=>n+1);onVehicleUpdated?.();}}}/>;
 const card=(item:Goods)=><article className={'vehicle-product-slot'+(workspace&&selected===item.id?' is-selected':'')} key={item.id} aria-label={item.productVersion.name} onClick={event=>{if(workspace&&!frozen&&!form&&event.target instanceof Element&&!event.target.closest('button,a,input,details'))setSelected(item.id);}}>
  <header>{workspace?<label className="vehicle-slot-choice"><input type="radio" name="vehicle-product-preview" checked={selected===item.id} disabled={frozen||!!form} onChange={()=>setSelected(item.id)}/><strong>{item.productVersion.name}</strong></label>:<h3>{item.productVersion.name}</h3>}<span className={`status ${item.status==='PUBLISHED'?'success':item.status==='DRAFT'?'warning':'neutral'}`}>{goodsStatusLabel(item.status)}</span></header>
  <p className="vehicle-product-slot-version">第 {item.productVersion.version} 版 · {item.plan.months} 个月</p><p className="vehicle-product-slot-price">{money(item.plan.monthlyFeeAmount)}<small> / 月</small></p>
  <dl><div><dt>每月里程</dt><dd>{item.plan.mileagePerMonthKm} km</dd></div><div><dt>超里程单价</dt><dd>{money(item.plan.excessMileagePriceAmount)} / km</dd></div><div><dt>展示设置</dt><dd>{item.visible?'允许展示':'隐藏'}{item.recommended?' · 推荐':''}</dd></div></dl>
  {(vehicleStatus??item.vehicle.status)&&(vehicleStatus??item.vehicle.status)!=='PUBLISHED'?<p className="action-warning">车辆未激活，当前不在App展示。</p>:null}
  {!workspace?<><p>{item.plan.energyDescription}</p><p>{item.plan.benefits?.join('；')||'按产品约定'}</p></>:null}<GoodsAppDisplayStatus value={item.appDisplay}/>
  <div className="goods-actions">{!workspace?<a className="text-button" href={`#goods?record=${encodeURIComponent(item.id)}`}>查看详情</a>:null}{access.write?<><button className="button" disabled={boundaryDisabled||!!form||frozen} onClick={()=>setForm({mode:'edit',record:item})}>调整展示</button><button className={`button ${item.status==='PUBLISHED'?'danger':'primary'}`} disabled={boundaryDisabled||!!form||frozen} onClick={()=>setForm({mode:item.status==='PUBLISHED'?'withdraw':'publish',record:item})}>{item.status==='PUBLISHED'?'下架产品方案':'上架产品方案'}</button></>:null}</div>
  {!workspace?preview(item):null}
  {workspace?<details className="vehicle-slot-inspections"><summary>查验展示</summary><fieldset disabled={frozen} className="goods-presentation-boundary"><GoodsInspectionSelection record={item} onUpdated={value=>{setItems(old=>old.map(row=>row.id===item.id?value:row));setRefresh(n=>n+1);}}/></fieldset></details>:<fieldset disabled={frozen} className="goods-presentation-boundary"><GoodsInspectionSelection record={item} onUpdated={value=>setItems(old=>old.map(row=>row.id===item.id?value:row))}/></fieldset>}
 </article>;
 const list=loading?<Loading label="读取本车全部产品卡槽"/>:error?<ErrorNotice error={error} retry={()=>setRefresh(n=>n+1)}/>:<><p className="vehicle-product-slots-count">本车共 {items.length} 个产品卡槽</p>{items.length?<div className="vehicle-product-slots-grid">{items.map(card)}</div>:<p className="module-empty">本车尚未配置产品卡槽</p>}</>;
 const capture=(event:MouseEvent<HTMLElement>)=>{if(frozen&&event.target instanceof Element&&event.target.closest('a[href]'))event.preventDefault();};
 if(workspace)return <section className="vehicle-product-slots vehicle-listing-workspace" onClickCapture={capture} aria-label="本车产品卡槽">
  <VehicleCatalogControl vehicleId={vehicleId} refreshKey={version} disabled={boundaryDisabled||!active||frozen&&!frozenIds.has('catalog')} appVisiblePlanCount={appVisiblePlanCount} onFrozenChange={value=>reportFrozen('catalog',value)} onUpdated={()=>{setRefresh(n=>n+1);onVehicleUpdated?.();}}/>
  <div className="vehicle-listing-columns"><div data-listing-column className="vehicle-listing-conditions"><CommandBoundary disabled={frozen}><VehiclePublishReadiness vehicleId={vehicleId} vehicleRevision={vehicleRevision} refreshKey={version} active={active} compact/></CommandBoundary></div><div data-listing-column className="vehicle-listing-plans">{heading}{receipt?<p role="status" className="goods-receipt">{receipt}</p>:null}{list}{formView}</div><div data-listing-column className="vehicle-listing-preview">{chosen?preview(chosen,true):<><h2>App商品预览</h2><p className="muted">{loading?'正在读取当前产品方案…':'选择产品方案后，在此核对同源 App 展示。'}</p></>}</div></div>
 </section>;
 return <section className="vehicle-product-slots" onClickCapture={capture} aria-label="本车产品卡槽">{heading}<SharedVehicleGallery vehicleId={vehicleId}/>{receipt?<p role="status" className="goods-receipt">{receipt}</p>:null}{list}{formView}</section>;
}
