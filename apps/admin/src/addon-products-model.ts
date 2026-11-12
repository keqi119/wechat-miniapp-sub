import {can,moneyToCents,type Session} from './core.ts';
export type AddonKind='MILEAGE_PACK'|'SWAP_CREDIT';
export type AddonScope={brand:string;allModels:boolean;modelDefinitionIds:string[]};
export type AddonPrice={km?:number;quantity?:number;amount:number};
export type AddonGroup={id:string;scopes:AddonScope[];prices:AddonPrice[]};
export type AddonVersion={id:string;productId?:string;version:number;revision:number;status:string;name:string;scopePrices:AddonGroup[];updatedAt?:string;createdAt?:string};
export type AddonProduct={id:string;kind:AddonKind;name:string;revision:number;versions:AddonVersion[];updatedAt?:string};
export type AddonModel={id:string;brand:string;name:string;modelYear?:number|null};
export type AddonDraft={name:string;groups:{id:string;scopes:AddonScope[];amounts:Record<string,string>}[]};
export const addonLabels:Record<AddonKind,string>={MILEAGE_PACK:'里程包',SWAP_CREDIT:'换车权益'};
export const addonStates:Record<string,string>={DRAFT:'草稿',PUBLISHED:'售卖中',SUSPENDED:'已暂停',RETIRED:'已退役'};
export function addonDisplayVersion(product:AddonProduct){return product.versions.find(version=>version.status==='PUBLISHED')||[...product.versions].sort((a,b)=>b.version-a.version)[0];}
export function addonCanWrite(user?:Pick<Session['user'],'role'|'permissions'>){return !!user&&['ADMIN','OPERATIONS'].includes(user.role||'')&&can(user.permissions,'addon-products.read')&&can(user.permissions,'addon-products.write');}
export function addonDraft(source?:AddonVersion):AddonDraft{return {name:source?.name||'',groups:(source?.scopePrices||[]).map(group=>({id:group.id,scopes:structuredClone(group.scopes),amounts:Object.fromEntries(group.prices.map(price=>[String(price.km??price.quantity),(price.amount/100).toFixed(2)]))}))};}
export function addonPayload(kind:AddonKind,draft:AddonDraft){
 return {kind,name:draft.name.trim(),scopePrices:draft.groups.map((group,index)=>{
  if(!group.scopes.length)throw Error(`价格组 ${index+1} 请选择品牌范围`);
  const brands=new Set<string>();
  const scopes=group.scopes.map(scope=>{if(!scope.brand||brands.has(scope.brand))throw Error(`价格组 ${index+1} 的品牌不可为空或重复`);brands.add(scope.brand);if(!scope.allModels&&!scope.modelDefinitionIds.length)throw Error(`请选择 ${scope.brand} 的具体车型，或选择全系`);return {brand:scope.brand,allModels:scope.allModels,modelDefinitionIds:scope.allModels?[]:[...new Set(scope.modelDefinitionIds)]};});
  const prices=(kind==='MILEAGE_PACK'?[1000,1500,2000]:[1]).flatMap(tier=>{const amount=group.amounts[String(tier)]?.trim();return amount?[{...(kind==='MILEAGE_PACK'?{km:tier}:{quantity:1}),amount:moneyToCents(amount)}]:[];});
  return {id:group.id,scopes,prices};
 })};
}
export function publicationProblems(kind:AddonKind,version:{scopePrices:AddonGroup[]}):string[]{
 const problems:string[]=[];if(!version.scopePrices.length)return ['尚未登记适用范围和价格'];
 for(const [index,group] of version.scopePrices.entries()){
  const label=`价格组 ${index+1}`;
  if(!group.scopes.length||group.scopes.some(scope=>!scope.brand||!scope.allModels&&!scope.modelDefinitionIds.length))problems.push(`${label} 请补齐品牌 / 车型范围`);
  if(group.prices.some(price=>!Number.isSafeInteger(price.amount)||price.amount<=0||price.amount>2147483647))problems.push(`${label} 金额须为正整数分`);
  if(kind==='SWAP_CREDIT'){if(group.prices.length!==1||group.prices[0].quantity!==1)problems.push(`${label} 请登记 1 次换车价格`);}
  else {
   const sorted=[...group.prices].sort((a,b)=>(a.km||0)-(b.km||0));
   if(sorted.length!==3||sorted.some((price,i)=>price.km!==[1000,1500,2000][i]))problems.push(`${label} 请补齐 1000 / 1500 / 2000 公里三档`);
   else if(sorted.every(price=>Number.isSafeInteger(price.amount))&&!(BigInt(sorted[0].amount)*1500n>BigInt(sorted[1].amount)*1000n&&BigInt(sorted[1].amount)*2000n>BigInt(sorted[2].amount)*1500n))problems.push(`${label} 单公里价格须随档位严格递减`);
  }
 }
 return problems;
}
export function scopeSummary(scopes:AddonScope[],models:AddonModel[]=[]):string{return scopes.map(scope=>scope.brand+' · '+(scope.allModels?'全系':scope.modelDefinitionIds.map(id=>models.find(model=>model.id===id)?.name||`车型 ${id}`).join('、'))).join(' 或 ');}
