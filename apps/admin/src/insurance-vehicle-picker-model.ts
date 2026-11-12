import type {Page} from './core.ts';
import type {PolicyVehicle} from './insurance-registration.ts';

export const insuranceVehiclePageSize=100;
export function insuranceVehicleLabel(car:PolicyVehicle){return [car.plateNumber,car.title,car.vin].map(value=>value?.trim()||'未登记').join(' · ');}
export function checkedInsuranceVehiclePage(raw:Page<PolicyVehicle>,page:number,size=insuranceVehiclePageSize):Page<PolicyVehicle>{
 if(!raw||raw.page!==page||raw.pageSize!==size||!Number.isSafeInteger(raw.total)||raw.total<0||!Array.isArray(raw.items)||raw.items.length!==Math.min(size,Math.max(0,raw.total-(page-1)*size))||raw.items.some(car=>!car||typeof car.id!=='string'||!car.id)||new Set(raw.items.map(car=>car.id)).size!==raw.items.length)throw Error('车辆检索分页不完整，请重新读取');
 return raw;
}
