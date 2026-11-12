import {randomUUID} from 'node:crypto';
import type {StaffActor} from '../auth/staff.types';
import {audit} from '../common/data';
import {ensure} from '../common/errors';
import {storedDate} from '../asset-costs/types';
import {collectionCommand,collectionPermission,lockCollectionOrder} from './command';
import {collectionDay,collectionSummary} from './facts';
import {collectionActionView,collectionCaseSelect,collectionHeader,collectionLinkView,collectionPreviewHash,loadCollectionCase,loadCollectionOrder,publicCollectionSummary,type CollectionSummary} from './source';
import {collectionOrderFilter} from './overdue';
import {collectionCloseInput,collectionContactInput,collectionCreateInput,collectionId,collectionListInput,collectionPreviewInput,collectionRefreshInput} from './types';

export class CollectionsService{
 constructor(private readonly clock:()=>Date=()=>new Date()){}
 private async context(tx:any,orderId:string,row:any=null){const loaded=await loadCollectionOrder(tx,orderId);ensure(!row||row.orderId===loaded.order.id&&row.customerId===loaded.order.customerId,409,'COLLECTION_OWNERSHIP_MISMATCH','案件与订单客户不一致');const summary=collectionSummary(loaded.order,loaded.bills,collectionDay(this.clock()),row?row.bills.map((link:any)=>link.billId):[]);return{...loaded,summary,previewHash:collectionPreviewHash(loaded.order,row,summary)};}
 private contacts(order:any){return{order:{id:order.id,status:order.status},customer:{id:order.customer.id,name:order.customer.name,mobile:order.customer.mobile}};}
 private current(row:any,revision:number){ensure(row.status==='ACTIVE',409,'COLLECTION_CASE_STATE','只有当前未关闭案件可追加记录');ensure(row.revision===revision&&revision<2147483647,409,'REVISION_CONFLICT','案件已变化，请刷新');}
 private samePreview(actual:string,expected:string){ensure(actual===expected,409,'PREVIEW_CHANGED','账单或核账事实已变化，请重新预览');}
 private async append(tx:any,actor:StaffActor,row:any,kind:'CREATE'|'REFRESH'|'CONTACT'|'CLOSE',reason:string,summary:CollectionSummary,contact:any={}){
  const beforeRevision=kind==='CREATE'?0:row.revision,next=beforeRevision+1;ensure(next<=2147483647,409,'REVISION_LIMIT','案件版本已达上限');
  return tx.collectionAction.create({data:{caseId:row.id,orderId:row.orderId,customerId:row.customerId,sequence:next,beforeRevision,afterRevision:next,kind,reason,sourceSnapshot:summary.sourceSnapshot,sourceHash:summary.sourceHash,actorId:actor.id,createdAt:this.clock(),...contact}});
 }
 private async linkNewBills(tx:any,actor:StaffActor,row:any,summary:CollectionSummary){
  const existing=new Set((row.bills??[]).map((link:any)=>link.billId)),newIds:string[]=[];
  for(const fact of summary.bills){if(fact.confirmedOverdueAmount===null||fact.confirmedOverdueAmount<=0||existing.has(fact.billId))continue;ensure(fact.amount!==null&&fact.amount>0,409,'COLLECTION_FACTS_INVALID','新增关联必须为可信正额应收');await tx.collectionCaseBill.create({data:{caseId:row.id,orderId:row.orderId,customerId:row.customerId,billId:fact.billId,initialDueDate:storedDate(fact.dueDate),initialAmount:fact.amount,initialOverdueAmount:fact.confirmedOverdueAmount,initialAsOfDate:storedDate(summary.asOfDate),sourceSnapshot:fact.sourceSnapshot,sourceHash:fact.sourceHash,linkedBy:actor.id,linkedAt:this.clock()}});newIds.push(fact.billId);}return newIds;
 }
 private summaryColumns(summary:CollectionSummary){return{asOfDate:storedDate(summary.asOfDate),totalOverdueAmount:summary.totalOverdueAmount,maxOverdueDays:summary.maxOverdueDays,level:summary.level,sourceSnapshot:summary.sourceSnapshot,sourceHash:summary.sourceHash};}
 async preview(tx:any,actor:StaffActor,raw:unknown){
  await collectionPermission(tx,actor);const input=collectionPreviewInput.parse(raw),active=await tx.collectionCase.findFirst({where:{orderId:input.orderId,status:'ACTIVE'},select:{id:true}}),row=active?(await loadCollectionCase(tx,active.id)).row:null,context=await this.context(tx,input.orderId,row);return{...this.contacts(context.order),activeCase:row?{id:row.id,revision:row.revision}:null,current:publicCollectionSummary(context.summary),previewHash:context.previewHash};
 }
 async detail(tx:any,actor:StaffActor,id:string){
  await collectionPermission(tx,actor);const {row,recorded,actions}=await loadCollectionCase(tx,id),context=await this.context(tx,row.orderId,row);return{...collectionHeader(row),...this.contacts(context.order),recorded:publicCollectionSummary(recorded),current:publicCollectionSummary(context.summary),sourceChanged:row.sourceHash!==context.summary.sourceHash,previewHash:context.previewHash,links:[...row.bills].sort((a:any,b:any)=>a.billId<b.billId?-1:a.billId>b.billId?1:0).map(collectionLinkView),actions:actions.map(collectionActionView)};
 }
 async list(tx:any,actor:StaffActor,raw:unknown){
  await collectionPermission(tx,actor);const input=collectionListInput.parse(raw),where={...(input.status?{status:input.status}:{}),order:collectionOrderFilter(input)},[rows,total]=await Promise.all([tx.collectionCase.findMany({where,select:{id:true},orderBy:[{updatedAt:'desc'},{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize}),tx.collectionCase.count({where})]);const items=[];
  for(const row of rows){const detail=await this.detail(tx,actor,row.id),{links,actions,recorded,current,...header}=detail;items.push({...header,recorded:{asOfDate:recorded.asOfDate,totalOverdueAmount:recorded.totalOverdueAmount,maxOverdueDays:recorded.maxOverdueDays,level:recorded.level,sourceHash:recorded.sourceHash},current:{asOfDate:current.asOfDate,totalOverdueAmount:current.totalOverdueAmount,maxOverdueDays:current.maxOverdueDays,level:current.level,sourceHash:current.sourceHash,blockedBillIds:current.blockedBillIds,overdueBillIds:current.overdueBillIds,canClose:current.canClose}});}return{items,total,page:input.page,pageSize:input.pageSize};
 }
 async create(tx:any,actor:StaffActor,raw:unknown){
  const input=collectionCreateInput.parse(raw);return collectionCommand(tx,actor,'order:'+input.orderId,'CREATE',input,async()=>{
   await lockCollectionOrder(tx,input.orderId);const active=await tx.collectionCase.findFirst({where:{orderId:input.orderId,status:'ACTIVE'},select:{id:true}});ensure(!active,409,'COLLECTION_ACTIVE_EXISTS','本订单已有未关闭催收案件');const context=await this.context(tx,input.orderId);this.samePreview(context.previewHash,input.previewHash);ensure(context.summary.totalOverdueAmount>0,409,'COLLECTION_NO_CONFIRMED_OVERDUE','当前没有可确认的逾期欠款，请先核账');
   const row=await tx.collectionCase.create({data:{id:randomUUID(),orderId:input.orderId,customerId:context.order.customerId,revision:1,status:'ACTIVE',...this.summaryColumns(context.summary),createdBy:actor.id,updatedBy:actor.id}}),linkedBillIds=await this.linkNewBills(tx,actor,row,context.summary),action=await this.append(tx,actor,row,'CREATE',input.reason,context.summary);await audit(tx,actor.id,'CREATE_COLLECTION','collection-cases',row.id,{revision:1,actionId:action.id,sourceHash:context.summary.sourceHash,linkedBillIds,reason:input.reason});return this.detail(tx,actor,row.id);
  });
 }
 private async lockedCase(tx:any,id:string){collectionId.parse(id);const initial=await tx.collectionCase.findUnique({where:{id},select:{id:true,orderId:true,customerId:true}});ensure(initial,404,'NOT_FOUND','催收案件不存在');await lockCollectionOrder(tx,initial.orderId,id);const loaded=await loadCollectionCase(tx,id);ensure(loaded.row.orderId===initial.orderId&&loaded.row.customerId===initial.customerId,409,'COLLECTION_OWNERSHIP_MISMATCH','案件归属已变化');return loaded.row;}
 private async update(tx:any,actor:StaffActor,row:any,data:any){const changed=await tx.collectionCase.updateMany({where:{id:row.id,revision:row.revision,status:'ACTIVE'},data:{...data,revision:{increment:1},updatedBy:actor.id,updatedAt:this.clock()}});ensure(changed.count===1,409,'REVISION_CONFLICT','案件已变化，请刷新');}
 async refresh(tx:any,actor:StaffActor,id:string,raw:unknown){
  collectionId.parse(id);const input=collectionRefreshInput.parse(raw);return collectionCommand(tx,actor,'case:'+id,'REFRESH',input,async()=>{
   const row=await this.lockedCase(tx,id);this.current(row,input.revision);const context=await this.context(tx,row.orderId,row);this.samePreview(context.previewHash,input.previewHash);const linkedBillIds=await this.linkNewBills(tx,actor,row,context.summary),action=await this.append(tx,actor,row,'REFRESH',input.reason,context.summary);await this.update(tx,actor,row,this.summaryColumns(context.summary));await audit(tx,actor.id,'REFRESH_COLLECTION','collection-cases',id,{revision:row.revision+1,actionId:action.id,sourceHash:context.summary.sourceHash,linkedBillIds,reason:input.reason});return this.detail(tx,actor,id);
  });
 }
 async contact(tx:any,actor:StaffActor,id:string,raw:unknown){
  collectionId.parse(id);const input=collectionContactInput.parse(raw);return collectionCommand(tx,actor,'case:'+id,'CONTACT',input,async()=>{
   const row=await this.lockedCase(tx,id);this.current(row,input.revision);const context=await this.context(tx,row.orderId,row),today=context.summary.asOfDate;ensure(!input.promiseDate||input.promiseDate>=today,400,'COLLECTION_PROMISE_DATE','承诺付款日期不得早于上海今天');ensure(!input.nextFollowUpDate||input.nextFollowUpDate>=today,400,'COLLECTION_FOLLOWUP_DATE','下次跟进日期不得早于上海今天');ensure(input.promiseAmount===null||input.promiseAmount<=context.summary.totalOverdueAmount,409,'COLLECTION_PROMISE_AMOUNT','承诺金额不得超过当前确认逾期欠款');
   const action=await this.append(tx,actor,row,'CONTACT','人工联系记录',context.summary,{method:input.method,actionType:input.actionType,result:input.result,content:input.content,promiseDate:input.promiseDate?storedDate(input.promiseDate):null,promiseAmount:input.promiseAmount,nextFollowUpDate:input.nextFollowUpDate?storedDate(input.nextFollowUpDate):null});await this.update(tx,actor,row,{});await audit(tx,actor.id,'CONTACT_COLLECTION','collection-cases',id,{revision:row.revision+1,actionId:action.id,sourceHash:context.summary.sourceHash,method:input.method,actionType:input.actionType,result:input.result});return this.detail(tx,actor,id);
  });
 }
 async close(tx:any,actor:StaffActor,id:string,raw:unknown){
  collectionId.parse(id);const input=collectionCloseInput.parse(raw);return collectionCommand(tx,actor,'case:'+id,'CLOSE',input,async()=>{
   const row=await this.lockedCase(tx,id);this.current(row,input.revision);const context=await this.context(tx,row.orderId,row);this.samePreview(context.previewHash,input.previewHash);ensure(context.summary.canClose,409,'COLLECTION_NOT_SETTLED','关联账单未可信结清、存在新逾期或收退款仍需核账');const action=await this.append(tx,actor,row,'CLOSE',input.closeReason,context.summary);await this.update(tx,actor,row,{...this.summaryColumns(context.summary),status:'CLOSED',closedAt:this.clock(),closedBy:actor.id,closeReason:input.closeReason});await audit(tx,actor.id,'CLOSE_COLLECTION','collection-cases',id,{revision:row.revision+1,actionId:action.id,sourceHash:context.summary.sourceHash,closeReason:input.closeReason});return this.detail(tx,actor,id);
  });
 }
}
