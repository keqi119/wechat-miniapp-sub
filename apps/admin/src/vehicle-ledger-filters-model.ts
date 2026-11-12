export const vehicleLedgerFilterKeys=['cooperationOwnerId','batteryOwnership','mileageKmMin','mileageKmMax','ageMonthsMin','ageMonthsMax'] as const;
export type VehicleLedgerFilters=Partial<Record<typeof vehicleLedgerFilterKeys[number],string>>;
export function vehicleLedgerFilters(value:VehicleLedgerFilters):VehicleLedgerFilters{
 const result:VehicleLedgerFilters={};for(const key of vehicleLedgerFilterKeys){const raw=String(value[key]??'').trim();if(!raw)continue;
  if(key==='cooperationOwnerId'){if(!/^[A-Za-z0-9_-]{1,128}$/.test(raw))throw Error('请选择实际合作商');result[key]=raw;}
  else if(key==='batteryOwnership'){if(!['OWNED','BAAS'].includes(raw))throw Error('请选择电池方式');result[key]=raw;}
  else{if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)>2147483647)throw Error('公里数与车龄（月）请输入有效非负整数');if((key==='ageMonthsMin'||key==='ageMonthsMax')&&Number(raw)>120000)throw Error('车龄范围不能超过120000个月');result[key]=String(Number(raw));}
 }
 for(const [min,max] of [['mileageKmMin','mileageKmMax'],['ageMonthsMin','ageMonthsMax']] as const)if(result[min]!==undefined&&result[max]!==undefined&&Number(result[min])>Number(result[max]))throw Error('范围下限不能大于上限');
 return result;
}
export function vehicleLedgerFilterQuery(value:VehicleLedgerFilters){return new URLSearchParams(vehicleLedgerFilters(value));}
