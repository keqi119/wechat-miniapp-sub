/** Read registered vehicle facts only; a model name is never a battery fact. */
export function vehicleBatteryCapacity(value:unknown):string{
 return typeof value==='string'&&/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value))&&Number(value)>0?`${value} kWh`:'未登记';
}
export function vehicleBatteryOwnership(value:unknown):string{
 return value==='OWNED'?'电池买断':value==='BAAS'?'BaaS / 电池租用':'未登记';
}
const vehicleStatuses:Record<string,string>={DRAFT:'草稿',PUBLISHED:'已激活',UNPUBLISHED:'已停用',RESERVED:'已预留',IN_USE:'用车中'};
export function vehicleLedgerStatus(value:unknown):string|undefined{
 return typeof value==='string'?vehicleStatuses[value]:undefined;
}
