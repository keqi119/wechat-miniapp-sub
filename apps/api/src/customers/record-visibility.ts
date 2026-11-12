import {ensure} from '../common/errors';

const categories=['orders','applications','contracts','bills','payments','deposits','entitlements','notifications','services','mileages','handovers','offlineArchives','orderChanges','archiveVersions','files'] as const;
type HiddenRecords=Record<string,string[]>;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
/** Only explicit, customer-scoped cleanup audit manifests affect customer reads. */
export async function customerHiddenRecords(db:any,customerId:string):Promise<HiddenRecords>{
 const rows=await db.auditLog.findMany({where:{action:'TEST_ORDER_CUSTOMER_CLEARED',resourceType:'orders',data:{path:['customerId'],equals:customerId}},select:{action:true,resourceType:true,resourceId:true,data:true}});
 const result:HiddenRecords={};
 for(const row of rows){
  const data=row.data,records=data?.records;
  if(row.action!=='TEST_ORDER_CUSTOMER_CLEARED'||row.resourceType!=='orders'||data?.customerId!==customerId||!records||typeof records!=='object'||Array.isArray(records)||!validId(row.resourceId))continue;
  const entries=Object.entries(records);
  if(!entries.length||entries.some(([key,ids])=>!categories.includes(key as any)||!Array.isArray(ids)||!ids.every(validId))||!Array.isArray(records.orders)||!records.orders.includes(row.resourceId))continue;
  for(const [key,ids] of entries)result[key]=[...new Set([...(result[key]||[]),...(ids as string[])])];
 }
 return result;
}
const routes:Record<string,string>={orders:'orders',applications:'applications',contracts:'contracts',bills:'bills',payments:'payments',deposits:'deposits',entitlements:'entitlements',notifications:'notifications',services:'services',mileages:'mileages',handovers:'handovers','offline-archives':'offlineArchives','order-changes':'orderChanges','archive-versions':'archiveVersions',files:'files'};
export async function assertCustomerRecordVisible(db:any,customerId:string,path:string){
 const parts=path.split('/').filter(Boolean).map(part=>{try{return decodeURIComponent(part);}catch{return '';}});
 const hidden=await customerHiddenRecords(db,customerId);
 for(let i=1;i<parts.length-1;i++){
  const category=routes[parts[i]];
  if(category)ensure(!(hidden[category]||[]).includes(parts[i+1]),404,'NOT_FOUND','记录不存在');
 }
}
