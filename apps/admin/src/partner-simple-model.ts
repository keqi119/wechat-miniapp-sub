export function partnerPercentageToBps(value:unknown):number|null{
 const input=String(value??'').trim();if(!input)return null;
 const text=input.replace(/[%％]$/,'').trim();
 if(!/^\d+(\.\d{1,2})?$/.test(text))throw new Error('合作商比例须为0%至100%，最多两位小数');
 const [whole,fraction='']=text.split('.'),bps=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 if(bps>10000n)throw new Error('合作商比例不可超过100%');return Number(bps);
}
export type VehicleAgreementAssignment={vehicleId:string;agreementId:string;revision:number;active:boolean;ownerName?:string;agreementTitle?:string};
/** Effective owner-scoped bindings are distinct from global replacement candidates. */
export function currentPartnerVehicles(owner:Record<string,any>,inventory:Record<string,any>[]){
 const found=new Map<string,Record<string,any>>();
 for(const binding of Array.isArray(owner.vehicles)?owner.vehicles:[]){
  if(binding?.ownerId!==owner.id||binding.active!==true||typeof binding.vehicleId!=='string'||!binding.vehicleId)continue;
  const vehicle=binding.vehicle?.id===binding.vehicleId?binding.vehicle:inventory.find(row=>row.id===binding.vehicleId);
  found.set(binding.vehicleId,vehicle||{id:binding.vehicleId});
 }
 return [...found.values()];
}
/** Pending registration is a separate server projection, never the global vehicle picker. */
export function pendingPartnerVehicles(owner:Record<string,any>){
 const effective=new Set(currentPartnerVehicles(owner,[]).map(vehicle=>vehicle.id)),found=new Map<string,Record<string,any>>();
 for(const row of Array.isArray(owner.pendingVehicles)?owner.pendingVehicles:[]){
  if(row?.ownerId!==owner.id||row.active!==false||row.status!=='DRAFT'||typeof row.vehicleId!=='string'||!row.vehicleId||row.vehicle?.id!==row.vehicleId||effective.has(row.vehicleId)||found.has(row.vehicleId))continue;
  found.set(row.vehicleId,row);
 }
 return [...found.values()];
}
export function simpleAgreementBody(values:Record<string,any>,status:'ACTIVE'|'DRAFT',agreement:{id:string;revision:number}|null,assignments:VehicleAgreementAssignment[],confirmed:string[]){
 const fileIds=Array.isArray(values.fileIds)?values.fileIds:[],vehicleIds=Array.isArray(values.vehicleIds)?values.vehicleIds:[],partnerRateBps=partnerPercentageToBps(values.percentage);
 if(status==='ACTIVE'){
  if(!fileIds.length)throw new Error('请上传协议文件');
  if(partnerRateBps===null)throw new Error('请填写合作商分润比例，0%请明确填写0');
  if(!vehicleIds.length)throw new Error('请至少选择一辆车');
 }
 const competing=status==='ACTIVE'?assignments.filter(row=>row.active&&vehicleIds.includes(row.vehicleId)&&row.agreementId!==agreement?.id):[];
 if(competing.some(row=>!confirmed.includes(row.vehicleId)))throw new Error('请逐车确认替换当前协议后再保存');
 return{...(agreement?{agreementId:agreement.id}:{}),revision:agreement?.revision||0,status,title:String(values.title||'').trim(),referenceNumber:String(values.referenceNumber||'').trim(),fileIds,vehicleIds,partnerRateBps,validFrom:values.validFrom||null,validUntil:values.validUntil||null,notes:String(values.notes||'').trim(),replacements:competing.map(({vehicleId,agreementId,revision})=>({vehicleId,agreementId,revision}))};
}
export function monthRange(at=new Date()){
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(at),[year,month]=day.split('-').map(Number);
 return{from:`${year}-${String(month).padStart(2,'0')}-01`,to:new Date(Date.UTC(year,month,0)).toISOString().slice(0,10)};
}
export function revenueFilterOptions(agreements:Record<string,any>[],vehicles:Record<string,any>[],filters:Record<string,any>={}){
 const scope=new Set<string>(agreements.flatMap(agreement=>(agreement.versions||[]).flatMap((version:any)=>version.vehicleIds||[]))),current=vehicles.filter(vehicle=>scope.has(vehicle.id));
 const agreementRows=new Map<string,any>(agreements.map(agreement=>[agreement.id,{id:agreement.id,title:agreement.currentVersion?.displayTitle||agreement.currentVersion?.title||agreement.latestVersion?.displayTitle||agreement.latestVersion?.title||'未命名协议'}]));
 const modelRows=new Map<string,any>(current.filter(vehicle=>vehicle.modelDefinitionId).map(vehicle=>[vehicle.modelDefinitionId,{id:vehicle.modelDefinitionId,name:vehicle.modelDefinition?.name||vehicle.model}]));
 const vehicleRows=new Map<string,any>(current.map(vehicle=>[vehicle.id,vehicle]));
 for(const agreement of filters.agreements||[])agreementRows.set(agreement.id,agreement);
 for(const model of filters.models||[])modelRows.set(model.id,model);
 for(const vehicle of filters.vehicles||[])vehicleRows.set(vehicle.id,{...vehicle,model:modelRows.get(vehicle.modelId)?.name});
 return{agreements:[...agreementRows.values()],models:[...modelRows.values()],vehicles:[...vehicleRows.values()]};
}
