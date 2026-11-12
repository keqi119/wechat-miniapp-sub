type Bill = Record<string, unknown>;
type PublicationView = {title:string; scheduledDate:string|null; message:string};

export function automaticBill(bill:Bill):boolean {
 return ['SUBSCRIPTION','DEPOSIT'].includes(String(bill.type));
}

function scheduleDate(value:unknown):string|null {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const date=new Date(`${value}T00:00:00.000Z`);
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:null;
}

/** Publication facts come from the server; the browser never advances a bill or computes its schedule. */
export function billPublicationView(bill:Bill):PublicationView {
 const automatic=automaticBill(bill),raw=bill.publication;
 const publication=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
 const scheduledDate=automatic?scheduleDate(publication.scheduledDate):null;
 if(bill.status==='VOID'||publication.state==='CLOSED')return{title:'账单已关闭',scheduledDate,message:typeof publication.message==='string'&&publication.message.trim()?publication.message:'此账单不再发布。'};
 if(['PENDING','PAID'].includes(String(bill.status))||publication.state==='PUBLISHED')return{title:'账单已发布',scheduledDate,message:typeof publication.message==='string'&&publication.message.trim()?publication.message:'客户可查看账单，付款以实际支付状态为准。'};
 if(!automatic)return{title:'按原业务流程发布',scheduledDate:null,message:typeof publication.message==='string'&&publication.message.trim()?publication.message:'附加费用须经独立复核后发布；权益购买按原业务流程办理。'};
 const labels:Record<string,string>={SCHEDULED:'自动发布 · 已安排',WAITING:'自动发布 · 等待执行',BLOCKED:'自动发布 · 暂缓'};
 const title=publication.mode==='AUTOMATIC'?labels[String(publication.state)]:undefined;
 if(!title)return{title:'自动发布计划待核对',scheduledDate:null,message:'当前未取得自动发布计划，请刷新核对；无需逐个发布。'};
 const fallback=publication.state==='BLOCKED'?'发布条件尚未就绪，请刷新核对具体原因。':publication.state==='WAITING'?'已到发布时间，等待下一次自动任务。':'系统将在到期前 3 天自动发布，无需逐个操作。';
 return{title,scheduledDate,message:typeof publication.message==='string'&&publication.message.trim()?publication.message:fallback};
}
