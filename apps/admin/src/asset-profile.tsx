import {useCallback,useEffect,useRef,useState} from 'react';
import {api,ApiError,money,type Entity} from './core';
import {ErrorNotice,Loading} from './ui';
import {assetAccess,assetLabels,assetProfilePayload,type AssetProfile} from './asset-model';
import {assetSessionKey,AssetAction,type AssetField} from './asset-shared';
import {VehicleOverview} from './vehicle-overview';
const fields:AssetField[]=[
 {key:'registeredOwnerName',label:'车辆所有人（登记证）',maxLength:200,hint:'按机动车登记证填写，最多200字；留空清除。与合作商及牌照归属人分别记录。'},
 {key:'engineNumber',label:'发动机号',maxLength:200,hint:'按车辆资料填写，最多200字；留空清除。'},
 {key:'bodyColor',label:'车身颜色',maxLength:100,hint:'最多100字；留空清除。'},
 {key:'batteryOwnership',label:'电池归属',kind:'select',required:true,options:['UNKNOWN','OWNED','BAAS'].map(value=>({value,label:assetLabels[value]}))},
 {key:'batteryCapacityKwh',label:'电池容量（kWh）',hint:'可选，0至99999.999，最多三位小数；留空清除。'},
 {key:'purchaseYuan',label:'实际采购金额（元）',kind:'money',hint:'按实际采购金额填写，最多两位小数；0表示零元，留空清除。'},
 {key:'purchaserName',label:'购车人',maxLength:200,hint:'独立记录购车人，最多200字；留空清除。'},
 {key:'purchaseDate',label:'采购日期',kind:'date',hint:'依据实际采购资料填写；留空清除。'},
 {key:'initialMileageKm',label:'初始里程（km）',kind:'number',hint:'0至2147483647的整数；独立记录初始里程，不改变当前累计里程。留空清除。'},
 {key:'firstRegistrationDate',label:'首次登记日期',kind:'date',hint:'依据实际登记资料填写，可明确留空。'},
 {key:'nextInspectionDate',label:'下次年检日期',kind:'date',hint:'依据实际年检资料填写；留空清除。'},
 {key:'notes',label:'资产备注',kind:'textarea'},
];
export type VehicleAssetPanelProps={vehicle:Entity;disabled?:boolean;refreshKey?:number;onUpdated?:()=>void;compact?:boolean;onSectionChange?:(key:string)=>void};
export function VehicleAssetPanel({vehicle,disabled=false,refreshKey=0,onUpdated,compact=false,onSectionChange}:VehicleAssetPanelProps){
 const access=assetAccess('vehicle-assets',api.session?.user.role,api.session?.user.permissions||[]);
 return access.read?<VehicleAssetDetails key={vehicle.id+'-'+assetSessionKey()} vehicle={vehicle} disabled={disabled} writable={access.write} refreshKey={refreshKey} onUpdated={onUpdated} compact={compact} onSectionChange={onSectionChange}/>:compact?<VehicleOverview vehicle={vehicle} onSectionChange={onSectionChange}/>:null;
}
function VehicleAssetDetails({vehicle,disabled,writable,refreshKey,onUpdated,compact,onSectionChange}:{vehicle:Entity;disabled:boolean;writable:boolean;refreshKey:number;onUpdated?:()=>void;compact:boolean;onSectionChange?:(key:string)=>void}){
 const[profile,setProfile]=useState<AssetProfile>(),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false);const generation=useRef(0),recordSession=useRef(''),sessionKey=assetSessionKey();
 const load=useCallback(async()=>{
  const token=++generation.current,readSession=api.session;setBusy(true);
  try{
   const result=await api.request<AssetProfile>('/admin/vehicle-assets/'+encodeURIComponent(vehicle.id),{permission:'vehicle-assets.read'});
   if(readSession!==api.session||sessionKey!==assetSessionKey())throw new ApiError('登录会话已变化，请重新读取资产资料',0,'SESSION_CHANGED');
   if(result.vehicleId!==vehicle.id)throw new Error('资产资料与当前车辆不一致');
   if(token===generation.current){recordSession.current=sessionKey;setProfile(result);setError(undefined);}
  }catch(e){
   if(token===generation.current){
    const transient=e instanceof ApiError&&(e.status>=500||e.status===0&&e.code==='NETWORK_ERROR');
    const sameScope=readSession===api.session&&sessionKey===assetSessionKey()&&recordSession.current===sessionKey;
    setProfile(previous=>transient&&sameScope&&previous?.vehicleId===vehicle.id?previous:undefined);setError(e);
   }throw e;
  }finally{if(token===generation.current)setBusy(false);}
 },[vehicle.id,sessionKey]);
 useEffect(()=>{void load().catch(()=>{});return()=>{generation.current++;};},[load,refreshKey]);
 const model=vehicle.modelDefinition as {modelYear?:number}|undefined,current=profile?.vehicleId===vehicle.id&&recordSession.current===sessionKey?profile:undefined;
 const inventoryInitial:Record<string,string>={};
 if(current){
  for(const key of ['engineNumber','bodyColor','initialMileageKm','purchaserName','purchaseDate','nextInspectionDate'] as const){const value=current[key];if(value!==undefined)inventoryInitial[key]=value===null?'':String(value);}
  if(current.purchaseAmount!==undefined)inventoryInitial.purchaseYuan=current.purchaseAmount===null?'':(current.purchaseAmount/100).toFixed(2);
 }
 const action=current&&writable?<AssetAction label="编辑资产资料" path={'/admin/vehicle-assets/'+encodeURIComponent(vehicle.id)} method="PATCH" permission="vehicle-assets.write" fields={fields} initial={{registeredOwnerName:current.registeredOwnerName??'',batteryOwnership:current.batteryOwnership,batteryCapacityKwh:current.batteryCapacityKwh??'',firstRegistrationDate:current.firstRegistrationDate||'',notes:current.notes||'',...inventoryInitial}} build={values=>assetProfilePayload(values,current)} after={async()=>{await load();onUpdated?.();}} reloadOnConflict={load} disabled={disabled||busy||!!error}/>:current?<p className="muted">当前岗位仅可查看资产事实。</p>:null;
 if(compact)return <VehicleOverview vehicle={vehicle} profile={current} action={action} onSectionChange={onSectionChange} notice={error?current?<div className="action-warning" role="alert"><p>资产资料暂时读取失败，以下为上次成功读取的资料；新办理已暂停。</p><button className="button" disabled={busy} onClick={()=>void load().catch(()=>{})}>重新读取资产资料</button></div>:<ErrorNotice error={error} retry={()=>void load().catch(()=>{})}/>:!current?<Loading label="读取车辆资产资料"/>:undefined}/>;
 return <section className="asset-section asset-profile"><h3>车辆资产资料</h3>{current?<>
  {error?<div className="action-warning" role="alert"><p>资产资料暂时读取失败，以下为上次成功读取的资料；新办理已暂停。</p><button className="button" disabled={busy} onClick={()=>void load().catch(()=>{})}>重新读取资产资料</button></div>:null}
  <h4>车辆身份</h4><dl className="asset-facts">
   {Object.hasOwn(current,'registeredOwnerName')?<div><dt>车辆所有人（登记证）</dt><dd>{current.registeredOwnerName||'未登记'}</dd></div>:null}
   <div><dt>发动机号</dt><dd>{current.engineNumber||'未登记'}</dd></div><div><dt>车身颜色</dt><dd>{current.bodyColor||'未登记'}</dd></div>
   <div><dt>电池归属</dt><dd>{assetLabels[current.batteryOwnership]}</dd></div><div><dt>电池容量</dt><dd>{current.batteryCapacityKwh!=null?current.batteryCapacityKwh+' kWh':'未登记'}</dd></div>
   <div><dt>资产建档</dt><dd>{current.registered?'已登记':'尚未建档'}</dd></div><div><dt>车型年款</dt><dd>{typeof vehicle.modelYear==='number'?vehicle.modelYear:model?.modelYear??'未登记'}</dd></div><div><dt>车辆上牌年份</dt><dd>{typeof vehicle.year==='number'?vehicle.year:'未登记'}</dd></div>
  </dl>
  <h4>采购资料</h4><dl className="asset-facts">
   <div><dt>实际采购金额</dt><dd>{current.purchaseAmount!=null?money(current.purchaseAmount):'未登记'}</dd></div>
   {Object.hasOwn(current,'purchaserName')?<div><dt>购车人</dt><dd>{current.purchaserName||'未登记'}</dd></div>:null}
   <div><dt>采购日期</dt><dd>{current.purchaseDate||'未登记'}</dd></div>
  </dl>
  <h4>里程与日期</h4><dl className="asset-facts">
   <div><dt>初始里程</dt><dd>{current.initialMileageKm!=null?current.initialMileageKm+' km':'未登记'}</dd></div>
   <div><dt>首次登记日期</dt><dd>{current.firstRegistrationDate||'未登记'}</dd></div><div><dt>下次年检日期</dt><dd>{current.nextInspectionDate||'未登记'}</dd></div>
   {current.notes!==undefined?<div><dt>资产备注</dt><dd>{current.notes||'—'}</dd></div>:null}
  </dl>
  {action}
 </>:error?<ErrorNotice error={error} retry={()=>void load().catch(()=>{})}/>:<Loading/>}</section>;
}
