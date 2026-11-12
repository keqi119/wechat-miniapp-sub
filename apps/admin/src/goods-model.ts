export type GoodsVersion={id:string;productId?:string;version:number;name:string;status:string};
export type GoodsVehicle={id:string;title:string;vin?:string|null;plateNumber?:string|null;status?:string;catalogPublished?:boolean};
export type GoodsInspectionSnapshot={sourceId:string;sourceRevision:number;title:string;provider?:string|null;inspectedAt?:string|null;description:string;images:{fileId:string;sha256:string;url?:string}[]};
export type Goods={appDisplay?:import('./goods-app-display-model').GoodsAppDisplay;id:string;revision:number;status:'DRAFT'|'PUBLISHED'|'WITHDRAWN';visible:boolean;recommended:boolean;sortOrder:number;source?:'EXPLICIT'|'LEGACY_MIGRATED';vehicleId:string;productVersionId:string;subscriptionPlanId:string;inspectionSelections?:{id:string;revision:number}[];inspectionSnapshots?:GoodsInspectionSnapshot[];vehicle:GoodsVehicle;productVersion:GoodsVersion;plan:{id:string;name:string;months:number;monthlyFeeAmount:number;mileagePerMonthKm:number;excessMileagePriceAmount:number;energyDescription:string;conditions:string;benefits:string[]}};
export function goodsAccess(role:string|undefined,permissions:string[]){
 const operator=['ADMIN','OPERATIONS'].includes(role||''),has=(permission:string)=>permissions.includes('*')||permissions.includes(permission);
 const read=operator&&has('goods.read'),write=read&&has('goods.write');
 return{read,write,create:write&&has('vehicles.read')&&has('products.read')};
}
export function publishedGoodsVersions(products:Array<{id:string;versions?:GoodsVersion[]}>):GoodsVersion[]{
 return products.flatMap(product=>(product.versions||[]).filter(version=>version.status==='PUBLISHED').map(version=>({...version,productId:product.id})));
}
export function goodsDisplayPayload(values:Record<string,unknown>){
 const raw=String(values.sortOrder??'').trim(),sortOrder=Number(raw);
 if(!/^\d+$/.test(raw)||!Number.isSafeInteger(sortOrder)||sortOrder>2147483647)throw new Error('排序值须为有效非负整数');
 return{visible:values.visible===true,recommended:values.recommended===true,sortOrder};
}
export function goodsCreatePayload(values:Record<string,unknown>,versions:GoodsVersion[]){
 const vehicleId=String(values.vehicleId||'').trim(),productVersionId=String(values.productVersionId||'').trim();
 if(!vehicleId)throw new Error('请选择车辆');
 if(!versions.some(version=>version.id===productVersionId&&version.status==='PUBLISHED'))throw new Error('请选择已发布的明确产品版本');
 return{vehicleId,productVersionId,...goodsDisplayPayload(values),revision:0};
}
export function goodsStatusLabel(status:string){return({DRAFT:'方案草稿',PUBLISHED:'方案已上架',WITHDRAWN:'方案已下架'} as Record<string,string>)[status]||'未知状态';}
