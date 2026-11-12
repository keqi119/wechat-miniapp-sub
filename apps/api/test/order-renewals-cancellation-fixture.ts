import {renewalFinanceFixture} from './order-renewals-finance-fixture';
import {renewalNow,renewalFinance} from './order-renewals-fixture';
import {hash} from '../src/common/data';

export function cancellationMatches(row:any,where:any={}):boolean{
 return Object.entries(where).every(([key,value]:any)=>{
  if(key==='AND')return (Array.isArray(value)?value:[value]).every((w:any)=>cancellationMatches(row,w));
  if(key==='OR')return value.some((w:any)=>cancellationMatches(row,w));
  if(key==='NOT')return !cancellationMatches(row,value);
  const actual=row[key];if(value===null||typeof value!=='object'||value instanceof Date)return value instanceof Date?actual?.getTime()===value.getTime():actual===value;
  if('in'in value)return value.in.includes(actual);if('notIn'in value)return !value.notIn.includes(actual);if('not'in value)return actual!==value.not;
  if('startsWith'in value)return typeof actual==='string'&&actual.startsWith(value.startsWith);
  if('equals'in value)return actual===value.equals;
  return cancellationMatches(actual||{},value);
 });
}
export async function renewalCancellationFixture(prepared=false,options:{depositAmount?:number;baseFixture?:()=>ReturnType<typeof renewalFinanceFixture>}={}){
 const f=await (options.baseFixture?options.baseFixture():renewalFinanceFixture(options)),tx:any=f.tx,cases:any[]=[],reconciliations:any[]=[],refunds:any[]=[],assetIds=new Set<string>();
 Object.assign(f.rental.versions[0],{contractNumber:'REAL-RENTAL-2026'});Object.assign(f.version,{contractNumber:'REAL-RENEWAL-2027'});
 const mutate=(row:any,data:any)=>{for(const[k,v]of Object.entries(data))row[k]=v&&typeof v==='object'&&'increment'in v?(row[k]??0)+(v as any).increment:v;f.writes.push({table:'cancellation-fixture.update',id:row.id,data});return row;};
 const delegate=(rows:any[])=>({
  findUnique:async({where}:any)=>rows.find(r=>cancellationMatches(r,where))??null,
  findFirst:async({where}:any={})=>rows.find(r=>cancellationMatches(r,where))??null,
  findMany:async({where}:any={})=>rows.filter(r=>cancellationMatches(r,where)),
  count:async({where}:any={})=>rows.filter(r=>cancellationMatches(r,where)).length,
  create:async({data}:any)=>{const row={id:'cancellation-row-'+rows.length,revision:0,createdAt:renewalNow,updatedAt:renewalNow,...data};rows.push(row);f.writes.push({table:'cancellation-fixture.create',data});return row;},
  update:async({where,data}:any)=>mutate(rows.find(r=>cancellationMatches(r,where)),data),
  updateMany:async({where,data}:any)=>{const found=rows.filter(r=>cancellationMatches(r,where));found.forEach(r=>mutate(r,data));return{count:found.length};},
 });
 tx.orderRenewalCancellation=delegate(cases);tx.paymentReconciliation=delegate(reconciliations);
 tx.order.findMany=async({where}:any)=>[f.order].filter(row=>cancellationMatches(row,where));
 tx.usagePeriod.findMany=async()=>[];
 tx.archiveCommand.findMany=async({where}:any={})=>f.commands.filter(r=>cancellationMatches(r,where));
 tx.orderServiceStage={...tx.orderServiceStage,...delegate(f.stages)};
 tx.orderChange={...tx.orderChange,...delegate(f.changes)};
 tx.documentArchive={...tx.documentArchive,...delegate(f.archives)};
 tx.archiveVersion={...tx.archiveVersion,findMany:async({where}:any={})=>f.archives.flatMap(a=>a.versions.map((v:any)=>({...v,archive:a}))).filter(v=>cancellationMatches(v,where)),findUnique:async({where}:any)=>f.archives.flatMap(a=>a.versions.map((v:any)=>({...v,archive:a}))).find(v=>cancellationMatches(v,where))??null};
 tx.contract={...tx.contract,findMany:async({where}:any={})=>f.contracts.filter(c=>cancellationMatches(c,where))};
 tx.archiveFeedback={findMany:async()=>[],count:async()=>0};
 tx.archiveFile={findMany:async({where}:any={})=>f.archives.flatMap(a=>a.versions.flatMap((v:any)=>v.files.map((b:any)=>({...b,version:v})))).filter(v=>cancellationMatches(v,where)),count:async()=>0};
 const paymentRows=()=>f.bills.flatMap(b=>b.payments.map((p:any)=>({...p,bill:b,refunds:refunds.filter(r=>r.paymentId===p.id).concat(p.refunds||[]),reconciliations:reconciliations.filter(r=>r.paymentId===p.id)})));
 tx.payment={...tx.payment,findMany:async({where}:any={})=>paymentRows().filter(p=>cancellationMatches(p,where)),findUnique:async({where}:any)=>paymentRows().find(p=>cancellationMatches(p,where))??null};
 tx.bill={...tx.bill,...delegate(f.bills),create:async({data}:any)=>{const row={id:'renewal-bill-'+f.bills.length,paidAmount:0,payments:[],...data};f.bills.push(row);f.writes.push({table:'bill.create',data});return row;},findMany:async({where}:any={})=>f.bills.filter(b=>cancellationMatches(b,where)).map(b=>({...b,payments:paymentRows().filter(p=>p.billId===b.id)}))};
 tx.serviceObligation={...tx.serviceObligation,...delegate(f.obligations),findMany:async({where,include}:any={})=>f.obligations.filter(o=>cancellationMatches(o,where)).map(o=>({...o,...(include?.allocations?{allocations:f.allocations.filter(a=>a.obligationId===o.id&&!a.releasedAt).map(a=>({...a,payment:paymentRows().find(p=>p.id===a.paymentId)}))}:{})}))};tx.paymentAllocation={...tx.paymentAllocation,...delegate(f.allocations)};
 tx.refund={...delegate(refunds),findUnique:async({where}:any)=>refunds.find(r=>cancellationMatches(r,where.requestedBy_idempotencyKey??where))??null};
 tx.storedFile={...tx.storedFile,findMany:async({where}:any={})=>f.files.filter(r=>cancellationMatches(r,where)),count:async({where}:any={})=>f.files.filter(r=>cancellationMatches(r,where)).length};
 tx.assetPrivateFile={findUnique:async({where}:any)=>assetIds.has(where.fileId)?{fileId:where.fileId}:null,count:async({where}:any)=>where.fileId.in.filter((id:string)=>assetIds.has(id)).length};
 const evidence={id:'cancel-signature-evidence',adminId:'ops',customerId:null,purpose:'evidence',mimeType:'application/pdf',size:100,sha256:hash('explicit actual verification')};f.files.push(evidence);
 if(prepared){const p=await f.service.financePreview(f.change.id,renewalFinance);await f.service.prepare(f.change.id,{revision:f.change.revision,orderRevision:f.order.revision,accountRevision:(f.account as any).revision,previewHash:p.previewHash,idempotencyKey:'cancel-prepare-original'},renewalFinance);}
 const unsigned=()=>{f.change.status='AWAITING_ARCHIVE';f.contract.offlineArchiveId=null;f.archives.splice(f.archives.indexOf(f.archive),1);};
 const pay=(bill:any)=>{const payment=f.pay(bill);Object.assign(payment,{succeededAt:renewalNow,createdAt:renewalNow,updatedAt:renewalNow});return payment;};
 return{...f,pay,cases,reconciliations,refunds,assetIds,evidence,unsigned,stage:f.stages.find(s=>s.kind==='RENEWAL')??null};
}
