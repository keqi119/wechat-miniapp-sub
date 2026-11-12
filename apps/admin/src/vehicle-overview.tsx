import {type MouseEvent,type ReactNode} from 'react';
import {api,date,money} from './core';
import {assetLabels,type AssetProfile} from './asset-model';
import {routeAllowed} from './modules/navigation';
import {processHref,rememberProcessPosition} from './process-navigation';
import {VehicleCooperation} from './vehicle-cooperation';
import './vehicle-overview.css';

type Props={vehicle:Record<string,unknown>;profile?:AssetProfile;action?:ReactNode;notice?:ReactNode;onSectionChange?:(key:string)=>void};
const text=(value:unknown,fallback='未登记')=>typeof value==='string'&&value.trim()?value:typeof value==='number'&&Number.isFinite(value)?String(value):fallback;
const mileage=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value.toLocaleString('en-US')+' 公里':'未登记';
const health=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?value+'%':'未登记';
const plainClick=(event:MouseEvent<HTMLAnchorElement>)=>event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&!event.defaultPrevented;
function allowed(route:string){const user=api.session?.user;return routeAllowed(route,user?.role,user?.permissions||[],user?.partnerCapabilities);}
function remember(event:MouseEvent<HTMLAnchorElement>){if(plainClick(event)&&api.session?.user)rememberProcessPosition(api.session.user.id);}

/** Only the independently authorized asset projection supplies procurement and battery ownership facts. */
export function VehicleOverview({vehicle,profile,action,notice,onSectionChange}:Props){
 const model=vehicle.modelDefinition as {modelYear?:number}|undefined,owner=vehicle.cooperationOwner as {id?:string}|null|undefined;
 const sectionHref=(key:string)=>{const [route,query]=window.location.hash.split('?'),params=new URLSearchParams(query);params.set('view',key);return `${route}?${params}`;};
 const ownership=profile?assetLabels[profile.batteryOwnership]||'未登记':'未读取';
 const cooperation=<VehicleCooperation entity={vehicle}/>;
 const facts=(items:[string,ReactNode][]) => <dl>{items.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
 return <section className="vehicle-overview" aria-label="车辆概览事实">
  {notice}
  <div className="vehicle-overview-groups">
   <section className="vehicle-overview-group" data-vehicle-fact-card><h2>身份登记</h2>{facts([
    ['VIN',text(vehicle.vin)],['品牌 / 车型',[vehicle.brand,vehicle.model].filter(value=>typeof value==='string'&&value).join(' / ')||'未登记'],
    ['车型年款',text(vehicle.modelYear??model?.modelYear)],['上牌年份',text(vehicle.registrationYear??vehicle.year)],
    ...profile?[
     ['车辆所有人（登记证）',text(profile.registeredOwnerName)],['首次登记日期',text(profile.firstRegistrationDate)],['发动机号',text(profile.engineNumber)],['车身颜色',text(profile.bodyColor)],['下次年检日期',text(profile.nextInspectionDate)],
    ] as [string,ReactNode][]:[],
   ])}</section>
   <section className="vehicle-overview-group" data-vehicle-fact-card><h2>电池与使用</h2>{facts([
    ['电池归属',profile&&profile.batteryOwnership==='BAAS'&&allowed('baas-contracts')?<a href={sectionHref('battery-baas')} onClick={event=>{if(plainClick(event)&&onSectionChange){event.preventDefault();onSectionChange('battery-baas');}}}>{ownership}</a>:ownership],
    ...profile?[['电池容量',profile.batteryCapacityKwh!=null?profile.batteryCapacityKwh+' kWh':'未登记']] as [string,ReactNode][]:[],
    ['电池健康度',health(vehicle.batteryHealthPercent)],['当前里程',mileage(vehicle.mileageKm)],
    ...profile?[['初始里程',mileage(profile.initialMileageKm)]] as [string,ReactNode][]:[],
    ['资产所在地',text(vehicle.city)],['资料更新',vehicle.updatedAt?date(vehicle.updatedAt):'暂无记录'],
   ])}</section>
   <section className="vehicle-overview-group" data-vehicle-fact-card><h2>采购合作</h2>{facts([
    ['合作商',owner?.id&&allowed('partners')?<a href={processHref('#partners?record='+encodeURIComponent(owner.id),window.location.hash)} onClick={remember}>{cooperation}</a>:cooperation],
    ...profile?[
     ['购车人',text(profile.purchaserName)],['实际采购金额',profile.purchaseAmount!=null?money(profile.purchaseAmount):'未登记'],['采购日期',text(profile.purchaseDate)],['资产建档',profile.registered?'已登记':'尚未建档'],['资产备注',text(profile.notes,'—')],
    ] as [string,ReactNode][]:[],
   ])}{!profile?<p className="vehicle-overview-muted">资产资料未读取。</p>:null}</section>
  </div>
  {action?<div className="vehicle-overview-actions">{action}</div>:null}
 </section>;
}
