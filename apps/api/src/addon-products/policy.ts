import {z} from 'zod';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
export const kindInput=z.enum(['MILEAGE_PACK','SWAP_CREDIT']);
const label=z.string().trim().min(1).max(200).refine(v=>!v.includes('\0'));
export const scopeInput=z.object({brand:label,allModels:z.boolean(),modelDefinitionIds:z.array(label).max(500)}).strict().refine(s=>s.allModels?s.modelDefinitionIds.length===0:s.modelDefinitionIds.length>0);
export const scopePricesInput=z.array(z.object({id:label,scopes:z.array(scopeInput).min(1).max(100),prices:z.array(z.union([z.object({km:z.number().int(),amount:z.number().int().positive().max(2147483647)}).strict(),z.object({quantity:z.literal(1),amount:z.number().int().positive().max(2147483647)}).strict()])).max(3)}).strict()).max(100);
export function validateScopePrices(kind:string,raw:any){
 const groups=scopePricesInput.parse(raw);ensure(groups.length>0,409,'ADDON_PRICE_REQUIRED','请完整登记适用范围与价格');
 ensure(new Set(groups.map(g=>g.id)).size===groups.length,400,'ADDON_SCOPE_DUPLICATE','范围编号不可重复');
 for(const g of groups){
  ensure(g.scopes.every(s=>new Set(s.modelDefinitionIds).size===s.modelDefinitionIds.length),400,'ADDON_SCOPE_DUPLICATE','车型不可重复');
  if(kind==='MILEAGE_PACK'){
   const p=[...g.prices].sort((a:any,b:any)=>a.km-b.km) as any[];
   ensure(p.length===3&&p.every((v,i)=>v.km===[1000,1500,2000][i])&&BigInt(p[0].amount)*1500n>BigInt(p[1].amount)*1000n&&BigInt(p[1].amount)*2000n>BigInt(p[2].amount)*1500n,409,'ADDON_UNIT_PRICE','里程包必须完整设置1000、1500、2000公里且单位公里价格严格递减');
  }else ensure(kind==='SWAP_CREDIT'&&g.prices.length===1&&(g.prices[0] as any).quantity===1,409,'ADDON_QUANTITY','换车权益每次购买1次');
 }
 return groups;
}
export function scopeMatches(scopes:any[],model:{id:string;brand:string}){return scopes.some(s=>s.brand===model.brand&&(s.allModels===true||s.modelDefinitionIds.includes(model.id)));}
export function quoteMatches(groups:any[],model:{id:string;brand:string}){
 const matching=groups.filter(g=>scopeMatches(g.scopes,model));ensure(matching.length<=1,409,'ADDON_AMBIGUOUS_PRICE','适用范围存在重叠报价，请联系平台核对');
 return matching.flatMap(g=>g.prices.map((p:any)=>({...p,quoteId:g.id+':'+(p.km??1),currency:'CNY'})));
}
export const addonTerms=(kind:string)=>{
 const version=kind==='MILEAGE_PACK'?'MILEAGE_PACK_V2':'SWAP_CREDIT_ADDON_V1';
 const content=kind==='MILEAGE_PACK'?'本里程包仅限下单时本订单当前计费月使用，计费月以订单用量账户起止日为准，并非自然月。同月换车继续共享本月余额，月底不结转；原月待核验结算仍保留该月合法已购额度。基础额度优先，里程包按支付顺序抵扣。实际退订后不可新增购买，不跨订单或续期迁移。未使用额度不自动退款；异常到账由平台核对处理。':'本权益每次购买1次，仅适用于购买时选定的目标换入车型及其冻结适用范围；每次权益单价不含车辆升级差价。有效期以购买时当前实际服务租期及实际退订期限为准，不自动跨订单或续期迁移。主套餐赠送次数优先使用，原赠送及历史付费权益保留原来源规则。换车仍须车辆可用、差价及协议等原办理条件，购买权益不等于预留车辆。';
 return {version,content,hash:canonicalHash({version,content})};
};
export function versionSource(version:any){return {kind:version.kind,name:version.name,scopePrices:version.scopePrices,terms:addonTerms(version.kind)};}
export function versionHash(version:any){return canonicalHash(versionSource(version));}
