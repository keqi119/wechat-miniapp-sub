import type {StaffActor} from '../auth/staff.types';
import {ensure} from '../common/errors';
import {storedDate} from '../asset-costs/types';
import {collectionPermission} from './command';
import {collectionBillFact,collectionDay} from './facts';
import {financialBillSelect,orderContactSelect,publicBillFact} from './source';
import {overdueListInput} from './types';

export function collectionOrderFilter(input:{orderId?:string;customerId?:string;keyword?:string}){
 return{...(input.orderId?{id:input.orderId}:{}),...(input.customerId?{customerId:input.customerId}:{}),...(input.keyword?{OR:[{id:{contains:input.keyword,mode:'insensitive'}},{customer:{name:{contains:input.keyword,mode:'insensitive'}}},{customer:{mobile:{contains:input.keyword,mode:'insensitive'}}}]}:{})};
}
export class OverdueBillsService{
 constructor(private readonly clock:()=>Date=()=>new Date()){}
 async list(tx:any,actor:StaffActor,raw:unknown){
  await collectionPermission(tx,actor,false,'overdue-bills');const input=overdueListInput.parse(raw),asOfDate=collectionDay(this.clock()),offset=(input.page-1)*input.pageSize,items:any[]=[];let cursor:string|undefined,total=0;
  // A page of SQL candidates is not a page of trustworthy debt. Scan a stable
  // primary-key order to retain exceptions and compute the filtered total.
  for(;;){
   const rows=await tx.bill.findMany({where:{status:'PENDING',dueDate:{lt:storedDate(asOfDate)},order:collectionOrderFilter(input),...(cursor?{id:{gt:cursor}}:{})},select:{...financialBillSelect,order:{select:orderContactSelect}},orderBy:{id:'asc'},take:200});if(!rows.length)break;
   for(const row of rows){ensure(row.order?.id===row.orderId&&row.order.customer?.id===row.customerId,409,'COLLECTION_OWNERSHIP_MISMATCH','逾期账单与订单客户不一致');const fact=collectionBillFact(row,row.order,asOfDate);if(!(fact.confirmedOverdueAmount!==null&&fact.confirmedOverdueAmount>0||fact.blockers.length>0)||input.level&&fact.level!==input.level)continue;if(total>=offset&&items.length<input.pageSize)items.push({...publicBillFact(fact),order:{id:row.order.id,status:row.order.status},customer:{id:row.order.customer.id,name:row.order.customer.name,mobile:row.order.customer.mobile}});total++;ensure(Number.isSafeInteger(total),400,'COLLECTION_COUNT_OVERFLOW','候选数量超过安全整数');}
   const next=rows.at(-1).id;ensure(typeof next==='string'&&(!cursor||next>cursor),409,'COLLECTION_CURSOR_INVALID','账单分页顺序异常');cursor=next;if(rows.length<200)break;
  }
  return{items,total,page:input.page,pageSize:input.pageSize,asOfDate};
 }
}
