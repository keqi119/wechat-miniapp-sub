import {cloneElement,isValidElement,useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {Alert,Button,Card,Descriptions,Tabs,Tag} from 'antd';
import {api,ApiError,type Page} from './core';
import {CommandBoundary} from './domain-ui';
import {routeAllowed} from './modules/navigation';
import {processHref,rememberProcessPosition,syncProcessSection} from './process-navigation';
import './vehicle-workspace.css';
import {VehicleInsuranceSummary} from './vehicle-insurance-baas';
import {VehiclePolicyRegistration} from './insurance-workspace';
import type {InsurancePolicy} from './insurance-registration';
import {checkPublishReadiness} from './vehicle-publish-readiness-model';
import {VehicleBaasPanel} from './vehicle-baas-panel';
import {VehicleProductSlots} from './vehicle-product-slots';
import {VehicleDocuments} from './vehicle-documents';
import {VehicleAssetPanel,type VehicleAssetPanelProps} from './asset-profile';
import {VehicleOverview} from './vehicle-overview';
import {VehiclePhotos} from './vehicle-photos';
import {VehicleInspections} from './vehicle-inspections';

export type VehicleWorkspaceProps={
 entity:Record<string,unknown>;status:ReactNode;actions:ReactNode;emptyActionMessage?:string;onRefresh:()=>void;
 overview?:ReactNode;operations?:ReactNode;layout?:'page'|'embedded';detailError?:unknown;detailRefreshing?:boolean;
 renderValues:(value:Record<string,unknown>)=>ReactNode;slots?:{asset?:ReactNode;maintenance?:ReactNode;plates?:ReactNode};
};
const tabs=[{key:'overview',label:'车辆概览'},{key:'documents',label:'权证资料'},{key:'photos',label:'车辆照片'},{key:'inspection',label:'车况查验'},{key:'insurance',label:'保险信息'},{key:'battery-baas',label:'电池 BaaS'},{key:'listing',label:'商品展示'},{key:'valuation',label:'估值与折旧'},{key:'capital',label:'资本与分润'},{key:'unclassified',label:'待分类资料'}];
const text=(value:unknown,fallback='未登记')=>typeof value==='string'&&value.trim()?value:typeof value==='number'&&Number.isFinite(value)?String(value):fallback;
const currentTab=()=>{const value=new URLSearchParams(window.location.hash.split('?')[1]).get('view'),key=value==='insurance-battery'?'battery-baas':value;return tabs.some(tab=>tab.key===key)?key!:'overview';};
const links={orders:['订单与租赁','orders'],goods:['商品中心','goods'],insurance:['保单档案','insurance'],baas:['BAAS 合同','baas-contracts'],depreciation:['折旧策略','depreciation-policies'],forecast:['车辆预测','residual-forecasts'],valuation:['人工估值','vehicle-valuations'],costs:['内部成本台账','asset-costs'],partners:['合作商档案','partners']} as const;

/** Source: subscription-Saas db4b48c vehicle-workspace; current API and permission boundaries remain authoritative. */
export function VehicleWorkspace(props:VehicleWorkspaceProps){
 const session=useRef({value:api.session,epoch:0});if(session.current.value!==api.session)session.current={value:api.session,epoch:session.current.epoch+1};
 const user=api.session?.user,scope=[props.entity.id,session.current.epoch,user?.id,user?.role,[...(user?.permissions||[])].sort().join(','),[...(user?.partnerCapabilities||[])].sort().join(',')].join('|');
 const lost=props.detailError instanceof ApiError&&[401,403,404].includes(props.detailError.status);
 if(lost)return <div className="vehicle-workspace-unavailable"><Alert type="warning" title="当前车辆资料不可读取" description="请重新核对登录权限及车辆记录。"/><Button onClick={props.onRefresh}>刷新车辆详情</Button></div>;
 return <VehicleWorkspaceBody key={scope} {...props}/>;
}
function VehicleWorkspaceBody({entity,status,actions,emptyActionMessage,onRefresh,overview,operations,detailError,detailRefreshing=false,slots}:VehicleWorkspaceProps){
 const [baasFrozen,setBaasFrozen]=useState(false),[goodsFrozen,setGoodsFrozen]=useState(false),[photosFrozen,setPhotosFrozen]=useState(false),[insuranceFrozen,setInsuranceFrozen]=useState(false);
 const frozen=baasFrozen||goodsFrozen||photosFrozen||insuranceFrozen,frozenRef=useRef(false);frozenRef.current=frozen;
 const [tab,setTab]=useState(currentTab),[visited,setVisited]=useState(()=>new Set([currentTab()])),[readVersion,setReadVersion]=useState(0),scroll=useRef<HTMLDivElement>(null),positions=useRef<Record<string,number>>({}),active=useRef(tab);
 const blocked=detailRefreshing||!!detailError;
 const refresh=useRef(onRefresh),alive=useRef(true);refresh.current=onRefresh;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const vehicleId=String(entity.id),policyRegistered=useCallback(async()=>{
  const identity=api.session;
  const [summary,readiness]=await Promise.all([
   api.request<Page<InsurancePolicy>>('/admin/insurance-policies?'+new URLSearchParams({vehicleId,page:'1',pageSize:'5'}),{permission:'insurance-policies.read'}),
   api.request('/admin/vehicles/'+encodeURIComponent(vehicleId)+'/publish-readiness',{permission:'vehicles.read'}),
  ]);
  if(!alive.current||identity!==api.session)throw new ApiError('当前车辆或登录会话已变化，请重新读取登记结果',0,'SESSION_CHANGED');
  if(!Array.isArray(summary.items)||summary.page!==1||summary.pageSize!==5||!Number.isSafeInteger(summary.total)||summary.total<0||summary.items.some(row=>!row.id||!Array.isArray(row.versions)||!row.versions.some(version=>version.vehicleIds?.includes(vehicleId))))throw Error('本车保单摘要尚未核对，请重新读取登记结果。');
  checkPublishReadiness(readiness,{vehicleId});setReadVersion(value=>value+1);await refresh.current();
 },[vehicleId]);
 useEffect(()=>{if(!blocked)setReadVersion(value=>value+1);},[entity.id,entity.revision,blocked]);
 useEffect(()=>{const update=()=>{if(!frozenRef.current)setTab(currentTab());};window.addEventListener('hashchange',update);window.addEventListener('process-location',update);return()=>{window.removeEventListener('hashchange',update);window.removeEventListener('process-location',update);};},[]);
 useEffect(()=>{setVisited(old=>old.has(tab)?old:new Set([...old,tab]));active.current=tab;if(scroll.current)scroll.current.scrollTop=positions.current[tab]||0;},[tab]);
 const select=(key:string)=>{if(frozen&&key!==active.current)return;if(scroll.current)positions.current[active.current]=scroll.current.scrollTop;setTab(key);syncProcessSection(key);};
 const link=(key:keyof typeof links)=>{const [label,route]=links[key],user=api.session?.user;return routeAllowed(route,user?.role,user?.permissions||[],user?.partnerCapabilities)?<a key={key} href={processHref('#'+route+(route==='baas-contracts'?'?vehicleId='+encodeURIComponent(String(entity.id)):''),window.location.hash)} onClick={event=>{const current=api.session?.user;if(current&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&!event.defaultPrevented)rememberProcessPosition(current.id);}}>打开{label}</a>:null;};
 const entries=(keys:(keyof typeof links)[])=>{const visible=keys.map(link).filter(Boolean);return visible.length?<div className="vehicle-workspace-links">{visible}</div>:<p className="vehicle-workspace-empty">当前岗位没有相关业务入口。</p>;};
 const card=(title:string,children:ReactNode,extra?:ReactNode)=><Card title={title} extra={extra} className="vehicle-workspace-card" data-vehicle-fact-card>{children}</Card>;
 const facts=(items:[string,ReactNode][]) => <Descriptions size="small" column={1} items={items.map(([label,children])=>({key:label,label,children}))}/>;
 const asset=slots?.asset,overviewFacts=isValidElement<VehicleAssetPanelProps>(asset)&&asset.type===VehicleAssetPanel?cloneElement(asset,{compact:true,onSectionChange:select,disabled:asset.props.disabled||blocked}):<><VehicleOverview vehicle={entity} onSectionChange={select}/>{asset}</>;
 const content:Record<string,ReactNode>={
  overview:<>
   {overviewFacts}{slots?.maintenance?<section className="vehicle-workspace-maintenance" aria-label="保养提醒">{slots.maintenance}</section>:null}{overview?card('车辆办理资料',overview):null}
  </>,
  documents:<>{slots?.plates?<div className="vehicle-workspace-plates">{slots.plates}</div>:null}<VehicleDocuments vehicleId={String(entity.id)} refreshKey={readVersion} onUpdated={()=>setReadVersion(value=>value+1)}/></>,
  photos:<VehiclePhotos vehicleId={String(entity.id)} refreshKey={readVersion} onUpdated={onRefresh} onFrozenChange={setPhotosFrozen}/>,
  inspection:<VehicleInspections vehicleId={String(entity.id)} refreshKey={readVersion} onUpdated={()=>{setReadVersion(value=>value+1);onRefresh();}}/>,
  unclassified:<VehicleDocuments vehicleId={String(entity.id)} refreshKey={readVersion} onUpdated={()=>setReadVersion(value=>value+1)} view="unclassified"/>,
  insurance:<>{card('本车保险信息',<fieldset disabled={insuranceFrozen} style={{border:0,padding:0,margin:0,minWidth:0}}><VehicleInsuranceSummary vehicleId={vehicleId} refreshKey={readVersion}/></fieldset>,<CommandBoundary disabled={blocked||baasFrozen||goodsFrozen||photosFrozen}><VehiclePolicyRegistration vehicleId={vehicleId} onRegistered={policyRegistered} onFrozenChange={setInsuranceFrozen}/></CommandBoundary>)}<CommandBoundary disabled={insuranceFrozen}><VehicleDocuments vehicleId={vehicleId} refreshKey={readVersion} onUpdated={()=>setReadVersion(value=>value+1)} view="insurance"/></CommandBoundary></>,
  'battery-baas':<><VehicleBaasPanel vehicleId={String(entity.id)} refreshKey={readVersion} disabled={blocked} onFrozenChange={setBaasFrozen}/></>,
  listing:<VehicleProductSlots vehicleId={String(entity.id)} vehicleStatus={typeof entity.status==='string'?entity.status:undefined} vehicleRevision={typeof entity.revision==='number'?entity.revision:undefined} refreshKey={readVersion} active={tab==='listing'} layout="workspace" onFrozenChange={setGoodsFrozen} onVehicleUpdated={onRefresh}/>,
  valuation:<>{card('估值与折旧记录',<><p className="vehicle-workspace-empty">暂无本页可展示的估值与折旧汇总。请进入对应记录核对本车依据、金额与生效日期。</p>{entries(['forecast','valuation','depreciation'])}</>)}</>,
  capital:<>{card('成本与合作记录',<><p className="vehicle-workspace-empty">暂无本页可展示的成本与分润明细。请在获授权的台账中核对车辆及来源。</p>{entries(['costs','partners'])}</>)}</>,
 };
 return <CommandBoundary disabled={blocked} readVersion={readVersion}><section className="vehicle-workspace" onClickCapture={event=>{if(frozen&&event.target instanceof Element&&event.target.closest('a[href]'))event.preventDefault();}} data-vehicle-workspace aria-label="车辆工作台">
  <header className="vehicle-workspace-summary" data-vehicle-workspace-header><div className="vehicle-workspace-summary-facts"><div><span className="vehicle-workspace-label">车辆</span><strong title={text(entity.title)}>{text(entity.title)}</strong></div><div><span className="vehicle-workspace-label">当前车牌</span><strong>{text(entity.plateNumber)}</strong></div><div><span className="vehicle-workspace-label">车辆状态</span><Tag color="blue">{status||'待核对'}</Tag></div></div><div className="vehicle-workspace-actions"><fieldset disabled={blocked||frozen}>{actions}</fieldset><Button onClick={onRefresh} loading={detailRefreshing} disabled={frozen}>刷新车辆详情</Button></div></header>
  <Tabs className="vehicle-workspace-tabs" animated={false} activeKey={tab} items={tabs.map(item=>({...item,disabled:frozen&&item.key!==tab}))} onChange={select} tabBarGutter={22}/>
  <div className="vehicle-workspace-scroll detail-panel-scroll" data-vehicle-scroll ref={scroll} onScroll={()=>{if(scroll.current)positions.current[active.current]=scroll.current.scrollTop;}}>
   {detailError?<Alert type="warning" showIcon title="车辆资料暂时读取失败" description="以下保留上次成功读取的资料及填写内容；重新核对前不能提交新办理。"/>:detailRefreshing?<Alert type="info" title="正在核对车辆资料"/>:null}
   {emptyActionMessage?<p className="vehicle-workspace-empty">{emptyActionMessage}</p>:null}
   {tabs.map(item=><section key={item.key} hidden={item.key!==tab} aria-label={`${item.label}内容`} data-vehicle-workspace-active-content={item.key===tab?item.key:undefined} className="vehicle-workspace-panel"><CommandBoundary disabled={insuranceFrozen&&item.key!=='insurance'}>{visited.has(item.key)||item.key===tab?content[item.key]:null}</CommandBoundary></section>)}
  </div>
 </section></CommandBoundary>;
}
