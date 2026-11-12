import {assetInteger,type AssetFile,type AssetVehicle} from './asset-model.ts';
export type PlateVehicle=AssetVehicle&{revision:number;plateNumber:string|null};
export type PlateOwner={id:string;name:string;subjectType:string;status:string;revision:number};
type PlatePeriod={id:string;plateId:string;validFrom:string;validUntil:string|null;recordedAt:string;reason:string;endReason:string|null;evidenceFileIds:string[];evidenceSnapshot:AssetFile[]};
export type PlateOwnership=PlatePeriod&{ownerId:string;ownershipRevision:number;previousPeriodId:string|null;owner:PlateOwner|null};
export type PlateBinding=PlatePeriod&{vehicleId:string;bindingRevision:number;previousBindingId:string|null;vehicle:PlateVehicle|null};
export type LicensePlate={id:string;revision:number;plateNumber:string;normalizedNumber:string;plateType:string;region:string;notes:string;status:'ACTIVE'|'ARCHIVED';files:AssetFile[];currentOwnership:PlateOwnership|null;currentBinding:PlateBinding|null;ownershipHistory:PlateOwnership[];bindingHistory:PlateBinding[]};
export type LegacyPlateCandidate={vehicle:PlateVehicle;plateNumber:string;normalizedNumber:string|null;normalizationValid:boolean;duplicateVehicleIds:string[]};
export function plateAccess(role:string|undefined,permissions:string[]){const read=['ADMIN','OPERATIONS'].includes(role||'')&&(permissions.includes('*')||permissions.includes('license-plates.read'));return{read,write:read&&(permissions.includes('*')||permissions.includes('license-plates.write'))};}
const text=(value:unknown,label:string,max:number,required=true)=>{const result=String(value??'').trim();if(required&&!result||result.length>max)throw new Error(`请填写${label}，最多${max}字`);return result;};
const safeText=(value:unknown,label:string,max:number,required=true)=>{const raw=String(value??'');if(/[\p{Cc}\p{Cf}]/u.test(raw))throw new Error(label+'不能包含控制字符');return text(raw,label,max,required);};
export function normalizedPlate(value:string){return value.normalize('NFKC').toUpperCase().replace(/\s/gu,'');}
function active(plate:LicensePlate){if(plate.status!=='ACTIVE')throw new Error('已归档牌照仅供历史查阅');return assetInteger(plate.revision,'牌照版本');}
function base(plate:LicensePlate,reason:string){return{revision:active(plate),reason:text(reason,'办理原因',1000)};}
function evidence(plate:LicensePlate,ids:string[]){if(!Array.isArray(ids)||ids.length<1||ids.length>20||new Set(ids).size!==ids.length||ids.some(id=>!plate.files.some(file=>file.id===id)))throw new Error('请明确选择1至20份本牌照专用凭据');return{fileIds:[...ids]};}
export function plateDraftPayload(values:Record<string,unknown>,current?:LicensePlate){
 const data={plateType:safeText(values.plateType,'牌照类型',100),region:safeText(values.region,'地区',100,false),notes:String(values.notes??'')};if(data.notes.length>5000)throw new Error('备注最多5000字');
 if(current)return{...data,revision:active(current)};const plateNumber=safeText(values.plateNumber,'真实牌照号码',32);if(normalizedPlate(plateNumber).length>32)throw new Error('规范牌照号码最多32字');return{plateNumber,...data,revision:0};
}
export function plateOwnershipPayload(plate:LicensePlate,owner:PlateOwner|undefined,reason:string,ids:string[]){
 if(!owner||!owner.id||owner.status==='SUSPENDED'||plate.currentOwnership?.ownerId===owner.id)throw new Error('请重新核对可用且不同于当前归属的主体');
 return{...base(plate,reason),ownerId:owner.id,ownerRevision:assetInteger(owner.revision,'归属主体版本'),currentOwnershipPeriodId:plate.currentOwnership?.id??null,currentOwnershipRevision:plate.currentOwnership?assetInteger(plate.currentOwnership.ownershipRevision,'当前归属版本'):null,...evidence(plate,ids)};
}
function bindingVehicle(plate:LicensePlate,vehicle:PlateVehicle|undefined){const binding=plate.currentBinding;if(!binding||!vehicle||vehicle.id!==binding.vehicleId||typeof vehicle.plateNumber!=='string'||normalizedPlate(vehicle.plateNumber)!==plate.normalizedNumber)throw new Error('请重新核对当前绑定及旧车真实牌号');return vehicle;}
export function plateBindPayload(plate:LicensePlate,target:PlateVehicle|undefined,old:PlateVehicle|undefined,reason:string,ids:string[],acknowledged=false){
 if(!acknowledged||!target||!target.id||target.id===plate.currentBinding?.vehicleId)throw new Error('请明确核对本次目标车辆及绑定变化');const current=plate.currentBinding,previous=current?bindingVehicle(plate,old):null;
 return{...base(plate,reason),vehicleId:target.id,vehicleRevision:assetInteger(target.revision,'目标车辆版本'),currentBindingId:current?.id??null,currentBindingRevision:current?assetInteger(current.bindingRevision,'当前绑定版本'):null,oldVehicleId:previous?.id??null,oldVehicleRevision:previous?assetInteger(previous.revision,'旧车辆版本'):null,...evidence(plate,ids)};
}
export function plateUnbindPayload(plate:LicensePlate,vehicle:PlateVehicle|undefined,reason:string,acknowledged=false){if(!acknowledged)throw new Error('请明确核对当前车辆及解绑影响');const current=plate.currentBinding,checked=bindingVehicle(plate,vehicle);return{...base(plate,reason),bindingId:current!.id,bindingRevision:assetInteger(current!.bindingRevision,'当前绑定版本'),vehicleRevision:assetInteger(checked.revision,'当前车辆版本')};}
export function plateClearLegacyPayload(plate:LicensePlate,vehicle:PlateVehicle|undefined,reason:string,ids:string[],acknowledged=false){
 if(!acknowledged||!vehicle||typeof vehicle.plateNumber!=='string'||!vehicle.plateNumber.length||vehicle.plateNumber.length>500||normalizedPlate(vehicle.plateNumber)!==plate.normalizedNumber||plate.currentBinding?.vehicleId===vehicle.id)throw new Error('请核实为本牌照的错误旧显示文本；有效绑定须正式解绑');
 return{...base(plate,reason),vehicleId:vehicle.id,vehicleRevision:assetInteger(vehicle.revision,'旧记录车辆版本'),plateNumber:vehicle.plateNumber,...evidence(plate,ids)};
}
export function plateArchivePayload(plate:LicensePlate,reason:string){if(plate.currentBinding)throw new Error('尚有有效车辆绑定，请先明确解绑');return base(plate,reason);}
