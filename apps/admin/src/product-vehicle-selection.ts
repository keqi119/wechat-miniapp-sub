export type VehicleFilters=Partial<Record<'registeredOwnerName'|'brand'|'model'|'modelYear'|'ageMonthsMin'|'ageMonthsMax'|'mileageKmMin'|'mileageKmMax'|'plateNumber'|'vin'|'batteryOwnership'|'batteryCapacityKwh',string>>;
export function vehicleFilterQuery(filters:VehicleFilters):URLSearchParams{
 const query=new URLSearchParams();
 const ownership=(filters.batteryOwnership||'').trim();if(ownership){if(!['OWNED','BAAS'].includes(ownership))throw new Error('请选择电池方式：电池买断或BaaS租用');query.set('batteryOwnership',ownership);}
 const capacity=(filters.batteryCapacityKwh||'').trim();if(capacity){const number=Number(capacity);if(!/^\d+(\.\d{1,3})?$/.test(capacity)||number<=0||number>99999.999)throw new Error('电池规格请输入大于0的kWh数值，最多三位小数');query.set('batteryCapacityKwh',String(number));}
 for(const key of ['registeredOwnerName','brand','model','plateNumber','vin'] as const){const value=(filters[key]||'').trim();if(value.length>200)throw new Error('筛选文字最多200字');if(value)query.set(key,value);}
 for(const key of ['modelYear','ageMonthsMin','ageMonthsMax','mileageKmMin','mileageKmMax'] as const){const value=(filters[key]||'').trim();if(!value)continue;const number=Number(value);if(!/^\d+$/.test(value)||!Number.isSafeInteger(number)||number>2147483647)throw new Error('年款、车龄和公里数请输入有效非负整数');if(key==='modelYear'&&(number<1900||number>2100))throw new Error('年款须为1900至2100');query.set(key,String(number));}
 for(const [min,max] of [['ageMonthsMin','ageMonthsMax'],['mileageKmMin','mileageKmMax']])if(query.has(min)&&query.has(max)&&Number(query.get(min))>Number(query.get(max)))throw new Error('范围最小值不能大于最大值');
 return query;
}
export function mergeVehicleSelection(current:readonly string[],matching:readonly string[],mode:'add'|'remove'):string[]{
 const set=new Set(matching),result=mode==='add'?[...new Set([...current,...matching])]:current.filter(id=>!set.has(id));
 if(result.length>1000)throw new Error('单个产品最多适配1000辆车，请缩小筛选范围');
 return result;
}
export async function loadMatchingVehicleIds(fetchPage:(page:number)=>Promise<{items:{id:string}[];total:number}>,signal:AbortSignal):Promise<string[]>{
 const ids:string[]=[],seen=new Set<string>();let expected:number|undefined;
 for(let page=1;;page++){
  signal.throwIfAborted();const result=await fetchPage(page);signal.throwIfAborted();
  if(!Number.isSafeInteger(result.total)||result.total<0)throw new Error('车辆结果不完整，请重新查询');
  if(result.total>1000)throw new Error('单个产品最多适配1000辆车，请缩小筛选范围');
  if(expected!==undefined&&expected!==result.total)throw new Error('车辆范围已变化，请重新查询');expected=result.total;
  for(const item of result.items){if(!item.id||seen.has(item.id))throw new Error('车辆结果出现重复，请重新查询');seen.add(item.id);ids.push(item.id);}
  if(ids.length===expected)return ids;
  if(!result.items.length||ids.length>expected)throw new Error('车辆结果不完整，请重新查询');
 }
}
