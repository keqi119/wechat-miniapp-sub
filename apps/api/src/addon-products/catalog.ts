import {HttpException} from '@nestjs/common';
import {ensure} from '../common/errors';
import {currentAssignment} from '../vehicle-changes/assignments';
import {currentPhysicalReceipt} from '../offline-documents/vehicle-receipt';
import {day,shanghaiDay} from '../usage/rules';
import {readSwapSourceAt} from '../order-service-stages/swap-source';
import {addonTerms,quoteMatches,versionHash,kindInput} from './policy';
import {lockAddonCatalog} from './service';
export async function addonContext(tx:any,order:any,now:Date){
 const account=await tx.usageAccount.findUnique({where:{orderId:order.id}});ensure(order.status==='ACTIVE'&&account&&account.customerId===order.customerId&&!account.returnedOn&&account.packStatus==='ACTIVE'&&!await currentPhysicalReceipt(tx,order.id),409,'ADDON_UNAVAILABLE','仅本人正在履行且未收车的主套餐可加购');
 const source=await readSwapSourceAt(tx,order,account,now),assignment=await currentAssignment(tx,order);
 ensure(assignment?.customerId===order.customerId&&assignment.startAt<=now&&!assignment.endAt&&assignment.vehicle?.modelDefinitionId,409,'ADDON_ASSIGNMENT','缺少本人当前实际在用车辆');
 const model=await tx.modelDefinition.findUnique({where:{id:assignment.vehicle.modelDefinitionId}});ensure(model,409,'ADDON_MODEL','当前车辆真实车型不存在');
 const today=shanghaiDay(now),periods=await tx.usagePeriod.findMany({where:{accountId:account.id,startDate:{lte:new Date(today)},effectiveEndDate:{gt:new Date(today)},status:{notIn:['SETTLED','CANCELLED']}}});
 ensure(periods.length===1,409,'PERIOD_CLOSED','当前计费月不存在、已结算或范围冲突');const period=periods[0];ensure(period.customerId===undefined||period.customerId===order.customerId,409,'ADDON_OWNER','计费月归属异常');
 ensure(period.orderId===order.id&&(source.serviceStageId===null?period.serviceStageId===null||period.serviceStageId===undefined:period.serviceStageId===source.serviceStageId),409,'ADDON_STAGE','当前计费月与实际服务段不符');
 return{account,period,source,assignment,model,context:{periodId:period.id,startDate:day(period.startDate),endDate:day(period.effectiveEndDate),expiresAt:new Date(day(period.effectiveEndDate)+'T00:00:00+08:00').toISOString(),serviceStageId:source.serviceStageId,assignmentId:assignment.id,modelDefinitionId:model.id,modelName:model.name,brand:model.brand}};
}
export async function addonCatalog(tx:any,order:any,kind:string,now:Date,targetModelDefinitionId?:string){
 kindInput.parse(kind);await lockAddonCatalog(tx);const c=await addonContext(tx,order,now),targetModels=kind==='SWAP_CREDIT'?await tx.modelDefinition.findMany({select:{id:true,brand:true,name:true},orderBy:[{brand:'asc'},{name:'asc'}]}):[];
 const model=kind==='MILEAGE_PACK'?c.model:targetModelDefinitionId?targetModels.find((m:any)=>m.id===targetModelDefinitionId):null;
 ensure(!targetModelDefinitionId||model,400,'ADDON_MODEL','目标车型不存在');const versions=await tx.addonProductVersion.findMany({where:{kind,status:'PUBLISHED'},orderBy:{id:'asc'}}),products:any[]=[];
 for(const v of versions){ensure(v.sourceHash===versionHash(v),409,'ADDON_SOURCE','已发布商品来源摘要异常');const quotes=model?quoteMatches(v.scopePrices,model):[];if(quotes.length)products.push({productId:v.productId,name:v.name,versionId:v.id,version:v.version,sourceHash:v.sourceHash,quotes});}
 ensure(products.length<=1,409,'ADDON_AMBIGUOUS_PRICE','该车型存在多个有效报价，请联系平台核对');
 return{orderId:order.id,kind,eligible:true,blockers:[],context:{...c.context,...(targetModelDefinitionId?{targetModelDefinitionId}:{}),...(kind==='SWAP_CREDIT'?{expiresAt:c.source.endAt.toISOString()}: {})},terms:addonTerms(kind),products,targetModels};
}
export async function customerAddonCatalog(tx:any,orderId:string,customerId:string,kind:string,now:Date,target?:string){
 const order=await tx.order.findFirst({where:{id:orderId,customerId}});ensure(order,404,'NOT_FOUND','本人订单不存在');
 try{return await addonCatalog(tx,order,kind,now,target);}catch(e){if(!(e instanceof HttpException))throw e;const error=(e.getResponse() as any)?.error;if(!error||e.getStatus()===400)throw e;return{orderId,kind,eligible:false,blockers:[{code:error.code,message:error.message}],context:null,terms:addonTerms(kind),products:[],targetModels:[]};}
}
export async function resolveAddonQuote(tx:any,order:any,kind:string,input:any,now:Date){
 const result=await addonCatalog(tx,order,kind,now,input.targetModelDefinitionId),product=result.products.find(p=>p.productId===input.productId&&p.versionId===input.versionId&&p.sourceHash===input.sourceHash),quote=product?.quotes.find((q:any)=>q.quoteId===input.quoteId);
 ensure(product&&quote,409,'ADDON_QUOTE_CHANGED','商品已更新或不再适用，请重新读取报价');ensure(input.termsVersion===result.terms.version&&input.termsHash===result.terms.hash&&input.accepted===true,409,'ADDON_CONSENT','请阅读并主动同意当前独立加购说明');
 if(kind==='MILEAGE_PACK')ensure(input.periodId===result.context.periodId,409,'PERIOD_CLOSED','当前计费月已变化，请重新读取报价');
 const version=await tx.addonProductVersion.findUnique({where:{id:product.versionId}});return{orderId:order.id,customerId:order.customerId,product,version,quote,context:result.context,terms:result.terms};
}
