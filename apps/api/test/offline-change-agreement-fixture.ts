import {hash} from '../src/common/data';
import {validateManifest} from '../src/offline-documents/files';

export function agreementFixture(){
 const parties=[{role:'CUSTOMER',partyId:'customer'},{role:'OWNER',partyId:'owner'},{role:'PLATFORM',partyId:'platform'}],initial={commercialHash:hash('initial'),lessorSnapshot:{ownerId:'owner',vehicleId:'vehicle'},partiesSnapshot:parties,startDate:'2026-10-01',months:3};
 const order:any={id:'order',customerId:'customer',vehicleId:'vehicle',contractMode:'OFFLINE',effectiveTermsVersionId:null,finalPlanSnapshot:initial};
 const original:any={id:'original',kind:'SUBSCRIPTION',orderId:order.id,customerId:order.customerId,executionMode:'OFFLINE',status:'DRAFT',documentHash:initial.commercialHash,body:'',offlineArchiveId:'rental',providerTaskId:null,signedFileId:null};
 const contracts:any[]=[original],changes:any[]=[],quotes:any[]=[],terms:any[]=[],archives:any[]=[],files:any[]=[],privateIds=new Set<string>(),calls:string[]=[];
 const source=(id:string,customerId:string|null=null)=>{const file={id,mimeType:'application/pdf',size:10,sha256:hash(id),customerId,purpose:'offline-source'};files.push(file);return file;};
 function archive(id:string,kind:string,businessHash:string,scope:any,quoteId:string|null=null){
  const vid=id+'-v1',file={...source(id+'-signed'),purpose:'offline-archive'},binding={versionId:vid,fileId:file.id,position:1,file};
  const version:any={id:vid,archiveId:id,version:1,status:'ARCHIVED',businessSnapshotHash:businessHash,scopeSnapshot:scope,partiesSnapshot:structuredClone(parties),requiredSigners:['CUSTOMER','OWNER','PLATFORM'],files:[binding],feedback:[],fileManifestHash:validateManifest([binding]),sourceFileId:source(id+'-source').id,templateId:'template-'+kind,templateVersion:1,signedOn:'2026-10-01',contractNumber:id,declaredPages:1,submittedBy:'uploader',submittedAt:new Date('2026-10-01T02:00:00Z'),reviewedBy:'reviewer',reviewedAt:new Date('2026-10-01T03:00:00Z'),reviewReason:'逐项核验签字版',reviewChecklist:Object.fromEntries(['partiesComplete','authorityChecked','pagesComplete','vehicleMatches','termsMatch','annexesComplete','legible'].map(key=>[key,true])),partyChecks:parties.map(p=>({...p,passed:true,signaturePageRefs:[{fileId:file.id,page:1}],authorityFileIds:[]}))};
  const a:any={id,kind,subjectType:quoteId?'ORDER_CHANGE_QUOTE':'ORDER',subjectId:quoteId||order.id,orderId:order.id,ownerId:'owner',handoverId:null,quoteId,currentApprovedVersionId:vid,versions:[version]};archives.push(a);return a;
 }
 const rental=archive('rental','RENTAL',initial.commercialHash,{vehicleId:'vehicle'});
 function addChange(applied=false){
  const n=changes.length+1,prior=terms.at(-1)?.snapshot??initial,change:any={id:'change-'+n,orderId:order.id,customerId:order.customerId,kind:'DELIVERY_DELAY',status:applied?'APPLIED':'AWAITING_ARCHIVE',activeQuoteId:'quote-'+n,originalContractId:original.id,originalArchiveVersionId:rental.versions[0].id,priorTermsVersionId:terms.at(-1)?.id??null,priorTerms:structuredClone(prior),priorTermsHash:hash(prior),targetVehicleId:null};
  const body='真实补充协议 '+n,quote:any={id:change.activeQuoteId,changeId:change.id,revision:1,status:'CONFIRMED',commercialHash:hash('commercial-'+n),confirmedAt:new Date('2026-10-10T00:00:00Z'),approvedArchiveVersionId:null,snapshot:{expiresAt:'2026-10-11T00:00:00+00:00',document:{id:'template-ORDER_AMENDMENT',type:'OFFLINE_ORDER_AMENDMENT',version:1,templateHash:hash('template-text'),content:body,bodyHash:hash(body),hash:hash(body)},originalAssignmentId:null}};
  const contract:any={id:'amendment-'+n,orderId:order.id,customerId:order.customerId,kind:'AMENDMENT',delayQuoteId:quote.id,executionMode:'OFFLINE',status:'DRAFT',documentId:quote.snapshot.document.id,templateVersion:1,documentHash:quote.commercialHash,body,providerTaskId:null,signedFileId:null,offlineArchiveId:'amendment-archive-'+n};
  const scope={policy:'OFFLINE_ORDER_CHANGE_V1',orderId:order.id,changeId:change.id,quoteId:quote.id,quoteRevision:quote.revision,commercialHash:quote.commercialHash,priorTermsHash:change.priorTermsHash,priorTermsVersionId:change.priorTermsVersionId,originalContractId:original.id,originalArchiveVersionId:change.originalArchiveVersionId,documentHash:hash(body),vehicleId:'vehicle',targetVehicleId:null,originalAssignmentId:null};
  const a=archive(contract.offlineArchiveId,'ORDER_AMENDMENT',quote.commercialHash,scope,quote.id);changes.push(change);quotes.push(quote);contracts.push(contract);quote.contract=contract;
  if(applied){quote.approvedArchiveVersionId=a.currentApprovedVersionId;const t={id:'terms-'+n,orderId:order.id,quoteId:quote.id,version:n,snapshot:{...structuredClone(prior),commercialHash:quote.commercialHash,amendmentContractId:contract.id,startDate:'2026-11-01'},hash:quote.commercialHash,offlineArchiveVersionId:quote.approvedArchiveVersionId,effectiveAt:new Date('2026-10-12T00:00:00Z')};terms.push(t);order.effectiveTermsVersionId=t.id;}
  return{change,quote,contract,archive:a,version:a.versions[0],terms:terms.at(-1)};
 }
 const tx:any={
  order:{findUnique:async({where}:any)=>{calls.push('order.read');return where.id===order.id?order:null;}},
  orderChange:{findUnique:async({where}:any)=>changes.find(c=>c.id===where.id)??null},
  delayQuote:{findUnique:async({where}:any)=>quotes.find(q=>q.id===where.id)??null},
  contract:{findUnique:async({where}:any)=>contracts.find(c=>c.id===where.id||where.delayQuoteId&&c.delayQuoteId===where.delayQuoteId)??null,findMany:async({where}:any)=>contracts.filter(c=>c.orderId===where.orderId&&['SUBSCRIPTION','RENTAL'].includes(c.kind))},
  documentArchive:{findUnique:async({where}:any)=>archives.find(a=>a.id===where.id||where.quoteId&&a.quoteId===where.quoteId)??null},
  orderTermsVersion:{findMany:async()=>terms.map(t=>({...t,quote:{...quotes.find(q=>q.id===t.quoteId),change:changes.find(c=>c.activeQuoteId===t.quoteId)}}))},
  storedFile:{findUnique:async({where}:any)=>files.find(f=>f.id===where.id)??null},
  archiveCommand:{findFirst:async()=>({id:'true-print-command'})},
  vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async({where}:any)=>where.fileId.in.filter((id:string)=>privateIds.has(id)).length},
 };
 return{tx,order,original,initial,rental,contracts,changes,quotes,terms,archives,files,privateIds,calls,addChange,source};
}
