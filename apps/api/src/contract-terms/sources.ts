import {revalidateRenewalQuote} from '../order-renewals/quotes';
import {electronicRenewalBusiness} from '../order-renewals/electronic-agreement';
import {approvedElectronicBody} from '../electronic-documents/print';
import {electronicSwapBusiness} from '../vehicle-changes/electronic-agreement';
import {validTermMonths} from '../service-calendar/rules';
import {readEnterpriseIdentitySource} from '../electronic-documents/identities';
import {requireCurrentQualification} from '../customers/qualifications';
import {effectivePolicyVersion,validRegistration} from '../insurance/registration-facts';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {ensure} from '../common/errors';
import {NINDA_PLATFORM_LEGAL_ENTITY} from '../common/platform-legal-entity';
import {productVersionInclude} from '../products/types';
import {versionSnapshot} from '../products/snapshot';
import {accountHash} from '../partners/revenue-types';
import {validateV31Template} from './template-map';
import {cooperationSourcesInput,enterpriseContractProfileInput,V31_COOPERATION_CALENDAR,V31_DEPOSIT_CREDIT_POLICY,type V31Context,type V31SourceIds,type MissingField} from './types';
import {requireCurrentVirtualScope} from '../virtual-acceptance/scope';
import {VIRTUAL_FACTS} from '../virtual-acceptance/configuration';

/** JSON contains explicit public source fields and private evidence references only. */
export function freezeV31Sources(input:unknown):{snapshot:unknown;hash:string}{const snapshot=JSON.parse(JSON.stringify(input));return{snapshot,hash:canonicalHash(snapshot)};}
export function assertV31SourcesCurrent(frozen:{snapshot:unknown;hash:string},current:{snapshot:unknown;hash:string}){
 ensure(canonicalHash(frozen.snapshot)===frozen.hash&&canonicalHash(current.snapshot)===current.hash&&frozen.hash===current.hash,409,'V31_SOURCES_CHANGED','合同资料已变化，请核对冻结主体及来源后重新准备');
}
const reference=(row:any,content:unknown)=>row?{id:row.id,revision:row.revision,hash:canonicalHash(content),content}:null;
export function assertV31ConfirmedProduct(terms:any,published:any){
 const p=terms?.productSnapshot;ensure(p&&published&&p.productVersionId===published.productVersionId,409,'V31_PRODUCT_SOURCE_REQUIRED','须引用真实已发布产品版本');
 const {listingId,listingRevision,sourceHash,...configuration}=p;ensure(canonicalHash(configuration)===canonicalHash(published),409,'V31_PRODUCT_SOURCE_CHANGED','确认产品配置与真实发布版本不一致');
 ensure(terms.months===published.months&&published.minimumTermMonths!=null&&validTermMonths(terms.months,published.minimumTermMonths),409,'PRODUCT_TERMS_CHANGED','报价实际月数须与所选发布产品一致，且不低于最短期限');
}
export async function resolveV31SourceIds(tx:any,context:V31SourceIds):Promise<{snapshot:unknown;missing:MissingField[]}>{
 const missing:MissingField[]=[];
 const now=new Date();
 async function evidence(ids:string[]|undefined,field:string,path:string){const files=ids?.length?await tx.storedFile.findMany({where:{id:{in:ids}},select:{id:true,sha256:true,adminId:true,customerId:true}}):[];const valid=ids?.length&&files.length===new Set(ids).size&&files.every((f:any)=>f.adminId&&!f.customerId&&/^[a-f0-9]{64}$/.test(f.sha256));need(valid,field,path,'核验凭证不存在或不适用于企业资料');return valid?[...files].sort((a:any,b:any)=>a.id.localeCompare(b.id)).map((f:any)=>({fileId:f.id,sha256:f.sha256})):null;}
 const need=(value:any,field:string,path:string,reason='资料未确认')=>{if(!value){const [module,id]=path.replace(/^#/, '').split('/');const resources:Record<string,string>={partners:'VEHICLE_OWNER',products:'PRODUCT_VERSION',vehicles:'VEHICLE',customers:'CUSTOMER'};missing.push({field,reason,maintenancePath:path,sourceResource:{type:resources[module]||'CONTRACT_SOURCE',id:id||null},maintenanceKey:field,route:path});}};
 const ownerPath=(id:string)=>`#partners/${id}/profile`;
 async function enterprise(id:string,role:string){
  const row=await readEnterpriseIdentitySource(tx,id),path=ownerPath(id);
  need(row?.status==='VERIFIED'&&row?.subjectType==='ENTERPRISE',`${role}.enterprise`,path);
  need(row?.creditCode&&row?.address,`${role}.identity`,path);
  const profile=enterpriseContractProfileInput.safeParse(row?.contractProfile);
  need(profile.success,`${role}.contractProfile`,path);
  const a=row?.esignAccount,legal=row?.legalRepresentative;
  const reuseLegal=profile.success&&profile.data.signerAuthorityRole==='LEGAL_REPRESENTATIVE'&&a?.realNameStatus==='VERIFIED'&&a?.checkedAt instanceof Date&&a.checkedAt<=now&&now.getTime()-a.checkedAt.getTime()<86400000&&legal?.evidenceHash&&a?.consentSnapshot?.legalRevision===legal.revision&&a?.consentSnapshot?.legalName===legal.name;
  const authorityEvidence=reuseLegal?{source:'VERIFIED_LEGAL_REPRESENTATIVE',revision:legal.revision,evidenceHash:legal.evidenceHash,providerEvidenceHash:a.evidenceHash}:await evidence(profile.success?profile.data.authorityEvidenceFileIds:undefined,`${role}.authorityEvidence`,path);
  need(a?.realNameStatus==='VERIFIED'&&a?.evidenceHash&&a?.managerCustomerId&&legal,`${role}.signerAuthority`,`#partners/${id}/electronic-sign`);
  return reference(row,{name:row?.name,subjectType:row?.subjectType,creditCode:row?.creditCode,address:row?.address,contactPhone:row?.ordinaryContactPhone||row?.contactPhone,contactRevision:row?.contactRevision,contractProfile:profile.success?profile.data:null,authorityEvidence,signer:legal?{id:legal.id,revision:legal.revision,name:legal.name,evidenceHash:legal.evidenceHash}:null,providerIdentity:a?{providerCustomerId:a.providerCustomerId,evidenceHash:a.evidenceHash}:null});
 }
 const configured=process.env.FADADA_PLATFORM_CUSTOMER_ID;
 const platformAccount=configured?await tx.ownerESignAccount.findUnique({where:{providerCustomerId:configured},include:{owner:true}}):null;
 const platformId=platformAccount?.owner?.id;
 need(platformId&&platformAccount.owner.name===NINDA_PLATFORM_LEGAL_ENTITY&&(!context.platformSubjectId||platformId===context.platformSubjectId),'PLATFORM.identity','#partners','宁达独立企业账号未匹配');
 need(platformId!==context.ownerId,'parties.distinct','#partners','平台与出租方须分别确认');
 const parties:any={OWNER:await enterprise(context.ownerId,'OWNER'),PLATFORM:platformId?await enterprise(platformId,'PLATFORM'):null};
 if(context.customerId){
  const customer=await tx.customer.findUnique({where:{id:context.customerId}}),identity=await tx.eSignAccount.findUnique({where:{customerId:context.customerId}});
  need(customer,'CUSTOMER.identity',`#customers/${context.customerId}`);
  need(identity?.realNameStatus==='VERIFIED'&&identity?.verifiedIdentityHash,'CUSTOMER.esign',`#customers/${context.customerId}/identity`);
  parties.CUSTOMER=reference(customer,{name:customer?.name,identity:identity?{identityVersion:identity.identityVersion,identityHash:identity.verifiedIdentityHash}:null});
 }
 const foundAgreement=context.cooperationVersionId?await tx.partnerAgreementVersion.findUnique({where:{id:context.cooperationVersionId}}):null,path=`#partners/${context.ownerId}/cooperation`;
 need(foundAgreement?.ownerId===context.ownerId,'cooperation.version',path);
 need(foundAgreement?.ownerId===context.ownerId&&foundAgreement?.validFrom&&foundAgreement?.validUntil&&Number.isInteger(foundAgreement.partnerRateBps),'cooperation.periodAndRate',path);
 const agreement=foundAgreement?.ownerId===context.ownerId?foundAgreement:null;
 const parsed=cooperationSourcesInput.safeParse(agreement?.electronicTerms?.v31Sources),terms=parsed.success?parsed.data:null;
 const virtual=terms?.virtualAcceptanceScopeId?await requireCurrentVirtualScope(tx,{vehicleId:terms.vehicleScopes[0].vehicleId,customerId:context.customerId,action:'SOURCE'}):null;
 ensure(!terms?.virtualAcceptanceScopeId||virtual&&virtual.id===terms.virtualAcceptanceScopeId&&virtual.ownerId===context.ownerId&&virtual.cooperationVersionId===agreement?.id&&(!context.vehicleId||context.vehicleId===virtual.vehicleId)&&(!context.productVersionId||context.productVersionId===virtual.productVersionId),409,'VIRTUAL_SCOPE_MISMATCH','测试合同来源不属于冻结范围');
 if(virtual){need(platformId===virtual.platformId,'PLATFORM.scopeIdentity','#partners');for(const [role,ownerId,actorId]of [['OWNER',virtual.ownerId,virtual.ownerActorCustomerId],['PLATFORM',virtual.platformId,virtual.platformActorCustomerId]]){const account=await tx.ownerESignAccount.findUnique({where:{ownerId}});need(account?.managerCustomerId===actorId,`${role}.scopeActor`,ownerPath(ownerId));}}
 need(terms,'cooperation.scope',path,'请确认车辆期间、产品条件及主合同模板范围');
 need(terms?.productDepositRules,'cooperation.productDepositRules',path,'请明确选择每个获准产品的押金规则');
 need(agreement?.electronicTerms?.calendarPolicy&&canonicalHash(agreement.electronicTerms.calendarPolicy)===canonicalHash(V31_COOPERATION_CALENDAR),'cooperation.calendarPolicy',path);
 const account=await tx.partnerAccountVersion.findFirst({where:{ownerId:context.ownerId,status:'APPROVED'},orderBy:{version:'desc'}});
 const accountValid=account&&account.contentHash===accountHash(account)&&account.reviewedBy&&account.reviewedAt&&account.evidenceFileIds.length&&account.accountName===(parties.OWNER?.content as any)?.name;
 if(!virtual)need(accountValid,'OWNER.collectionAccount',`#partners/${context.ownerId}/collection-account`);
 const accountEvidence=virtual?null:await evidence(accountValid?account.evidenceFileIds:undefined,'OWNER.collectionAccountEvidence',`#partners/${context.ownerId}/collection-account`);
 const collectionAccount=virtual?{disposition:'NOT_APPLICABLE_NO_PAYOUT'}:accountValid&&accountEvidence?{id:account.id,revision:account.revision,version:account.version,hash:account.contentHash,evidence:accountEvidence}:null;
 const productIds=terms?.productVersionIds??[];if(context.productVersionId)need(productIds.includes(context.productVersionId),'product.authorization',path);
 const exceptionEvidence=[];for(const [index,exception] of (terms?.exceptions??[]).entries())exceptionEvidence.push(await evidence(exception.evidenceFileIds,`cooperation.exceptions.${index}.evidence`,path));
 const templates=[];
 for(const ref of terms?.templateRefs??[]){
  const row=await tx.legalDocument.findUnique({where:{id:ref.id}});let valid=false;
  try{valid=row?.type==='ELECTRONIC_V31_SUBSCRIPTION'&&row.status==='PUBLISHED'&&!!row.confirmedBy&&!!row.confirmedAt&&hash(row.content)===ref.hash&&validateV31Template(JSON.parse(row.content)).kind==='SUBSCRIPTION';}catch{}
  need(valid,`template.${ref.id}`,path,'须选择已审定完整V3.1三方订阅正文及固定摘要');
  templates.push(row?{id:row.id,type:row.type,title:row.title,version:row.version,hash:hash(row.content),content:row.content}:null);
 }
 const products=[];
 for(const id of [...productIds].sort()){
  const product=await tx.productVersion.findUnique({where:{id},include:productVersionInclude});
  need(product?.status==='PUBLISHED',`product.${id}.version`,`#products/${id}`);
  need(product?.minimumTermMonths!=null&&product?.customerBaas,`product.${id}.conditions`,`#products/${id}`);
  need(product?.configurationVersion===2&&product?.swapPolicy,`product.${id}.priceComponentsAndSwap`,`#products/${id}`,'V3.1须确认价费组成、赠送换车次数及单次服务费');
  if(product)products.push(reference(product,versionSnapshot(product)));
 }
 const vehicles=[];
 const vehicleScopes=terms?.vehicleScopes??[];
 if(context.vehicleId)need(vehicleScopes.some(v=>v.vehicleId===context.vehicleId),'vehicle.authorization',path);
 need(agreement?.vehicleIds?.length&&vehicleScopes.length===agreement.vehicleIds.length&&vehicleScopes.every(v=>agreement.vehicleIds.includes(v.vehicleId)),'cooperation.vehicles',path);
 for(const scope of [...vehicleScopes].sort((a,b)=>a.vehicleId.localeCompare(b.vehicleId))){
  const id=scope.vehicleId,v=await tx.vehicle.findUnique({where:{id},include:{assetProfile:true,conditionAssessment:true,documentFiles:{where:{removedAt:null}}}}),vpath=`#vehicles/${id}/materials`;
  if(virtual){ensure(v?.virtualAcceptanceScopeId===virtual.id&&id===virtual.vehicleId&&scope.rightsRestrictions.status==='NOT_APPLICABLE'&&!scope.authorityEvidenceFileIds.length&&!scope.insuranceArrangement,409,'VIRTUAL_FACTS_MISMATCH','虚拟事实不能附会真实权属、保险或交付证明');vehicles.push(reference(v,{brand:v.brand,model:v.model,vin:null,plateNumber:null,registeredOwnerName:parties.OWNER?.content.name,scope,virtualFacts:VIRTUAL_FACTS,policies:[]}));continue;}
  need(v?.vin&&v?.assetProfile?.registeredOwnerName,`vehicle.${id}.identity`,vpath);
  need(v?.conditionAssessment,`vehicle.${id}.condition`,vpath);
  need(scope.rightsRestrictions.status!=='UNKNOWN',`vehicle.${id}.rightsRestrictions`,path,'权利限制尚未确认，不能推定为无');
  need(agreement?.validFrom&&scope.validFrom>=agreement.validFrom&&agreement?.validUntil&&scope.validUntil<=agreement.validUntil,`vehicle.${id}.period`,path);
  const authorityEvidence=await evidence(scope.authorityEvidenceFileIds,`vehicle.${id}.authorityEvidence`,path);
  const rightsEvidence=['UNKNOWN','NOT_APPLICABLE'].includes(scope.rightsRestrictions.status)?null:await evidence('evidenceFileIds' in scope.rightsRestrictions?scope.rightsRestrictions.evidenceFileIds:undefined,`vehicle.${id}.rightsEvidence`,path);
  const policyVersions=await tx.insurancePolicyVersion.findMany({where:{vehicleIds:{has:id},status:{in:['REGISTERED','APPROVED']}},orderBy:[{policyId:'asc'},{version:'desc'}]});
  const policyIds=[...new Set<string>(policyVersions.map((p:any)=>p.policyId))];
  const policies=policyIds.map(policyId=>effectivePolicyVersion<any>(policyVersions.filter((p:any)=>p.policyId===policyId),now)).filter((p:any)=>p&&p.vehicleIds.includes(id)&&p.changeKind!=='CANCELLATION'&&p.startAt<=now&&p.endAt>now&&(p.status!=='REGISTERED'||validRegistration(p,id)));
  const insuranceEvidence=scope.insuranceArrangement?await evidence(scope.insuranceArrangement.evidenceFileIds,`vehicle.${id}.insuranceArrangementEvidence`,path):null;
  need(policies.length||insuranceEvidence,`vehicle.${id}.insurance`,`#vehicles/${id}/insurance`);
  vehicles.push(reference(v,{brand:v?.brand,model:v?.model||v?.title,vin:v?.vin,plateNumber:v?.plateNumber,revision:v?.revision,documentRevision:v?.documentRevision,registeredOwnerName:v?.assetProfile?.registeredOwnerName,assetRevision:v?.assetProfile?.revision,batteryOwnership:v?.assetProfile?.batteryOwnership,condition:v?.conditionAssessment?{revision:v.conditionAssessment.revision,fireDamage:v.conditionAssessment.fireDamage,floodDamage:v.conditionAssessment.floodDamage,structuralDamage:v.conditionAssessment.structuralDamage}:null,documents:v?[...v.documentFiles].sort((a:any,b:any)=>a.fileId.localeCompare(b.fileId)).map((d:any)=>({fileId:d.fileId,sha256:d.sha256,category:d.category})):undefined,scope,authorityEvidence,rightsEvidence,insuranceEvidence,policies:policies.map((p:any)=>({id:p.id,revision:p.revision,hash:canonicalHash({policyId:p.policyId,version:p.version,status:p.status,startAt:p.startAt,endAt:p.endAt,coverageItems:p.coverageItems}),insurer:p.insurerSnapshot,policyNumber:p.policyNumberSnapshot,coverageItems:p.coverageItems,startAt:p.startAt,endAt:p.endAt}))}));
 }
 let qualification:any=null;
 if(context.customerId&&!virtual){try{qualification=await requireCurrentQualification(tx,context.customerId,undefined,now);}catch(error:any){if(![404,409].includes(error.getStatus?.()))throw error;need(false,'CUSTOMER.qualification',`#customers/${context.customerId}/qualification`);}}
 const depositAuthorizations=terms?.productDepositRules?.map(r=>({...r,...(r.rule.kind==='CREDIT_POLICY'?{policy:V31_DEPOSIT_CREDIT_POLICY}:{})}))??null;
 const snapshot={schema:'NINDA_V31_SOURCES',parties,collectionAccount,depositAuthorizations,cooperation:agreement?.ownerId===context.ownerId?{id:agreement.id,version:agreement.version,hash:agreement.contentHash,validFrom:agreement.validFrom,validUntil:agreement.validUntil,partnerRateBps:agreement.partnerRateBps,terms,exceptionEvidence}:null,calendarPolicy:agreement?.electronicTerms?.calendarPolicy??null,templates,products,vehicles,qualification:qualification?{id:qualification.id,revision:qualification.revision,hash:qualification.evidenceHash,identityExpiresAt:qualification.identityExpiresAt,drivingLicenseExpiresAt:qualification.drivingLicenseExpiresAt}:null};
 return{snapshot:freezeV31Sources({...snapshot,...(virtual?{virtualAcceptance:{scopeId:virtual.id,configurationHash:virtual.configurationHash,revision:virtual.revision,vehicleId:virtual.vehicleId,customerId:virtual.customerId,ownerId:virtual.ownerId,platformId:virtual.platformId,noticeHash:virtual.noticeHash,wrapperVersion:virtual.wrapperVersion,wrapperHash:virtual.wrapperHash,testFactsHash:virtual.testFactsHash},qualification:context.customerId?{disposition:'NOT_APPLICABLE_NO_DRIVING'}:null}: {})}).snapshot,missing};
}

/** Public entry point binds source IDs to the exact persisted business, never request-supplied parties. */
export async function resolveV31Sources(tx:any,context:V31Context):Promise<{snapshot:unknown;missing:MissingField[]}>{
 ensure(context&&typeof context.kind==='string'&&typeof context.resourceId==='string'&&Number.isInteger(context.revision)&&/^[a-f0-9]{64}$/.test(context.businessHash||''),400,'VALIDATION','合同业务来源不完整');
 let ids:V31SourceIds;
 if(context.kind.startsWith('COOPERATION')){
  const version=await tx.partnerAgreementVersion.findUnique({where:{id:context.resourceId}});
  ensure(version,404,'NOT_FOUND','合作版本不存在');
  const agreement=await tx.partnerAgreement.findUnique({where:{id:version.agreementId}});
  ensure(agreement?.ownerId===version.ownerId,409,'V31_BUSINESS_MISMATCH','合作主体来源不匹配');
  ensure(agreement?.revision===context.revision&&version.contentHash===context.businessHash,409,'REVISION_CONFLICT','合作业务版本已变化');
  ensure(!version.electronicTerms?.kind||version.electronicTerms.kind===context.kind,409,'V31_BUSINESS_MISMATCH','合作文书种类不匹配');
  ids={ownerId:version.ownerId,cooperationVersionId:version.id};
 }else if(context.kind==='RENEWAL'){
  const {order,q,s}=await electronicRenewalBusiness(tx,context.resourceId);
  ensure(q.revision===context.revision&&q.commercialHash===context.businessHash,409,'REVISION_CONFLICT','续期报价版本已变化');
  const template=await tx.legalDocument.findUnique({where:{id:s.document.id}});
  ensure(template?.type==='ELECTRONIC_V31_RENEWAL'&&template.status==='PUBLISHED'&&template.confirmedBy&&template.confirmedAt&&template.version===s.document.version&&hash(template.content)===s.document.templateHash,409,'V31_TEMPLATE_CHANGED','05审定正文或版本已变化，请重新核对');
  approvedElectronicBody(template,'RENEWAL');
  await revalidateRenewalQuote(tx,(await tx.orderChange.findUniqueOrThrow({where:{id:context.resourceId}})),q,new Date());
  ids={ownerId:s.source.ownerId,cooperationVersionId:s.renewalTerms.lessorSnapshot.agreementVersionId,customerId:order.customerId,vehicleId:s.source.vehicleId,productVersionId:s.product.productVersionId};
 }else if(context.kind==='VEHICLE_SWAP'){
  const {change,order,q,s}=await electronicSwapBusiness(tx,context.resourceId);
  ensure(q.revision===context.revision&&q.commercialHash===context.businessHash,409,'REVISION_CONFLICT','当前换车报价版本已变化');
  ids={ownerId:s.targetLessorSnapshot.ownerId,cooperationVersionId:s.targetLessorSnapshot.agreementVersionId,customerId:order.customerId,vehicleId:change.targetVehicleId,productVersionId:s.targetSource.product.productVersionId};
 }else{
  ensure(context.kind==='SUBSCRIPTION',409,'V31_CONTEXT_UNSUPPORTED','此类文书须先接入对应的业务来源绑定');
  const order=await tx.order.findUnique({where:{id:context.resourceId}}),terms=order?.finalPlanSnapshot;
  ensure(order,404,'NOT_FOUND','订单不存在');
  ensure(order.revision===context.revision&&terms?.commercialHash===context.businessHash,409,'REVISION_CONFLICT','订阅业务版本已变化');
  const lessor=terms?.lessorSnapshot;
  ensure(lessor?.ownerId&&lessor.agreementVersionId&&lessor.vehicleId===order.vehicleId,409,'V31_BUSINESS_MISMATCH','订阅出租方或车辆冻结来源不匹配');
  const productVersionId=terms.productSnapshot?.productVersionId;
  ensure(typeof productVersionId==='string'&&productVersionId.trim().length>0,409,'V31_PRODUCT_SOURCE_REQUIRED','订阅实际产品版本来源缺失，请核对客户已确认产品');
  ids={ownerId:lessor.ownerId,cooperationVersionId:lessor.agreementVersionId,customerId:order.customerId,vehicleId:order.vehicleId,productVersionId};
 }
 const result=await resolveV31SourceIds(tx,ids);
 if(context.kind==='VEHICLE_SWAP'){const {s}=await electronicSwapBusiness(tx,context.resourceId),p=s.targetSource.product;const published=(result.snapshot as any).products.find((v:any)=>v.id===p.productVersionId)?.content;assertV31ConfirmedProduct({productSnapshot:p,months:p.months},published);}
 if(context.kind==='RENEWAL'){const {s}=await electronicRenewalBusiness(tx,context.resourceId);assertV31ConfirmedProduct(s.renewalTerms,(result.snapshot as any).products.find((p:any)=>p.id===ids.productVersionId)?.content);}
 if(context.kind==='SUBSCRIPTION'){const confirmed=(await tx.order.findUnique({where:{id:context.resourceId}}))?.finalPlanSnapshot;assertV31ConfirmedProduct(confirmed,(result.snapshot as any).products.find((p:any)=>p.id===ids.productVersionId)?.content);}
 return{...result,snapshot:freezeV31Sources({...result.snapshot as object,business:{kind:context.kind,resourceId:context.resourceId,revision:context.revision,businessHash:context.businessHash,...(context.kind==='SUBSCRIPTION'?{confirmedTermsHash:canonicalHash((await tx.order.findUnique({where:{id:context.resourceId}}))?.finalPlanSnapshot)}: {})}}).snapshot};
}
