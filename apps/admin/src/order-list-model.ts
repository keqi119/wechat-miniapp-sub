const text=(v:unknown)=>typeof v==='string'?v.trim():'';
export function orderListCell(row:Record<string,unknown>,key:string):string[]{
 if(key==='vehicle'){
  const car=row.vehicle&&typeof row.vehicle==='object'?row.vehicle as Record<string,unknown>:null;
  if(!car)return ['车辆待核'];
  return[text(car.plateNumber)||'车牌待核',[text(car.brand)||'品牌待核',text(car.model)||'车型待核'].join(' ')==='品牌待核 车型待核'?'品牌车型待核':[text(car.brand)||'品牌待核',text(car.model)||'车型待核'].join(' '),text(car.vin)?'VIN：'+text(car.vin):'VIN 待核'];
 }
 if(key==='productName')return[text(row.productName)||'产品待核'];
 if(key==='months')return[Number.isSafeInteger(row.months)&&Number(row.months)>0?`${row.months} 个月`:'期限待核'];
 if(key==='monthlyFeeAmount')return[Number.isSafeInteger(row.monthlyFeeAmount)&&Number(row.monthlyFeeAmount)>=0?'¥'+(Number(row.monthlyFeeAmount)/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):'月费待核'];
 return[];
}

export function orderVehicleContext(value:unknown):string{return value==='CURRENT'?'当前用车':value==='SWAP_RETURNED'?'已收回／待新车交付':value==='LAST'?'最后实际用车':value==='CONFIRMED'?'已确认待交付':'车辆待核';}
