import {ensure} from '../common/errors';
// Bill.sequence is an issuance number for adjustment bills, not a service month.
// Every version keeps the same original month identity; amounts never move across months.
export async function serviceBillSequences(tx:any,orderId:string){
 const bills=await tx.bill.findMany({where:{orderId,type:'SUBSCRIPTION'}}),rows=await tx.serviceObligation.findMany({where:{orderId}});
 const map=new Map<string,number>(bills.map((b:any)=>[b.id,b.sequence]));
 for(const row of rows)for(const id of [...row.sourceBillIds,row.chargeBillId].filter(Boolean)){ensure(!map.has(id)||map.get(id)===row.sequence,409,'OBLIGATION_MISMATCH','账单服务月份归属需人工核对');map.set(id,row.sequence);}
 return map;
}
