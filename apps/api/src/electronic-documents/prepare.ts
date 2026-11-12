import {requireCurrentVirtualScope} from '../virtual-acceptance/scope';
import {assertVirtualOrder} from '../virtual-acceptance/quotes';
import {terminationPreparation} from '../orders/termination-document';
import {cancellation04Preparation} from '../orders/cancellation04-document';
import {electronicRenewalPreparation} from '../order-renewals/electronic-agreement';
import {electronicSwapPreparation} from '../vehicle-changes/electronic-agreement';
import {assertGrantSourcesCurrent} from './seal-authorization';
import {buildV31Document} from '../contract-terms/render-model';
import {validTermMonths} from '../service-calendar/rules';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit,hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {archiveCommand} from '../offline-documents/command';
import {ContractPdfArtifactWriterService} from '../contract/contract-pdf-artifact-writer.service';
import {decryptIdentity} from '../esign/fadada/fadada-safety';
import {NINDA_PLATFORM_LEGAL_ENTITY} from '../common/platform-legal-entity';
import {requireFrozenSimpleAgreement} from '../partners/simple-agreements';
import {assertElectronicCooperationCurrent,electronicCooperationMissingFields} from './cooperation';
import {electronicDocumentKinds,ElectronicDocumentKind,SigningContext,SigningPartyInput} from './types';
import {requiredSignerRoles} from './policy';
import {createElectronicTask,assertNoUnclosedSigning} from './repository';
import {requireElectronicCustomerIdentity,resolveSigningParties} from './identities';
import {approvedElectronicBody,buildElectronicPrintModel,electronicTemplateType,ElectronicPrintInput,ElectronicSection,renderElectronicDocument} from './print';
import type {ArchiveParty} from '../offline-documents/parties';
import {freezeV31Preparation,resolveV31RenderSnapshot,assertV31PreparationSourcesCurrent} from '../contract-terms/preparation';
import {v31TemplateType} from '../contract-terms/template-map';
import {assertV31SourcesCurrent} from '../contract-terms/sources';

const inputSchema=z.object({kind:z.enum(electronicDocumentKinds),resourceId:z.string().min(1).max(128),revision:z.number().int().nonnegative(),templateId:z.string().min(1).max(128).optional(),idempotencyKey:z.string().min(8).max(128)}).strict();
export interface ElectronicPreparationContext{
 kind:ElectronicDocumentKind;archiveKind:string;subjectType:string;subjectId:string;orderId?:string;customerId?:string;ownerId:string;revision:number;
 contract?:any;sealGrantId?:string;cooperationVersionId?:string;businessHash:string;parties:ArchiveParty[];context:SigningContext;scope:Record<string,any>;
 sections:ElectronicSection[];variables:Record<string,string>;usageAppendix?:string;templateId?:string;templateHash?:string;
}
const money=(v:any)=>{ensure(Number.isSafeInteger(v)&&v>=0,409,'ELECTRONIC_BUSINESS_CHANGED','约定金额不完整');return(v/100).toFixed(2)+' 元';};
const value=(v:any)=>typeof v==='string'||typeof v==='number'?String(v):'';
function subscriptionSections(b:any,vehicle:any):ElectronicSection[]{
 const terms:Record<string,string>={vehicleIdentification:'车辆标识',permittedUse:'车辆用途',conditionDisclosure:'车况披露',customerAddress:'承租人联系地址',mileageCarryRule:'里程结转',excessMileageCalculation:'超里程计算',usageCosts:'用车费用',insuranceDetails:'保险约定',maintenanceRule:'保养安排',serviceCoverage:'服务范围',handoverArrangement:'交还车安排',earlyTerminationRule:'提前终止',depositRefundRule:'押金退回',otherFees:'其他费用'};
 const product=b.productSnapshot||{},rows=[{label:'车辆',value:`${vehicle.plateNumber||''} / ${vehicle.vin||''} / ${vehicle.brand||''} ${vehicle.model||vehicle.title}`},{label:'合同租期',value:`${b.months} 个月`},{label:'约定起租日',value:value(b.startDate).slice(0,10)},{label:'月费合计',value:money(b.monthlyFeeAmount)},{label:'押金',value:money(b.depositAmount)},{label:'首期付款日',value:value(b.firstDueDate).slice(0,10)},{label:'每月包含里程',value:`${b.mileagePerMonthKm} 公里`},{label:'超里程单价',value:money(b.excessMileagePriceAmount)+'/公里'},{label:'充换电费用',value:b.energyDescription||'客户自付'},{label:'适用条件',value:value(b.conditions)}];
 const agreed=b.agreedFeeComponents??product;
 if(product.configurationVersion===2)rows.push({label:'基础使用费',value:money(agreed.baseFeeAmount)+'/月'},{label:'里程包月费',value:money(agreed.mileageMonthlyFeeAmount)+'/月'});
 if(product.swapPolicy)rows.push({label:'合同期赠送换车',value:`${product.swapPolicy.includedCount} 次`},{label:'额外换车单次服务费',value:money(product.swapPolicy.extraFeeAmount)});
 const sections=[{title:'本单订阅方案',rows},{title:'逐单车辆与服务约定',rows:Object.entries(terms).map(([key,label])=>({label,value:value(b.commercialTerms?.[key])})).filter(r=>r.value)}];
 if(Array.isArray(product.benefits)&&product.benefits.length)sections.push({title:'约定权益',rows:product.benefits.map((p:any)=>({label:value(p.name),value:[value(p.description),p.kind==='COUNT'?`整单额度 ${p.totalQuantity} ${p.unit}`:'',value(p.conditions)].filter(Boolean).join('；')}))});return sections;
}
async function platformParty(tx:any){
 ensure(process.env.FADADA_PLATFORM_CUSTOMER_ID,409,'ELECTRONIC_PLATFORM_MISMATCH','请先登记宁达自己的法大大企业账号');
 const account=await tx.ownerESignAccount.findUnique({where:{providerCustomerId:process.env.FADADA_PLATFORM_CUSTOMER_ID},include:{owner:true}}),owner=account?.owner;
 ensure(owner?.name===NINDA_PLATFORM_LEGAL_ENTITY&&owner.subjectType==='ENTERPRISE',409,'ELECTRONIC_PLATFORM_MISMATCH','平台账号必须独立绑定上海宁达信息科技有限公司');return{role:'PLATFORM',partyId:owner.id,name:owner.name,subjectType:owner.subjectType,creditCode:owner.creditCode};
}
export async function resolveElectronicPreparation(tx:any,kind:ElectronicDocumentKind,resourceId:string):Promise<ElectronicPreparationContext>{
 if(kind==='COOPERATION_GRANT'){
  const base=await resolveElectronicPreparation(tx,'COOPERATION',resourceId);
  const main=await tx.electronicSigningTask.findUnique({where:{cooperationVersionId:resourceId},include:{archiveVersion:true}});
  ensure(main&&main.kind==='COOPERATION'&&!main.withdrawnAt&&!main.retiredAt&&!['DECLINED','EXPIRED'].includes(main.status),409,'V31_GRANT_MAIN_REQUIRED','请先准备有效主合作协议');
  const frozen=main.archiveVersion.scopeSnapshot?.v31Sources;
  ensure(frozen?.hash&&frozen.snapshot,409,'V31_GRANT_SCOPE_REQUIRED','主协议缺少冻结授权范围');
  await assertGrantSourcesCurrent(tx,frozen);
  let grant=await tx.electronicSealGrant.findFirst({where:{cooperationVersionId:resourceId},orderBy:{version:'desc'},include:{task:{include:{parties:true}}}});
  if(grant?.revokedAt){const old=grant.task;ensure(!old||old.status==='ARCHIVED'||!old.parties.some((p:any)=>p.attemptedAt)||old.stopStatus==='PROVIDER_CLOSED',409,'ELECTRONIC_STOP_REVIEW_REQUIRED','原授权流尚未核验关闭，不可新建冲突授权');}
  if(!grant||grant.revokedAt)grant=await tx.electronicSealGrant.create({data:{cooperationVersionId:resourceId,version:(grant?.version??0)+1,previousGrantId:grant?.id,ownerId:base.ownerId,mainTaskId:main.id,sourceHash:frozen.hash,sourceSnapshot:frozen}});
  ensure(grant.sourceHash===frozen.hash&&!grant.revokedAt,409,'V31_GRANT_REVOKED','独立授权已撤销或来源已变化，请建立新合作版本');
  return{...base,kind,archiveKind:kind,subjectType:'ELECTRONIC_SEAL_GRANT',subjectId:grant.id,cooperationVersionId:undefined,sealGrantId:grant.id,context:{...base.context,kind},scope:{...base.scope,sealGrantId:grant.id}};
 }
 ensure(!['COOPERATION_AMENDMENT','COOPERATION_TERMINATION'].includes(kind),409,'V31_COOPERATION_TEMPLATE_UNAVAILABLE','合作变更或终止正文尚未审定，暂不可办理');
 const platform=await platformParty(tx);
 if(kind.startsWith('COOPERATION')){
  const source=await tx.partnerAgreementVersion.findUnique({where:{id:resourceId}});ensure(source,404,'NOT_FOUND','合作条款版本不存在');
  const {version,agreement,owner}=await assertElectronicCooperationCurrent(tx,resourceId,source.contentHash,true);
  ensure(version.electronicTerms.kind===kind&&!electronicCooperationMissingFields(version).length,409,'ELECTRONIC_COOPERATION_SOURCE','合作条款未补齐或协议种类不匹配');
  const vehicles=await tx.vehicle.findMany({where:{id:{in:version.vehicleIds}},orderBy:{id:'asc'}});
  for(const v of vehicles)if(v.virtualAcceptanceScopeId){const scoped=await requireCurrentVirtualScope(tx,{vehicleId:v.id,action:'PREPARE'});ensure(vehicles.length===1&&scoped?.cooperationVersionId===version.id&&scoped.ownerId===owner.id&&scoped.platformId===platform.partyId,409,'VIRTUAL_SCOPE_MISMATCH','测试合作主体或车辆范围不符');}
  ensure(vehicles.length===version.vehicleIds.length&&vehicles.every((v:any)=>v.virtualAcceptanceScopeId||v.vin?.trim()),409,'ELECTRONIC_COOPERATION_SOURCE','合作车辆或 VIN 资料不完整');
  const scope={cooperationVersionId:version.id,cooperationTerms:version.electronicTerms,vehicleFacts:vehicles.map((v:any)=>({id:v.id,plateNumber:v.plateNumber,vin:v.vin})),contentHash:version.contentHash};
  let previousContractNo='无';if(version.electronicTerms.previousVersionId){const previous=await tx.electronicSigningTask.findUnique({where:{cooperationVersionId:version.electronicTerms.previousVersionId},include:{archiveVersion:true}});ensure(previous?.status==='ARCHIVED'&&previous.businessHash===version.electronicTerms.previousHash&&previous.archiveVersion?.contractNumber,409,'ELECTRONIC_COOPERATION_SOURCE','原电子合作协议编号或版本凭据缺失');previousContractNo=previous.archiveVersion.contractNumber;}
  return{kind,archiveKind:kind,subjectType:'PARTNER_AGREEMENT',subjectId:agreement.id,ownerId:owner.id,revision:agreement.revision,cooperationVersionId:version.id,businessHash:version.contentHash,parties:[{role:'OWNER',partyId:owner.id,name:owner.name,subjectType:owner.subjectType,creditCode:owner.creditCode},platform],context:{kind,platformSubjectId:platform.partyId,cooperationVersionId:version.id,vehicleIds:[...version.vehicleIds].sort()},scope,variables:{previousContractNo,terminationDate:version.electronicTerms.terminationDate||'',terminationReason:version.electronicTerms.terminationReason||''},sections:[{title:'本次合作条款',rows:[{label:'合作车辆',value:vehicles.map((v:any)=>`${v.plateNumber||'未登记车牌'} / VIN ${v.vin} / ${v.brand} ${v.model||v.title}`).join('\n')},{label:'合作方分润比例',value:(version.partnerRateBps/100).toFixed(2)+'%'},{label:'生效起日',value:version.validFrom||'双方有效签署后'},{label:'有效截止日',value:version.validUntil||'未约定截止日'},{label:'补充约定',value:version.notes||'无'}]}]};
 }
 if(kind==='EARLY_TERMINATION')return terminationPreparation(tx,resourceId);
 if(kind==='PRE_DELIVERY_CANCELLATION')return cancellation04Preparation(tx,resourceId);
 if(kind==='RENEWAL')return electronicRenewalPreparation(tx,resourceId);
 if(kind==='VEHICLE_SWAP')return electronicSwapPreparation(tx,resourceId);
 ensure(kind==='SUBSCRIPTION',409,'ELECTRONIC_PREPARATION_NOT_READY','本类电子协议准备入口尚未完成业务接入');
 await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${resourceId} FOR UPDATE`;
 const order=await tx.order.findUnique({where:{id:resourceId},include:{customer:true,vehicle:true}}),b=order?.finalPlanSnapshot;
 ensure(order?.contractMode==='ELECTRONIC'&&['AWAITING_CONTRACT_REVIEW','AWAITING_SIGNATURE','AWAITING_PAYMENT'].includes(order.status),409,'ELECTRONIC_BUSINESS_CHANGED','订单当前阶段不能准备主合同');
 const contract=await tx.contract.findFirst({where:{orderId:order.id,kind:'SUBSCRIPTION'},orderBy:{createdAt:'desc'},include:{electronicTask:true}}),lessor=b?.lessorSnapshot;
 ensure(contract?.executionMode==='ELECTRONIC'&&contract.documentHash===b.commercialHash&&lessor?.executionMode==='ELECTRONIC'&&lessor.vehicleId===order.vehicleId&&b.partiesSnapshot?.find((p:any)=>p.role==='CUSTOMER')?.partyId===order.customerId,409,'ELECTRONIC_BUSINESS_CHANGED','订单冻结主体、车辆或报价不一致');
 const virtual=await assertVirtualOrder(tx,order);if(!virtual)await requireFrozenSimpleAgreement(tx,order.vehicleId,lessor,b.revenueRuleSnapshot,lessor.leaseRange);
 const expected=b.partiesSnapshot;ensure(Array.isArray(expected)&&expected.length===3&&[{role:'CUSTOMER',id:order.customerId,type:'INDIVIDUAL'},{role:'OWNER',id:lessor.ownerId,type:lessor.subjectType},{role:'PLATFORM',id:platform.partyId,type:'ENTERPRISE'}].every(x=>expected.filter((p:any)=>p.role===x.role&&p.partyId===x.id&&p.subjectType===x.type).length===1),409,'ELECTRONIC_PARTIES_MISMATCH','须使用客户确认的本单三方主体');
 const owner=await tx.vehicleOwner.findUnique({where:{id:lessor.ownerId}});ensure(owner&&owner.name===lessor.name&&owner.subjectType===lessor.subjectType&&owner.creditCode===lessor.creditCode&&owner.status!=='SUSPENDED',409,'ELECTRONIC_BUSINESS_CHANGED','实际出租方资料已变化');
 ensure(b.months===b.productSnapshot?.months&&b.productSnapshot?.minimumTermMonths!=null&&validTermMonths(b.months,b.productSnapshot?.minimumTermMonths)&&Number.isInteger(b.mileagePerMonthKm)&&b.mileagePerMonthKm>=0&&b.startDate&&b.firstDueDate&&b.commercialTerms?.customerAddress,409,'ELECTRONIC_BUSINESS_CHANGED','订阅期限、里程或逐单联系资料不完整');
 return{kind,archiveKind:'RENTAL',subjectType:'ORDER',subjectId:order.id,orderId:order.id,customerId:order.customerId,ownerId:owner.id,revision:order.revision,contract,businessHash:b.commercialHash,parties:[{role:'CUSTOMER',partyId:order.customerId,name:order.customer.name,subjectType:'INDIVIDUAL'},{role:'OWNER',partyId:owner.id,name:owner.name,subjectType:owner.subjectType,creditCode:owner.creditCode},platform],context:{kind,orderId:order.id,platformSubjectId:platform.partyId,cooperationVersionId:lessor.agreementVersionId,vehicleIds:[order.vehicleId]},scope:{vehicleId:order.vehicleId,vehicleFacts:[{id:order.vehicleId,plateNumber:order.vehicle.plateNumber,vin:order.vehicle.vin}],lessorHash:canonicalHash(lessor)},sections:subscriptionSections(b,order.vehicle),variables:{},templateId:lessor.templateId,templateHash:lessor.templateHash};
}
async function privatePrintParties(tx:any,parties:ArchiveParty[]):Promise<ArchiveParty[]>{
 const result:ArchiveParty[]=[];
 for(const party of parties){
  if(party.subjectType!=='INDIVIDUAL'){result.push(party);continue;}
  const owner=party.role==='OWNER'?await tx.ownerESignAccount.findUnique({where:{ownerId:party.partyId}}):null,customerId=owner?.managerCustomerId||party.partyId;
  const {customer,account}=await requireElectronicCustomerIdentity(tx,customerId),identity=decryptIdentity(account.identityCiphertext,customerId,process.env.ESIGN_IDENTITY_ENCRYPTION_KEY||'');
  ensure(identity.name===party.name,409,'ELECTRONIC_PARTIES_MISMATCH','合同姓名与法大大实名不一致');result.push({...party,identityNumber:identity.idCardNo,phone:customer.mobile});
 }return result;
}
export type ElectronicPreparationOptions={resolveContext?:typeof resolveElectronicPreparation;resolveParties?:typeof resolveSigningParties;printParties?:typeof privatePrintParties;fontPath?:string};
export async function prepareElectronicDocument(tx:any,raw:unknown,actorId:string,writer:ContractPdfArtifactWriterService,options:ElectronicPreparationOptions={}){
 const input=inputSchema.parse(raw),staff=await tx.adminUser.findUnique({where:{id:actorId}});ensure(staff?.active&&['ADMIN','OPERATIONS'].includes(staff.role),403,'FORBIDDEN','仅当前管理员或运营可准备电子协议');
 const lock=`electronic-prepare:${input.kind}:${input.resourceId}`;await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lock}))`;
 return archiveCommand(tx,{id:actorId,role:staff.role},input.resourceId,'ELECTRONIC_PREPARE',input,async()=>{
  const source=await(options.resolveContext??resolveElectronicPreparation)(tx,input.kind,input.resourceId);ensure(source.kind===input.kind&&source.revision===input.revision,409,'REVISION_CONFLICT','业务版本已变化，请刷新后准备');
  await assertNoUnclosedSigning(tx,source.subjectType,source.subjectId);
  const v31Sources=source.sealGrantId?(await tx.electronicSealGrant.findUniqueOrThrow({where:{id:source.sealGrantId}})).sourceSnapshot:await freezeV31Preparation(tx,{kind:input.kind==='COOPERATION_GRANT'?'COOPERATION':input.kind,resourceId:input.resourceId,revision:['PRE_DELIVERY_CANCELLATION','EARLY_TERMINATION'].includes(input.kind)?source.scope.confirmedRevision:['VEHICLE_SWAP','RENEWAL'].includes(input.kind)?source.scope.quoteRevision:input.revision,businessHash:source.businessHash});
  const old=source.sealGrantId?await tx.electronicSigningTask.findUnique({where:{sealGrantId:source.sealGrantId},include:{parties:true}}):source.cooperationVersionId?await tx.electronicSigningTask.findUnique({where:{cooperationVersionId:source.cooperationVersionId},include:{parties:true}}):source.contract?.electronicTask;
  ensure(!old||!['WITHDRAWN','DECLINED','EXPIRED','RETIRED'].includes(old.status)||!old.parties.some((p:any)=>p.attemptedAt)||old.stopStatus==='PROVIDER_CLOSED',409,'ELECTRONIC_STOP_REVIEW_REQUIRED','原版本已有外部签署请求，须先核验关闭与法律状态');
  if(old&&!['WITHDRAWN','DECLINED','EXPIRED','RETIRED'].includes(old.status)){
   ensure(old.businessHash===source.businessHash,409,'ELECTRONIC_BUSINESS_CHANGED','原任务与当前业务版本不一致');
   const frozen=await tx.archiveVersion.findUnique({where:{id:old.archiveVersionId}});
   ensure(frozen?.scopeSnapshot?.v31Sources,409,'V31_SOURCES_CHANGED','原任务缺少当前版本的来源快照');
   assertV31PreparationSourcesCurrent(frozen.scopeSnapshot.v31Sources,v31Sources);
   return{archiveVersionId:old.archiveVersionId,taskId:old.id};
  }
  ensure(!old||!(source.cooperationVersionId||source.sealGrantId),409,'ELECTRONIC_COOPERATION_SOURCE','已关闭合作签署请保存新的合作条款版本');
  const virtualSource=(v31Sources as any).snapshot?.virtualAcceptance,virtual=virtualSource?await requireCurrentVirtualScope(tx,{vehicleId:virtualSource.vehicleId,customerId:source.customerId,orderId:source.orderId,action:'PREPARE'}):null;
  const scopedTemplate=virtual?input.kind==='SUBSCRIPTION'?virtual.subscriptionTemplateId:input.kind==='COOPERATION'?virtual.cooperationTemplateId:input.kind==='COOPERATION_GRANT'?virtual.grantTemplateId:null:null;
  ensure(!virtual||scopedTemplate&&(!input.templateId||input.templateId===scopedTemplate),409,'VIRTUAL_TEMPLATE_MISMATCH','必须使用范围冻结的初始文书');
  const templateId=source.templateId||scopedTemplate||input.templateId;ensure(!source.templateId||!input.templateId||source.templateId===input.templateId,409,'ELECTRONIC_TEMPLATE_CHANGED','请使用客户已确认的模板版本');
  const template=templateId?await tx.legalDocument.findUnique({where:{id:templateId}}):await tx.legalDocument.findFirst({where:{type:v31TemplateType(input.kind),status:'PUBLISHED'},orderBy:{version:'desc'}});
  ensure(template?.type===v31TemplateType(input.kind),409,'LEGAL_NOT_APPROVED','新协议须使用独立审定的 V3.1 正文');approvedElectronicBody(template,input.kind);
  ensure(!source.templateHash||source.templateHash===hash(template.content),409,'ELECTRONIC_TEMPLATE_CHANGED','冻结的已审定正文已变化');
  let archive=await tx.documentArchive.findUnique({where:{subjectType_subjectId_kind:{subjectType:source.subjectType,subjectId:source.subjectId,kind:source.archiveKind}}});
  if(!archive)archive=await tx.documentArchive.create({data:{kind:source.archiveKind,subjectType:source.subjectType,subjectId:source.subjectId,...(source.subjectType==='ORDER_CHANGE_QUOTE'?{quoteId:source.subjectId}:{}),ownerId:source.ownerId,orderId:source.orderId,createdBy:actorId}});
  ensure(archive.ownerId===source.ownerId&&archive.orderId===(source.orderId??null),409,'ELECTRONIC_REFERENCE_MISMATCH','文件档案归属不匹配');
  const latest=await tx.archiveVersion.findFirst({where:{archiveId:archive.id},orderBy:{version:'desc'}}),number=`ND${input.kind.startsWith('COOPERATION')?'C':'S'}-${archive.id}-${(latest?.version||0)+1}`;
  if(v31Sources.snapshot.virtualAcceptance)source.context.signaturePolicy='MANUAL_ONLY';
  if(process.env.OWNER_AUTHORIZATION_SCOPE_VERSION==='3'&&!source.context.signaturePolicy){source.context.autoSigningPolicyVersion=3;source.context.authorityCreatedBefore=new Date().toISOString();}
  const scope={...source.scope,electronicContext:source.context,templateHash:hash(template.content),v31Sources};
  const version=await tx.archiveVersion.create({data:{archiveId:archive.id,version:(latest?.version||0)+1,executionMode:'ELECTRONIC',templateId:template.id,templateVersion:template.version,businessSnapshotHash:source.businessHash,partiesSnapshot:JSON.parse(JSON.stringify(source.parties)),requiredSigners:requiredSignerRoles(input.kind),scopeSnapshot:scope,contractNumber:number,createdBy:actorId}});
  const parties=await(options.resolveParties??resolveSigningParties)(tx,version.id),printParties=await(options.printParties??privatePrintParties)(tx,source.parties);
  const v31Snapshot=await resolveV31RenderSnapshot(tx,v31Sources,printParties,number,template);
  if(source.sealGrantId){
   const grant=await tx.electronicSealGrant.findUniqueOrThrow({where:{id:source.sealGrantId}}),main=await tx.electronicSigningTask.findUniqueOrThrow({where:{id:grant.mainTaskId},include:{archiveVersion:true}}),mainTemplate=await tx.legalDocument.findUniqueOrThrow({where:{id:main.archiveVersion.templateId}});
   ensure(hash(mainTemplate.content)===main.archiveVersion.scopeSnapshot.templateHash,409,'V31_TEMPLATE_CHANGED','主合作正文已变化');
   const mainSnapshot=await resolveV31RenderSnapshot(tx,grant.sourceSnapshot,printParties,main.archiveVersion.contractNumber,mainTemplate);
   const mainDocument=buildV31Document({kind:'COOPERATION'},mainSnapshot,mainTemplate),start=mainDocument.sections.findIndex(n=>n.loc==='P067'),end=mainDocument.sections.findIndex(n=>n.loc==='P074');
   ensure(start>=0&&end>start,409,'V31_GRANT_SCOPE_REQUIRED','主协议附件一不完整');
   v31Snapshot.grantReference={agreementNumber:main.archiveVersion.contractNumber,agreementHash:main.archiveVersion.scopeSnapshot.bodyHash,attachmentOne:mainDocument.sections.slice(start,end)};
  }
  const print:ElectronicPrintInput={kind:input.kind,number,version:version.version,businessHash:source.businessHash,template,parties:printParties,sections:source.sections,variables:source.variables,usageAppendix:source.usageAppendix,v31Snapshot,...(virtual?{virtualAcceptance:{schema:'NINDA_VIRTUAL_ACCEPTANCE_V1' as const,scopeId:virtual.id,configurationHash:virtual.configurationHash,customerId:virtual.customerId,ownerId:virtual.ownerId,platformId:virtual.platformId,templateHash:hash(template.content),noticeHash:virtual.noticeHash,wrapperHash:virtual.wrapperHash}}:{})};
  const model=buildElectronicPrintModel(print),rendered=await renderElectronicDocument(print,options.fontPath),file=await writer.persistPdf(rendered.buffer,{customerId:source.customerId??null,name:`${template.title}-${number}.pdf`,purpose:'electronic-source'},tx);
  const bodyHash=canonicalHash(model.body);
  await tx.archiveVersion.update({where:{id:version.id},data:{sourceFileId:file.id,scopeSnapshot:{...scope,bodyHash,electronicDocument:{title:template.title,positions:rendered.positions,pageCount:rendered.pageCount}}}});
  // Full rendered text contains private identity/contact data. Only the protected PDF stores it.
  const bodyReference=JSON.stringify({format:'PRIVATE_ELECTRONIC_PDF',archiveVersionId:version.id,sourceFileId:file.id,sourceSha256:file.sha256,bodyHash});
  let contract=source.contract;
  if(contract){const data={orderId:source.orderId,customerId:source.customerId,executionMode:'ELECTRONIC',kind:contract.kind,documentHash:source.businessHash,sourceFileId:file.id,documentId:template.id,templateVersion:template.version,body:bodyReference,offlineArchiveId:archive.id};contract=old?await tx.contract.create({data}):await tx.contract.update({where:{id:contract.id},data});}
  const task=await createElectronicTask(tx,{archiveVersionId:version.id,contractId:contract?.id,cooperationVersionId:source.cooperationVersionId,sealGrantId:source.sealGrantId,context:source.context,parties,approvedBy:actorId,now:new Date()});
  await audit(tx,actorId,'ELECTRONIC_PREPARED','electronic-documents',task.id,{archiveVersionId:version.id,templateId:template.id,templateHash:hash(template.content),sourceSha256:file.sha256,businessHash:source.businessHash});return{archiveVersionId:version.id,taskId:task.id};
 });
}
export class ElectronicPreparationService{
 constructor(private db:Db,private writer:ContractPdfArtifactWriterService){}
 prepareSubscription(orderId:string,revision:number,actorId:string,idempotencyKey:string){return this.prepare({kind:'SUBSCRIPTION',resourceId:orderId,revision,idempotencyKey},actorId);}
 prepare(raw:unknown,actorId:string){return this.db.serial(tx=>prepareElectronicDocument(tx,raw,actorId,this.writer));}
}
