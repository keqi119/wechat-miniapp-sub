import {vehicleLedgerFilterKeys,vehicleLedgerFilters,type VehicleLedgerFilters} from './vehicle-ledger-filters-model.ts';
import {baasListFilterKeys,baasFilterQuery,type BaasFilters} from './baas-list-filters-model.ts';
const routes=new Set(['order-renewals','overdue-bills','collection-cases','work-order-costs','asset-work-orders','vehicle-maintenance','residual-forecasts','vehicle-valuations','residual-observations','residual-imports','residual-curves','license-plates','depreciation-policies','baas-contracts','asset-cost-plans','asset-costs','orders','applications','customers','customer-risk','vehicles','model-definitions','plans','partners','partner-rules','partner-settlements','products','product-warehouse','goods','mileage-packs','swap-addon-products','insurance','insurance-renewals','coverage-requirements','offline-archives','partner-archives','contract-center','contracts','bills','payments','refunds','deposits','handover-tasks','handovers','usage-periods','return-settlements','mileages','services','entitlements','benefit-definitions','notifications','users','audit-logs','legal-documents','order-changes','vehicle-changes','esign-approvals','payment-verifications','technical-acceptances','swap-credit-purchases','enterprise-seals','seal-authorities','signature-policies']);
const fields=new Set(['record','view','versionId','orderId','keyword','status','page','returnTo','reconciliationRequired','sourceChannel',...vehicleLedgerFilterKeys,...baasListFilterKeys,'vehicleId','group']);
function route(hash:string){
 if(!hash.startsWith('#')||hash.length>2400||/[\r\n]/.test(hash))return null;
 const [name,query='']=hash.slice(1).split('?');if(!routes.has(name))return null;
 const params=new URLSearchParams(query);
 if([...params.keys()].some(key=>!fields.has(key))||[...params.keys()].some(key=>params.getAll(key).length!==1))return null;
 for(const key of ['record','orderId','versionId','vehicleId'])if(params.has(key)&&!/^[A-Za-z0-9_-]{1,128}$/.test(params.get(key)!))return null;
 if(params.has('view')&&!/^[a-z][a-z-]{0,49}$/.test(params.get('view')!))return null;
 return{name,params};
}
function stringify(value:NonNullable<ReturnType<typeof route>>){const query=value.params.toString();return '#'+value.name+(query?'?'+query:'');}
export function processReturnTarget(hash:string):string|null{
 const target=route(hash)?.params.get('returnTo');if(!target)return null;
 const origin=route(target);return origin&&origin.params.has('record')&&!origin.params.has('returnTo')?stringify(origin):null;
}
export function processHref(target:string,origin:string):string{
 const dest=route(target),source=route(processReturnTarget(origin)||origin);
 if(!dest||!source||!source.params.has('record'))return target;
 source.params.delete('returnTo');dest.params.delete('returnTo');
 if(dest.name===source.name&&dest.params.get('record')===source.params.get('record'))return stringify(dest);
 dest.params.set('returnTo',stringify(source));return stringify(dest);
}
export function recordLocation(hash:string,id:string,view?:string):string{
 const current=route(hash);if(!current||id&&!/^[A-Za-z0-9_-]{1,128}$/.test(id)||view&&!/^[a-z][a-z-]{0,49}$/.test(view))return hash;
 if(id)current.params.set('record',id);else current.params.delete('record');
 if(view&&id)current.params.set('view',view);else if(!id)current.params.delete('view');
 return stringify(current);
}
export function syncRecordLocation(id:string,view?:string){
 if(typeof window==='undefined')return;
 const next=recordLocation(window.location.hash,id,view);
 if(next!==window.location.hash){window.history.replaceState(window.history.state,'',next);window.dispatchEvent(new Event('process-location'));}
}
export function syncProcessSection(view:string){
 if(typeof window==='undefined')return;
 const id=new URLSearchParams(window.location.hash.split('?')[1]).get('record');if(id)syncRecordLocation(id,view);
}

export type ListLocationState={keyword:string;status:string;page:number;sourceChannel?:string;vehicleFilters?:VehicleLedgerFilters;baasFilters?:BaasFilters;vehicleId?:string;baasGroup?:'CURRENT'|'EXPIRED'|'OTHER'};
export function listLocationState(hash:string):ListLocationState{
 const current=route(hash),params=current?.params,source=params?.get('sourceChannel')?.trim();
 const rawPage=params?.get('page')||'1',rawStatus=params?.get('status')||'';
 const vehicleFilters=current?.name==='vehicles'?Object.fromEntries(vehicleLedgerFilterKeys.flatMap(key=>params?.has(key)?[[key,params.get(key)!.trim().slice(0,200)]]:[])):{};
 const baasFilters=current?.name==='baas-contracts'?Object.fromEntries(baasListFilterKeys.flatMap(key=>params?.has(key)?[[key,params.get(key)!.trim().slice(0,501)]]:[])):{};
 return {keyword:(params?.get('keyword')||'').slice(0,200),status:/^[A-Za-z0-9_-]{0,80}$/.test(rawStatus)?rawStatus:'',page:/^[1-9]\d{0,5}$/.test(rawPage)?Number(rawPage):1,...(current?.name==='customers'&&source&&source.length<=64&&!source.includes('\0')?{sourceChannel:source}:{}),...(Object.keys(vehicleFilters).length?{vehicleFilters}:{}),...(Object.keys(baasFilters).length?{baasFilters}:{}),...(current?.name==='baas-contracts'&&['CURRENT','EXPIRED','OTHER'].includes(params?.get('group')||'')?{baasGroup:params!.get('group') as 'CURRENT'|'EXPIRED'|'OTHER'}:{}),...(current?.name==='baas-contracts'&&params?.get('vehicleId')?{vehicleId:params.get('vehicleId')!}:{})};
}
export function listLocation(hash:string):string{
 const current=route(hash);if(!current)return hash;
 for(const key of ['record','view','returnTo'])current.params.delete(key);
 return stringify(current);
}
export function updateListLocation(hash:string,value:ListLocationState):string{
 const current=route(hash);if(!current)return hash;
 const keyword=value.keyword.trim().slice(0,200),status=/^[A-Za-z0-9_-]{0,80}$/.test(value.status)?value.status:'';
 for(const [key,val] of [['keyword',keyword],['status',status],['page',value.page>1&&Number.isInteger(value.page)&&value.page<=999999?String(value.page):'']]){
  if(val)current.params.set(key,val);else current.params.delete(key);
 }
 if(current.name==='customers'&&value.sourceChannel!==undefined){const source=value.sourceChannel.trim();if(source&&source.length<=64&&!source.includes('\0'))current.params.set('sourceChannel',source);else current.params.delete('sourceChannel');}
 if(current.name==='vehicles'&&value.vehicleFilters!==undefined){const filters=vehicleLedgerFilters(value.vehicleFilters);for(const key of vehicleLedgerFilterKeys){if(filters[key]!==undefined)current.params.set(key,filters[key]!);else current.params.delete(key);}}
 else if(current.name!=='vehicles')for(const key of vehicleLedgerFilterKeys)current.params.delete(key);
 if(current.name==='baas-contracts'){if(value.baasGroup!==undefined){if(['CURRENT','EXPIRED','OTHER'].includes(value.baasGroup))current.params.set('group',value.baasGroup);else current.params.delete('group');}if(value.baasFilters!==undefined){const filters=baasFilterQuery(value.baasFilters);for(const key of baasListFilterKeys){const v=filters.get(key);if(v)current.params.set(key,v);else current.params.delete(key);}}if(value.vehicleId!==undefined){if(value.vehicleId&&/^[A-Za-z0-9_-]{1,128}$/.test(value.vehicleId))current.params.set('vehicleId',value.vehicleId);else current.params.delete('vehicleId');}}
 else{for(const key of baasListFilterKeys)current.params.delete(key);current.params.delete('vehicleId');current.params.delete('group');}
 return stringify(current);
}
export function syncListLocation(value:ListLocationState){
 const next=updateListLocation(window.location.hash,value);
 if(next!==window.location.hash){window.history.replaceState(window.history.state,'',next);window.dispatchEvent(new Event('process-location'));}
}
export function openRecordLocation(id:string,view?:string){
 const next=recordLocation(window.location.hash,id,view);if(next===window.location.hash)return;
 window.history.pushState({...window.history.state,nindaRecordList:listLocation(window.location.hash)},'',next);
 window.dispatchEvent(new Event('process-location'));
}
export function closeRecordLocation(){
 const next=recordLocation(window.location.hash,'');
 if(window.history.state?.nindaRecordList===listLocation(next)){window.history.back();return;}
 window.history.replaceState(window.history.state,'',next);window.dispatchEvent(new Event('process-location'));
}

const listPositions=new Map<string,Position>();
function listPanel(){return [...document.querySelectorAll<HTMLElement>('.resource-list-layout .table-scroll,[data-list-scroll]')].find(element=>element.getClientRects().length);}
export function rememberListPosition(userId:string,hash=window.location.hash){
 listPositions.set(userId+listLocation(hash),{top:listPanel()?.scrollTop||0,pageTop:window.scrollY});
}
export function restoreListPosition(userId:string,hash=window.location.hash){
 const target=listLocation(hash),saved=listPositions.get(userId+target);if(!saved)return()=>{};
 let stopped=false,observer:MutationObserver|undefined;const started=Date.now();
 const restore=()=>{
  if(stopped||listLocation(window.location.hash)!==target||new URLSearchParams(window.location.hash.split('?')[1]).has('record')){observer?.disconnect();return;}
  const current=listPanel();
  if(current&&(current.scrollHeight-current.clientHeight>=saved.top||Date.now()-started>2500)){
   current.scrollTop=saved.top;window.scrollTo(0,saved.pageTop);observer?.disconnect();
  }
 };
 const timer=window.setTimeout(()=>{restore();observer?.disconnect();},3000);
 window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>{if(stopped)return;observer=new MutationObserver(restore);observer.observe(document.body,{childList:true,subtree:true});restore();}));
 return()=>{stopped=true;observer?.disconnect();window.clearTimeout(timer);};
}
type Position={top:number;pageTop:number};
const positions=new Map<string,Position>();
function panel(){return [...document.querySelectorAll<HTMLElement>('.detail-panel-scroll')].filter(element=>element.getClientRects().length).at(-1);}
export function rememberProcessPosition(userId:string){
 const current=route(window.location.hash);if(!current?.params.has('record'))return;
 current.params.delete('returnTo');positions.set(userId+stringify(current),{top:panel()?.scrollTop||0,pageTop:window.scrollY});
}
export function clearProcessPositions(){positions.clear();listPositions.clear();}
export function returnToProcess(userId:string){
 const target=processReturnTarget(window.location.hash);if(!target)return;
 const saved=positions.get(userId+target);window.location.hash=target;if(!saved)return;
 const started=Date.now();let observer:MutationObserver|undefined;
 const restore=()=>{
  if(window.location.hash!==target){observer?.disconnect();return;}
  const current=panel();
  if(current&&(current.scrollHeight-current.clientHeight>=saved.top||Date.now()-started>2500)){
   current.scrollTop=saved.top;window.scrollTo(0,saved.pageTop);observer?.disconnect();
  }
 };
 window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>{observer=new MutationObserver(restore);observer.observe(document.body,{childList:true,subtree:true});restore();window.setTimeout(()=>{restore();observer?.disconnect();},3000);}));
}
