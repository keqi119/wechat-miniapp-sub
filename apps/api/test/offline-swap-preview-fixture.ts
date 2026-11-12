import {offlineSwapFixture,swapV2Input,swapOps} from './offline-swap-quotes-fixture';
export {swapOps};
export const previewNow=new Date('2026-10-31T00:00:00Z');
export function offlineSwapPreviewFixture(){
 const f=offlineSwapFixture(),queries:any[]=[];
 const staff=new Map<string,any>([['ops',{...swapOps,active:true}],['finance',{id:'finance',role:'FINANCE',authVersion:1,active:true}],['support',{id:'support',role:'SUPPORT',authVersion:1,active:true}],['field',{id:'field',role:'FIELD',authVersion:1,active:true}]]);
 f.tx.adminUser.findUnique=async({where}:any)=>staff.get(where.id)??null;
 f.tx.vehicleListing.findMany=async(args:any)=>{queries.push(args);return [{...f.plan.listing,vehicle:f.target,subscriptionPlan:f.plan,productVersion:f.plan.productVersion}];};
 f.tx.vehicleListing.count=async(args:any)=>{queries.push(args);return 41;};
 const {idempotencyKey,...input}=swapV2Input(f);
 return{...f,staff,queries,input};
}
