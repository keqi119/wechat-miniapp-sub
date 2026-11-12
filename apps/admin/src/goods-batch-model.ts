export function applicableVehicles<T extends {id:string;modelDefinitionId?:string|null}>(scope:{vehicleIds:string[];modelDefinitionIds:string[]},vehicles:T[]):T[]{
 if(!Array.isArray(scope.vehicleIds)||!Array.isArray(scope.modelDefinitionIds))throw new Error('产品适用范围不完整，请刷新重试');
 const ids=new Set(scope.vehicleIds),models=new Set(scope.modelDefinitionIds);
 return vehicles.filter(v=>ids.has(v.id)||!!v.modelDefinitionId&&models.has(v.modelDefinitionId));
}
export function batchAction(mode:'publish'|'withdraw',status:string|undefined):'create'|'publish'|'withdraw'|'skip'{
 if(status!==undefined&&!['DRAFT','PUBLISHED','WITHDRAWN'].includes(status))throw new Error('商品状态无法识别，请刷新后核对');
 return mode==='publish'?(status===undefined?'create':status==='PUBLISHED'?'skip':'publish'):(status==='PUBLISHED'?'withdraw':'skip');
}
