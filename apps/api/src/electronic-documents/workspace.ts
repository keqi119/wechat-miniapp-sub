import {readTermination} from '../orders/termination';
import {HttpException} from '@nestjs/common';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {requireCurrentStaff} from '../auth/staff-session';
import {requireOwnerLegalRepresentative} from '../owner-h5/legal-representative';
import {resolveV31SourceIds} from '../contract-terms/sources';
import {freezeV31Preparation} from '../contract-terms/preparation';
import {v31TemplateType} from '../contract-terms/template-map';
import {resolveElectronicPreparation} from './prepare';
import {preparationSigningParties} from './identities';
import {approvedElectronicBody} from './print';
import {selectSigningModes} from './policy';
import type {ElectronicActor} from './access';

export async function readContractWorkspace(tx:any,actor:ElectronicActor,orderId:string,channel:{configured:boolean;signingEnabled:boolean}){
 let staff:any=null;
 if(actor.kind==='ADMIN'){staff=await tx.adminUser.findUnique({where:{id:actor.id}});await requireCurrentStaff(tx,{id:actor.id,role:actor.role??staff?.role,authVersion:actor.authVersion},'electronic-documents',false);}
 const order=await tx.order.findUnique({where:{id:orderId}});ensure(order,404,'NOT_FOUND');
 const terms=order.finalPlanSnapshot as any,ownerId=terms?.lessorSnapshot?.ownerId,platformId=terms?.partiesSnapshot?.find((p:any)=>p.role==='PLATFORM')?.partyId;
 if(actor.kind==='CUSTOMER')ensure(order.customerId===actor.id,404,'NOT_FOUND');
 if(actor.kind==='OWNER'){ensure(actor.ownerId&&(actor.ownerId===ownerId||actor.ownerId===platformId),404,'NOT_FOUND');await requireOwnerLegalRepresentative(tx,actor.id,actor.ownerId!);}
 ensure(order.contractMode==='ELECTRONIC',409,'EXECUTION_MODE_MISMATCH');
 const operator=!!staff&&['ADMIN','OPERATIONS'].includes(staff.role),finance=!!staff&&['ADMIN','FINANCE'].includes(staff.role);
 const orderHref='#orders?record='+encodeURIComponent(orderId)+'&view=contracts';
 const missing=(field:string,reason:string,resourceType='ORDER',resourceId:string|null=orderId,api:string|null=null)=>({field,reason,sourceResource:{type:resourceType,id:resourceId},responsibleRole:field.startsWith('CUSTOMER.')?'CUSTOMER':field.startsWith('OWNER.')?'OWNER_LEGAL':field.startsWith('PLATFORM.')?'PLATFORM_LEGAL':'OPERATIONS',action:{enabled:operator&&!!api,method:'GET',route:operator?api:null,href:operator?orderHref:null}});
 async function sourceGate(m:any){
  const type=m.sourceResource?.type,id=m.sourceResource?.id;let route:string|null=null,href:string|null=null;
  if(type==='VEHICLE_OWNER'&&id){route='/admin/vehicle-owners/'+encodeURIComponent(id);href='#vehicle-owners?record='+encodeURIComponent(id);}
  if(type==='VEHICLE'&&id){route='/admin/vehicles/'+encodeURIComponent(id);href='#vehicles?record='+encodeURIComponent(id);}
  if(type==='CUSTOMER'&&id){route='/admin/customers/'+encodeURIComponent(id);href='#customers?record='+encodeURIComponent(id);}
  if(type==='PRODUCT_VERSION'&&id){const version=await tx.productVersion.findUnique({where:{id},select:{productId:true}});if(version){route='/admin/products/'+encodeURIComponent(version.productId);href='#products?record='+encodeURIComponent(version.productId);}}
  const gate=missing(m.field,m.reason,type,id,route);gate.action.href=operator?href:null;return gate;
 }
 const candidates:any[]=[];
 if(['AWAITING_CONTRACT_REVIEW','AWAITING_SIGNATURE','AWAITING_PAYMENT'].includes(order.status))candidates.push({kind:'SUBSCRIPTION',resourceId:order.id,revision:order.revision,businessHash:terms?.commercialHash});
 for(const c of await tx.orderChange.findMany({where:{orderId,customerId:order.customerId,status:{in:['DRAFT','REVIEW_PENDING','REVIEWED','AWAITING_CONFIRMATION','AWAITING_SIGNATURE']}},orderBy:[{createdAt:'asc'},{id:'asc'}]})){
  const q=c.activeQuoteId?await tx.delayQuote.findUnique({where:{id:c.activeQuoteId}}):null;
  if(q)candidates.push({kind:c.kind==='VEHICLE_CHANGE'?'VEHICLE_SWAP':c.kind==='SUBSCRIPTION_EXTENSION'?'RENEWAL':null,resourceId:c.id,revision:c.revision,sourceRevision:q.revision,businessHash:q.commercialHash});
 }
 for(const c of await tx.orderPreDeliveryCancellation.findMany({where:{orderId,customerId:order.customerId},orderBy:{version:'asc'}}))if(['PROPOSED','VERIFIED','CONFIRMED'].includes(c.state))candidates.push({kind:'PRE_DELIVERY_CANCELLATION',resourceId:c.id,revision:c.revision,businessHash:c.proposalHash});
 for(const c of await tx.orderTermination.findMany({where:{orderId,customerId:order.customerId,kind:'AGREED06',state:{in:['PROPOSED','VERIFIED','CONFIRMED']}},orderBy:{version:'asc'}}))candidates.push({kind:'EARLY_TERMINATION',resourceId:c.id,revision:c.revision,businessHash:c.proposalHash});
 const readiness=[];
 for(const c of candidates.filter(c=>c.kind)){
  const gates:any[]=[];let signing:any=null;
  try{
   if(c.kind==='SUBSCRIPTION'){
    ensure(ownerId,409,'V31_BUSINESS_MISMATCH','缺少本单冻结出租方，请核对客户确认方案');
    const current=await resolveV31SourceIds(tx,{ownerId,cooperationVersionId:terms?.lessorSnapshot?.agreementVersionId,customerId:order.customerId,vehicleId:order.vehicleId,productVersionId:terms?.productSnapshot?.productVersionId});
    for(const m of current.missing)gates.push(await sourceGate(m));
   }
   if(!gates.length){
    const source=await resolveElectronicPreparation(tx,c.kind,c.resourceId);
    c.revision=source.revision;c.businessHash=source.businessHash;c.sourceRevision=source.scope.quoteRevision??source.scope.confirmedRevision??source.revision;
    const context={kind:source.kind,resourceId:c.resourceId,revision:c.sourceRevision,businessHash:source.businessHash};
    await freezeV31Preparation(tx,context);
    const template=source.templateId?await tx.legalDocument.findUnique({where:{id:source.templateId}}):await tx.legalDocument.findFirst({where:{type:v31TemplateType(c.kind),status:'PUBLISHED'},orderBy:{version:'desc'}});
    approvedElectronicBody(template,c.kind);ensure(!source.templateHash||source.templateHash===hash(template.content),409,'ELECTRONIC_TEMPLATE_CHANGED');
    signing=selectSigningModes(await preparationSigningParties(tx,source),new Date(),source.context);
    // Manual pages require genuine channel-subject acceptance; local configuration is not proof.

   }
  }catch(error){
   if(!(error instanceof HttpException))throw error;
   const e=(error.getResponse() as any)?.error,role=e?.signingRole,id=e?.subjectId;
   const eligibility=error.getStatus()===403&&['CUSTOMER','OWNER','PLATFORM'].includes(role)&&typeof id==='string'&&['OWNER_LEGAL_REQUIRED','ELECTRONIC_OWNER_IDENTITY_REQUIRED','ELECTRONIC_IDENTITY_REQUIRED'].includes(e?.code);
   if(error.getStatus()!==409&&!eligibility)throw error;
   let structured:any=null;
   if(e?.code==='V31_SOURCE_REQUIRED'&&typeof e.message==='string'){try{const parsed=JSON.parse(e.message);if(Array.isArray(parsed)&&parsed.length&&parsed.every(m=>typeof m?.field==='string'&&typeof m?.reason==='string'&&typeof m?.sourceResource?.type==='string'&&(m.sourceResource.id===null||typeof m.sourceResource.id==='string')))structured=parsed;}catch{/* Non-structured business errors retain their explicit original code below. */}}
   if(structured){for(const m of structured)gates.push(await sourceGate(m));}
   else{
    const type=role==='CUSTOMER'?'CUSTOMER':role?'VEHICLE_OWNER':'ORDER';
    const gate=missing(e?.code??'SOURCE_REVIEW_REQUIRED',e?.message??'请核对当前冻结业务来源',type,id??order.id,role?null:'/admin/orders/'+encodeURIComponent(order.id));
    if(role)gate.responsibleRole=role==='CUSTOMER'?'CUSTOMER':role==='PLATFORM'?'PLATFORM_LEGAL':'OWNER_LEGAL';
    gates.push(gate);
   }
  }
  if(!channel.configured||!channel.signingEnabled)gates.push({...missing('CHANNEL.signingDisabled','当前真实签署办理未开放','CHANNEL',null),responsibleRole:'PLATFORM_LEGAL'});
  readiness.push({kind:c.kind,resourceId:c.resourceId,revision:c.revision??null,sourceRevision:c.sourceRevision??null,businessHash:c.businessHash??null,ready:gates.length===0,canPrepare:operator&&!gates.some(g=>!g.field.startsWith('CHANNEL.')),externalVerification:{status:'UNKNOWN',responsibleRoles:['RELEASE_CONTROLLER','OWNER_LEGAL','PLATFORM_LEGAL'],reason:'本地条件不代表真实渠道主体隔离及签署验收已通过'},missing:gates,signing,prepare:operator?{method:'POST',route:'/admin/electronic-documents/prepare'}:null});
 }
 const handovers=await tx.handover.findMany({where:{orderId,customerId:order.customerId},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,type:true,status:true,revision:true,confirmationMode:true,actualAt:true,completedAt:true,assignmentId:true}});
 const cancellations=await tx.orderRenewalCancellation.findMany({where:{orderId,customerId:order.customerId},orderBy:{createdAt:'desc'},select:{id:true,changeId:true,revision:true,status:true,sourceHash:true,lifecycleState:true}});
 const terminations=await tx.orderTermination.findMany({where:{orderId,customerId:order.customerId},orderBy:{version:'desc'}});
 const notices=[];
 for(const c of terminations){const proof=await readTermination(tx,c.id),verified=proof.facts.some((f:any)=>f.kind==='EFFECTIVE');for(const f of proof.facts){
  for(const n of (f.kind==='PROPOSED'?(c.proposal as any)?.notices:[])??[]){if(actor.kind==='CUSTOMER'&&n.recipientId!==actor.id||actor.kind==='OWNER'&&n.recipientId!==actor.ownerId)continue;
   notices.push({evidenceStatus:verified?'VERIFIED_SOURCE':'RECORDED_UNVERIFIED',contentIntegrity:'IMMUTABLE_PROPOSAL_HASH',proposalHash:c.proposalHash,kind:'CONTRACTUAL_NOTICE_EVIDENCE',terminationId:c.id,factId:f.id,factHash:f.factHash,content:n.content,contentVersion:n.contentVersion,contentHash:canonicalHash({content:n.content,version:n.contentVersion}),recipientId:n.recipientId,channel:n.channel,channelSource:n.channelSource,arrivedAt:verified?n.arrivedAt:null,reportedArrivalAt:n.arrivedAt,arrivalEvidenceFileIds:n.arrivalEvidenceFileIds,recordedAt:f.recordedAt,readAt:null,agreement:false,sourceRoute:actor.kind==='OWNER'?null:'/'+(actor.kind==='ADMIN'?'admin':'customer')+'/orders/'+encodeURIComponent(orderId)+'/termination'});
  }
 }}
 const tasks=await tx.electronicSigningTask.findMany({where:{orderId,customerId:order.customerId},select:{id:true}});
 const notificationWhere:any={resourceType:'ELECTRONIC_DOCUMENT',resourceId:{in:tasks.map((t:any)=>t.id)}};
 if(actor.kind==='CUSTOMER')notificationWhere.customerId=actor.id;
 if(actor.kind==='OWNER')notificationWhere.customerId=actor.id;
 const notifications=(await tx.notification.findMany({where:notificationWhere,orderBy:[{createdAt:'desc'},{id:'desc'}]})).map((n:any)=>({id:n.id,recordType:'IN_APP_REMINDER',contentIntegrity:'CURRENT_ROW_OBSERVATION',taskId:n.resourceId,recipientId:n.customerId,title:n.title,content:n.content,contentVersion:n.id,contentHash:canonicalHash({title:n.title,content:n.content}),createdAt:n.createdAt,readAt:n.readAt,channel:'AUTHENTICATED_IN_APP',externalSentAt:null,receiptStatus:'UNKNOWN',agreement:false,readAction:actor.kind==='CUSTOMER'&&n.customerId===actor.id?{method:'POST',route:'/customer/notifications/'+encodeURIComponent(n.id)+'/read'}:null}));
 const refunds=finance?await tx.refund.findMany({where:{payment:{bill:{orderId}}},select:{id:true,status:true,paymentId:true,amount:true}}):[];
 return{orderId,contractMode:'ELECTRONIC',channel,permissions:{prepare:operator,personalSign:actor.kind!=='ADMIN',finance},readiness,related:{notifications,handovers:handovers.map((h:any)=>({recordType:'HANDOVER_FACT',...h})),renewalCancellations:cancellations.map((c:any)=>({recordType:'RENEWAL_CANCELLATION_FACT',...c})),terminations:terminations.map((c:any)=>({recordType:c.kind==='AGREED06'?'TERMINATION_CASE':'UNILATERAL_GROUNDS',id:c.id,kind:c.kind,state:c.state,revision:c.revision,sourceHash:c.sourceHash})),notices,refunds:refunds.map((r:any)=>({...r,executionRoute:'/admin/refunds/'+encodeURIComponent(r.id)+'/execution',reconciliationsRoute:'/admin/payments/'+encodeURIComponent(r.paymentId)+'/reconciliations'}))},sources:{service:'/admin/orders/'+encodeURIComponent(orderId),custody:handovers.map((h:any)=>h.id),effectiveTermsVersionId:order.effectiveTermsVersionId??null}};
}
