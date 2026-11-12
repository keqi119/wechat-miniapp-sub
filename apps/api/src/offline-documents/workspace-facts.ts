/** Read-only, allowlisted business facts; never copy audit payloads or review notes. */
export function workspaceTimeline(order:any,archives:any[],role:string){
 const events:{id:string;at:string;label:string;resourceType:string;resourceId:string}[]=[];
 const add=(id:string,at:unknown,label:string,resourceType:string,resourceId:string)=>{
  if(!at)return;const time=new Date(at as string|Date);if(!Number.isFinite(time.getTime()))return;
  events.push({id,at:time.toISOString(),label,resourceType,resourceId});
 };
 add(`order:${order.id}`,order.createdAt,'订单已建立','order',order.id);
 const kinds:Record<string,string>={RENTAL:'租赁合同',ORDER_AMENDMENT:'订单补充协议',DELIVERY_RECEIPT:'交车单',RETURN_RECEIPT:'还车单',TERMINATION:'终止协议'};
 for(const archive of archives)for(const version of archive.versions||[]){
  const title=kinds[archive.kind]||'订单资料';
  if(['ADMIN','OPERATIONS'].includes(role))add(`submit:${version.id}`,version.submittedAt,`${title}已提交审核`,'offline-archive',archive.id);
  if(version.status==='REVIEWED'||version.archivedAt)add(`review:${version.id}`,version.reviewedAt,`${title}第 ${version.version} 版审核通过`,'offline-archive',archive.id);
  if(['ARCHIVED','INVALIDATED'].includes(version.status))add(`archive:${version.id}`,version.archivedAt||version.reviewedAt,`${title}第 ${version.version} 版${version.archivedAt?'已归档':'历史审核归档'}`,'offline-archive',archive.id);
  if(version.status==='INVALIDATED')add(`invalidate:${version.id}`,version.invalidatedAt,`${title}第 ${version.version} 版已作废`,'offline-archive',archive.id);
 }
 for(const handover of order.handovers||[])if(handover.status==='COMPLETED')add(`handover:${handover.id}`,handover.completedAt,handover.type==='DELIVERY'?'车辆交付已完成':'正式还车已完成','handover',handover.id);
 for(const receipt of order.receiptFacts||[])add(`received:${receipt.id}`,receipt.receivedAt,'车辆已实际收回，财务结算单独核对','vehicle-receipt',receipt.id);
 return events.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
}

export function workspaceResponsibility(order:any,actorRole:string){
 const responsible:Record<string,[string,string]>={AWAITING_CONTRACT_REVIEW:['OPERATIONS','运营：合同审核与归档'],AWAITING_PAYMENT:['CUSTOMER','客户付款；财务核对到账'],AWAITING_HANDOVER:['FIELD','现场员工：查验交付；运营复核'],ACTIVE:['OPERATIONS','运营：用车服务'],SETTLING:['FINANCE','财务：退款与关单核对'],COMPLETED:['OPERATIONS','运营：归档查询'],CANCELLED:['OPERATIONS','运营：归档查询']};
 const [role,label]=responsible[order.status]||['OPERATIONS','运营：核对当前业务进度'];
 const task=(order.fieldTaskFacts||[]).find((t:any)=>!['CANCELLED','COMPLETED'].includes(t.status));
 return {role,label,...(['ADMIN','OPERATIONS'].includes(actorRole)&&task?.assignee?.name?{assigneeName:task.assignee.name,taskId:task.id}:{})};
}
