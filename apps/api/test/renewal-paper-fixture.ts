import {renewalFixture,renewalPreviewInput,renewalNow,renewalOps,renewalFinance} from './order-renewals-fixture';
import {OrderRenewalsService} from '../src/order-renewals/service';
import {hash} from '../src/common/data';
import {renewalCommercialHash,renewalSourceHash} from '../src/order-renewals/types';

/** Real command methods against plain transaction mocks; never constructs Db/Prisma. */
export async function renewalPaperFixture(f=renewalFixture()){
 const service=new OrderRenewalsService(f.db as any,()=>renewalNow);
 const legal=f.tx.legalDocument.findFirst;f.tx.legalDocument.findFirst=async(args:any)=>{const d=await legal(args);return d&&args.where.type==='owner-data-sharing'?{...d,title:'本单出租方资料提供告知'}:d;};
 let input=renewalPreviewInput(f),preview=await service.preview(f.order.id,input,renewalOps);
 const created=await service.create(f.order.id,{...input,previewHash:preview.previewHash,idempotencyKey:'paper-renewal-create'},renewalOps);
 input=renewalPreviewInput(f);preview=await service.preview(f.order.id,input,renewalOps,created.id);
 await service.act(created.id,'quotes',{...input,previewHash:preview.previewHash,revision:created.revision,idempotencyKey:'paper-renewal-quote'},renewalOps);
 const change=f.changes.find(c=>c.id===created.id)!,quote=f.quotes.find(q=>q.changeId===change.id)!;
 await service.act(change.id,'review',{revision:change.revision,idempotencyKey:'paper-renewal-review',decision:'APPROVED',note:'独立核验续期冻结范围'},renewalFinance);
 await service.act(change.id,'publish',{revision:change.revision,idempotencyKey:'paper-renewal-publish'},renewalOps);
 const contract=f.contracts.find(c=>c.delayQuoteId===quote.id)!;
 await service.customerAct(change.id,'confirm',{revision:change.revision,idempotencyKey:'paper-renewal-confirm',quoteId:quote.id,quoteRevision:quote.revision,commercialHash:quote.commercialHash,bodyHash:quote.snapshot.document.bodyHash,lessorHash:quote.snapshot.source.lessorHash,noticeHash:quote.snapshot.renewalTerms.lessorSnapshot.sharingNotice.contentHash,sharingAccepted:true},f.customer.id);
 // Existing evidence is copied only within this synthetic fixture, retaining every signature/print check.
 const archive=structuredClone(f.rental),version=archive.versions[0];archive.id='renewal-paper';archive.kind='ORDER_AMENDMENT';archive.subjectType='ORDER_CHANGE_QUOTE';archive.subjectId=quote.id;archive.quoteId=quote.id;archive.currentApprovedVersionId='renewal-paper-v1';
 version.id=archive.currentApprovedVersionId;version.archiveId=archive.id;version.templateId=quote.snapshot.document.id;version.templateVersion=quote.snapshot.document.version;version.businessSnapshotHash=quote.commercialHash;version.scopeSnapshot={};version.files.forEach((v:any)=>v.versionId=version.id);
 contract.offlineArchiveId=archive.id;f.archives.push(archive);
 f.tx.orderTermsVersion.findUnique=async({where}:any)=>f.terms.find(t=>t.id===where.id)??null;
 f.tx.orderTermsVersion.findMany=async()=>f.terms.map(t=>({...t,quote:{...f.quotes.find(q=>q.id===t.quoteId),change:f.changes.find(c=>c.id===f.quotes.find(q=>q.id===t.quoteId)?.changeId)}}));
 f.tx.documentArchive.findFirst=async({where}:any)=>f.archives.find(a=>a.id===where.id&&a.orderId===where.orderId&&a.kind===where.kind)??null;
 function reseal(){const s=quote.snapshot;s.sourceHash=renewalSourceHash(s);s.offlineSource.renewalSourceHash=s.sourceHash;quote.commercialHash=renewalCommercialHash(change,s,s.document.templateHash,contract.id,s.offlineSource);s.renewalTerms.commercialHash=quote.commercialHash;contract.documentHash=quote.commercialHash;version.businessSnapshotHash=quote.commercialHash;}
 function prepare(){quote.financePreparedAt=new Date(quote.confirmedAt.getTime()+1000);quote.approvedArchiveVersionId=version.id;change.status='SCHEDULED';}
 function apply(){prepare();change.status='APPLIED';f.stage.status='ENDED';(f.stage as any).endedAt=new Date('2027-10-01');const t={id:'renewal-terms',orderId:f.order.id,quoteId:quote.id,version:f.terms.length+1,snapshot:structuredClone(quote.snapshot.renewalTerms),hash:quote.commercialHash,offlineArchiveVersionId:version.id,effectiveAt:new Date('2027-10-01')};f.terms.push(t);f.order.effectiveTermsVersionId=t.id;return t;}
 return{...f,service,change,quote,contract,archive,version,reseal,prepare,apply};
}
