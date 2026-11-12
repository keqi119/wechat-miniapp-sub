import {HttpException} from '@nestjs/common';
import type {StaffActor} from '../auth/staff.types';
import {requireAssetFiles,readBaasRegistrationPdfFiles,type AssetFileManifest} from '../files/asset-files';
import {dateOnly} from '../asset-costs/types';

const present=(value:unknown)=>typeof value==='string'&&value.trim().length>0;
const normalizedName=(value:string)=>value.normalize('NFKC').replace(/\s+/gu,'');
export function actualBaasContractNumber(row:any):string|null{
 if(present(row.supplierContractNumber))return row.supplierContractNumber.trim();
 return present(row.contractNumber)&&!/^BAAS-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.contractNumber.trim())?row.contractNumber.trim():null;
}
export type BaasRegistrationCache={vehicles:Map<string,Promise<any>>;profiles:Map<string,Promise<any>>;payers:Map<string,Promise<any>>};
export const registrationCache=():BaasRegistrationCache=>({vehicles:new Map(),profiles:new Map(),payers:new Map()});
function cached(cache:Map<string,Promise<any>>,key:string,read:()=>Promise<any>){if(!cache.has(key))cache.set(key,read());return cache.get(key)!;}
export async function readBaasRegistration(tx:any,row:any,actor?:StaffActor,cache=registrationCache()){
 const [vehicle,profile,payer,allFiles]=await Promise.all([
  cached(cache.vehicles,row.vehicleId,()=>tx.vehicle.findUnique({where:{id:row.vehicleId}})),cached(cache.profiles,row.vehicleId,()=>tx.vehicleAssetProfile.findUnique({where:{vehicleId:row.vehicleId}})),
  row.payerOwnerId?cached(cache.payers,row.payerOwnerId,()=>tx.vehicleOwner.findUnique({where:{id:row.payerOwnerId}})):null,
  actor?requireAssetFiles(tx,actor,{kind:'BAAS',resourceId:row.id}):readBaasRegistrationPdfFiles(tx,row.id),
 ]);
 const files:AssetFileManifest[]=allFiles.filter((file:AssetFileManifest)=>file.mimeType==='application/pdf'),number=actualBaasContractNumber(row),start=row.effectiveFrom?dateOnly(row.effectiveFrom):null;
 const item=(key:string,label:string,field:string,passed:boolean,message:string)=>({key,label,field,passed,message:passed?'':message});
 const checks=[
  item('VIN','对应车架号','vehicleId',vehicle?.id===row.vehicleId&&/^[A-HJ-NPR-Z0-9]{17}$/.test(vehicle?.vin||''),'请在车辆资料中登记17位有效车架号'),
  item('CONTRACT_NUMBER','BaaS合同编号','supplierContractNumber',!!number,'请填写原件上的BaaS实际合同编号'),
  item('LESSEE','承租人','lesseeName',present(row.lesseeName)&&present(profile?.registeredOwnerName)&&normalizedName(row.lesseeName)===normalizedName(profile.registeredOwnerName),'承租人须与登记证车主一致，请核对车辆登记所有人'),
  item('PROVIDER','电池出租公司','provider',present(row.provider),'请填写电池出租公司'),
  item('START_DATE','起租时间','effectiveFrom',!!start,'请填写起租时间'),
  item('MONTHLY_RENT','月租价','rentalAmount',row.billingCycle==='MONTHLY'&&Number.isSafeInteger(row.rentalAmount)&&row.rentalAmount>0,'请登记真实月租价并使用月付；原季度或年度金额不会自动换算'),
  item('PAYMENT_DAY','每月支付日','paymentDayOfMonth',Number.isInteger(row.paymentDayOfMonth)&&row.paymentDayOfMonth>=1&&row.paymentDayOfMonth<=31,'请填写每月支付日（1至31日）'),
  item('PAYER','代付人','payerOwnerId',!!payer&&payer.id===row.payerOwnerId&&payer.status!=='SUSPENDED','请从系统合作商主数据中明确选择未停用的代付人'),
  item('SIGNED_PDF','已签署PDF','files',files.length>0,'请上传本合同已签署的有效PDF材料'),
 ];
 const readiness={ready:checks.every(check=>check.passed),checks,missingFields:checks.filter(check=>!check.passed).map(check=>check.key),financialCycle:row.billingCycle??null,monthlyRentAmount:row.billingCycle==='MONTHLY'?row.rentalAmount??null:null,signedPdfFiles:files};
 return{vehicle,profile,payer:payer&&payer.status!=='SUSPENDED'?{id:payer.id,name:payer.name}:null,actualContractNumber:number,readiness};
}
export function requireBaasRegistration(value:Awaited<ReturnType<typeof readBaasRegistration>>){if(!value.readiness.ready)throw new HttpException({error:{code:'BAAS_REGISTRATION_INCOMPLETE',message:'请补齐并核对BaaS八项登记及签署PDF材料',missingFields:value.readiness.missingFields,checks:value.readiness.checks}},409);}
