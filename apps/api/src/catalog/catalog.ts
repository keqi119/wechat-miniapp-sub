import { locationCapabilities } from '../applications/handover-location';
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { Db } from '../common/db';
import { ensure } from '../common/errors';
import { fen, pagination } from '../common/data';
import {productVersionInclude} from '../products/types';
import {newOrderContractMode} from '../offline-documents/mode';
import {catalogAppDisplay,catalogPlanSource} from './app-display';
import {publicInspectionViews} from '../vehicle-inspections/service';
import {publicBasicCondition} from '../vehicles/basic-condition-snapshot';
const planInclude={listing:true,productVersion:{include:productVersionInclude}};
export const catalogVehicleInclude={plans:{where:{active:true},include:planInclude},modelDefinition:true};
export function vehicleView(v: any) {
  // Historical/current-order projections have no new-application eligibility
  // facts. OFFLINE callers must use catalogVehicleViews to enable applications.
  return presentVehicle(v,newOrderContractMode()!=='OFFLINE');
}
function presentVehicle(v:any,cooperationEligible:boolean,pricedPlans:any[]=v.plans||[]){
  const prices = pricedPlans.map((p:any)=>planView(p,true,v)).filter((p: any) => p.available).map((p: any) => p.monthlyFeeAmount);
  const disclosed=[...(v.plans||[])].filter((p:any)=>{const view=planView(p,false,v);return 'active' in view&&view.active;}).sort((a:any,b:any)=>new Date(b.listing.publishedAt||0).getTime()-new Date(a.listing.publishedAt||0).getTime()||String(b.listing.id).localeCompare(String(a.listing.id))).map((p:any)=>publicBasicCondition(p.listing.basicConditionSnapshot,v.id)).filter(Boolean),basicCondition=disclosed[0]??null;
  return presentCatalogVehicle(v,cooperationEligible,prices,basicCondition);
}
/** Shared public fields; callers supply validated public plan prices and disclosures. */
export function presentCatalogVehicle(v:any,cooperationEligible:boolean,prices:number[],basicCondition:any){
  const minFeeAmount=prices.length?Math.min(...prices):null;
  const available=v.status==='PUBLISHED'&&!v.reservedOrderId&&!v.holdId&&!!prices.length&&cooperationEligible;
  const conditionDisclosure=basicCondition?[`火烧：${basicCondition.fireDamage?'是':'否'}`,`泡水：${basicCondition.floodDamage?'是':'否'}`,`结构损伤：${basicCondition.structuralDamage?'是':'否'}`,v.conditionDisclosure||''].filter(Boolean).join('；'):v.conditionDisclosure;
  return { id:v.id,brand:v.brand,model:v.model,title:v.title,year:v.year,city:v.city,mileageKm:v.mileageKm,batteryHealthPercent:v.batteryHealthPercent,description:v.description,conditionDisclosure,basicCondition,coverFileId:v.coverFileId,mediaFileIds:v.mediaFileIds,status:v.status, name: v.title, registrationText: `${v.year} 年上牌`, mileageText: `${v.mileageKm.toLocaleString('zh-CN')} km`, rangeText: '', bodyType: v.modelDefinition?.bodyType || '', available, statusText:available?'可申请':'暂不可申请', imageUrl: v.coverFileId ? `/api/public/media/${v.coverFileId}` : '', minFeeAmount, minFeeText: fen(minFeeAmount), tagline: v.description };
}
/** Reused by public list/detail and the authenticated home recommendation. */
export async function catalogVehicleViews(db:any,v:any,at:Date=new Date()){
 const plans=[...(v.plans||[])].sort((a:any,b:any)=>Number(!!b.listing?.recommended)-Number(!!a.listing?.recommended)||(a.listing?.sortOrder??0)-(b.listing?.sortOrder??0)||String(a.id).localeCompare(String(b.id)));
 const eligible=await Promise.all(plans.map(async(p:any)=>(await catalogAppDisplay(db,p,v,at)).available));
 const anyEligible=eligible.some(Boolean),vehicle=presentVehicle(v,anyEligible,anyEligible?plans.filter((_p:any,index:number)=>eligible[index]):plans);
 const publicPlans=await Promise.all(plans.map(async(p:any,index:number)=>{const view:any=planView(p,eligible[index],v);return view.active?{...view,inspections:await publicInspectionViews(db,p.listing,v.id)}:view;}));
 return{vehicle,plans:publicPlans.filter((p:any)=>p.active)};
}
/** Admission is based on current public goods, independent of application eligibility. */
function hasPublicCatalogPlan(v:any){return !v?.virtualAcceptanceScopeId&&v?.status==='PUBLISHED'&&v.catalogPublished===true&&(v.plans||[]).some((p:any)=>catalogPlanSource(p,v).snapshot!==null);}
/** Filter the shared public directory before pagination/recommendation limits.
 * Only the final page performs DB-backed cooperation eligibility checks. */
export async function readPublicCatalog(db:any,query:any={},at:Date=new Date()){
 const p=pagination(query),rows=await db.vehicle.findMany({where:{status:'PUBLISHED',virtualAcceptanceScopeId:null},include:catalogVehicleInclude,orderBy:[{createdAt:'desc'},{id:'asc'}]});
 const visible=rows.filter(hasPublicCatalogPlan),brands=[...new Set<string>(visible.map((v:any)=>v.brand))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
 const keyword=query.keyword?String(query.keyword).toLocaleLowerCase():'',filtered=visible.filter((v:any)=>(!query.brand||query.brand==='全部'||v.brand===query.brand)&&(!keyword||['title','brand','model','city'].some(k=>String(v[k]??'').toLocaleLowerCase().includes(keyword))));
 const page=filtered.slice(p.skip,p.skip+p.take),items=await Promise.all(page.map(async(v:any)=>(await catalogVehicleViews(db,v,at)).vehicle));
 return{items,total:filtered.length,page:p.page,pageSize:p.pageSize,brands};
}
export function planView(p: any, available = true,vehicle:any=p.vehicle||{id:p.vehicleId}) {
 const {snapshot:s}=catalogPlanSource(p,vehicle);if(!s)return {id:p.id,vehicleId:p.vehicleId,available:false};
 return presentCatalogPlan(p,s,available);
}
/** Price and terms always come from the validated immutable product source. */
export function presentCatalogPlan(p:any,s:any,available=false){
 const modules=s.configurationVersion===2?{configurationVersion:2,baseFeeAmount:s.baseFeeAmount,mileageMonthlyFeeAmount:s.mileageMonthlyFeeAmount,swapPolicy:s.swapPolicy}:{};
 return {...modules,basicCondition:publicBasicCondition(p.listing?.basicConditionSnapshot,p.vehicleId),id:p.id,vehicleId:p.vehicleId,listingId:s.listingId,listingRevision:s.listingRevision,sourceHash:s.sourceHash,productId:s.productId,productVersionId:s.productVersionId,productVersionNumber:s.version,name:s.name,title:s.name,months:s.months,termMonths:s.months,monthlyFeeAmount:s.monthlyFeeAmount,monthlyFeeText:fen(s.monthlyFeeAmount),mileagePerMonthKm:s.mileagePerMonthKm,excessMileagePriceAmount:s.excessMileagePriceAmount,mileageText:`每月 ${s.mileagePerMonthKm} 公里`,energyDescription:s.energyDescription,energyText:s.energyDescription,benefits:s.benefits.map((b:any)=>b.name),benefitDetails:s.benefits,conditions:s.conditions,depositText:'审核后确认',notes:s.conditions,active:true,available:!!available};
}
@Controller('public')
export class CatalogController {
  constructor(@Inject(Db) private db: Db) {}
  @Get('handover-location') handoverLocation() { return locationCapabilities(this.db); }
  @Get('vehicles') async vehicles(@Query() query: any) {
    return readPublicCatalog(this.db,query);
  }
  @Get('vehicles/:id') async vehicle(@Param('id') id: string) {
    const v = await this.db.vehicle.findFirst({ where: { id, status: 'PUBLISHED',virtualAcceptanceScopeId:null }, include:catalogVehicleInclude }); ensure(v, 404, 'NOT_FOUND', '车辆不存在或已下架');
    ensure(hasPublicCatalogPlan(v),404,'NOT_FOUND','车辆暂无已发布可见商品');
    const {vehicle:view,plans}=await catalogVehicleViews(this.db,v);
    return {vehicle:view,plans,report:catalogVehicleReport(v,view)};
  }
  @Get('model-definitions') async models() { const items = await this.db.modelDefinition.findMany({ orderBy: { brand: 'asc' } }); return { items, total: items.length, page: 1, pageSize: items.length }; }
  @Get('legal/:type') async legal(@Param('type') type: string) { const doc = await this.db.legalDocument.findFirst({ where: { type, status: 'PUBLISHED' }, orderBy: { version: 'desc' } }); ensure(doc, 404, 'NOT_FOUND', '正式协议尚未发布'); return doc; }
}

export function catalogVehicleReport(v:any,view:any){
    const basics=view.basicCondition?[{label:'是否火烧',value:view.basicCondition.fireDamage?'是':'否'},{label:'是否泡水',value:view.basicCondition.floodDamage?'是':'否'},{label:'是否结构损伤',value:view.basicCondition.structuralDamage?'是':'否'}]:[];
    return { summary: '车辆披露资料', items: [...basics,{ label: '车况披露', value: view.conditionDisclosure }, { label: '最近里程', value: view.mileageText }, { label: '电池健康度', value: v.batteryHealthPercent == null ? '未提供' : `${v.batteryHealthPercent}%` }].map(item=>({...item,title:item.label,description:item.value})), notice: '最终交付车况以双方确认的交接记录为准。' };
}
