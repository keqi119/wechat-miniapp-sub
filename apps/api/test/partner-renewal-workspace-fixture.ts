import {renewalFixture,renewalNow,renewalFinance} from './order-renewals-fixture';
import {renewalPaperFixture} from './renewal-paper-fixture';
import {lessorIdentityHash} from '../src/owner-signing/lessor';
import {canonicalHash} from '../src/customers/types';
import {hash} from '../src/common/data';
import {offlineChangeScope} from '../src/order-changes/agreement-facts';

/** Actual quote/paper/source methods, with only in-memory persistence. No Db or provider. */
export async function partnerRenewalFixture(){
 const base=renewalFixture();
 (base.initial.lessorSnapshot as any).sharingNotice={id:'original-sharing',version:1,contentHash:hash('original sharing consent')};
 (base.initial as any).ownerDataConsent={ownerId:base.owner.id,customerId:base.customer.id,acceptedAt:renewalNow.toISOString(),lessorHash:lessorIdentityHash(base.initial.lessorSnapshot),notice:{contentHash:(base.initial.lessorSnapshot as any).sharingNotice.contentHash}};
 base.stage.snapshot.source.originalTermsHash=canonicalHash(base.initial);base.stage.snapshot.source.agreement.priorTermsHash=hash(base.initial);base.stage.snapshotHash=canonicalHash(base.stage.snapshot);
 const f=await renewalPaperFixture(base),tx=f.tx;
 f.version.scopeSnapshot=offlineChangeScope(f.change,f.quote,f.contract);f.change.status='AWAITING_FINANCE';
 const session:any={id:'portal',mode:'PARTNER_READONLY',mobileHash:'viewer',expiresAt:new Date('2099-01-01'),scopeSnapshot:[{accessId:'access',ownerId:f.owner.id,accessVersion:3}]},grant:any={id:'access',ownerId:f.owner.id,mobileHash:'viewer',status:'ENABLED',accessVersion:3,reviewedBy:'reviewer',reviewedAt:renewalNow};
 tx.partnerPortalSession={findUnique:async()=>session};tx.partnerPortalAccess={findMany:async()=>[grant]};
 const orders:any[]=[f.order];tx.order.findMany=async({where={},skip=0,take=100000}:any={})=>orders.filter(o=>!where.id?.in||where.id.in.includes(o.id)).slice(skip,skip+take);tx.order.count=async({where}:any)=>orders.filter(o=>!where.id?.in||where.id.in.includes(o.id)).length;
 tx.order.findUnique=async({where}:any)=>orders.find(o=>o.id===where.id)??null;
 tx.contract.findMany=async({where}:any)=>f.contracts.filter(c=>c.orderId===where.orderId&&(!where.customerId||c.customerId===where.customerId)&&(!where.kind?.in||where.kind.in.includes(c.kind)));
 tx.documentArchive.findMany=async({where}:any)=>f.archives.filter(a=>(!where.orderId||a.orderId===where.orderId)&&(!where.ownerId||a.ownerId===where.ownerId));
 tx.orderServiceStage.findFirst=async({where}:any)=>f.stages.find(s=>Object.entries(where).every(([k,v])=>s[k]===v))??null;
 tx.bill.create=async({data}:any)=>{const row={id:'partner-bill-'+f.bills.length,paidAmount:0,payments:[],...data};f.bills.push(row);return row;};
 const prepare=async()=>{const p=await f.service.financePreview(f.change.id,renewalFinance);await f.service.prepare(f.change.id,{revision:f.change.revision,orderRevision:f.order.revision,accountRevision:(f.account as any).revision,previewHash:p.previewHash,idempotencyKey:'partner-prepare'},renewalFinance);return f.stages.find(s=>s.kind==='RENEWAL')!;};
 const readOnly=()=>{const before=JSON.stringify({orders,changes:f.changes,stages:f.stages,terms:f.terms,archives:f.archives});const writes=f.writes.length;return()=>{if(before!==JSON.stringify({orders,changes:f.changes,stages:f.stages,terms:f.terms,archives:f.archives})||writes!==f.writes.length)throw Error('read changed persisted facts');};};
 return{...f,session,grant,orders,prepare,readOnly};
}
