import {materialsChanged} from '../owner-signing/identity-materials';
import {sharedElectronicCooperationFile} from '../partners/electronic-portal';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {FadadaSettings} from '../esign/esign.settings';
import {OwnerService} from '../owner-signing/owner.service';
import {OwnerIdentityService} from '../owner-signing/identity';
import {OwnerAuthorizationService,ownerAuthorizationEntryEnabled} from '../owner-signing/authorization';
import {runOwnerH5} from '../owner-signing/fadada-owner.client';
import {claimOwnerLegalInvitation,ownerMobileHash,requireOwnerLegalRepresentative} from './legal-representative';
import {ownerAuthorizationScopeVersion} from '../owner-signing/rules';
import {ownerAuthorizationOptions} from '../owner-signing/scope-options';
import {ownerAuthorizationMethod} from '../owner-signing/authorization-method';
import {ownerVerificationDisplay} from './verification-display';
import {newOrderContractMode,assertNewEsignAllowed,assertEnterpriseOnboardingAllowed} from '../offline-documents/mode';
import {partnerLoginEligibility,requireOfflinePartnerCustomer} from './offline-access';
import {PartnerPortalSession,validPartnerScopes,requirePartnerReadAccess} from '../partners/portal-session';
import {readSimpleAgreementFile,readSimpleAgreementSnapshot} from '../partners/simple-agreements';
import {assertNotAssetFiles} from '../files/asset-files';
import {virtualActorScope,requireVirtualEnterpriseOrDefault} from '../virtual-acceptance/actors';

const companyVehicleQuery=z.object({modelId:z.string().min(1).max(128).optional(),agreementId:z.string().min(1).max(128).optional(),status:z.enum(['DRAFT','PUBLISHED','UNPUBLISHED','RESERVED','IN_USE']).optional(),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).strict();

export class OwnerH5Service {
 constructor(private db:Db,private owners:OwnerService,private identity:OwnerIdentityService,private authority:OwnerAuthorizationService,private config:FadadaSettings){}
 private async portalOwner(tx:any,ownerId:string,accessVersion:number){
  const owner=await tx.vehicleOwner.findUnique({where:{id:ownerId}});ensure(owner,404,'NOT_FOUND','合作商不存在');
  const admission=await tx.partnerCooperationSubmission.findFirst({where:{ownerId},orderBy:{revision:'desc'}}),access=await tx.partnerPortalAccess.findUnique({where:{ownerId}});
  const admissionStatus=admission?.profileRevision===owner.revision?admission.status:'UNVERIFIED';
  const vehicles=await this.currentCompanyVehicles(tx,ownerId);
  return{ownerId:owner.id,name:owner.name,subjectType:owner.subjectType,status:owner.status,admissionStatus,accessVersion,mode:'PARTNER_READONLY',cooperationMode:owner.cooperationMode,vehicleCount:vehicles.length,companyAdmin:{status:'BOUND',maskedMobile:access.maskedMobile,bindingMethod:access.bindingMethod||'REVIEWED',boundAt:access.boundAt||null}};
 }
 async portalList(session:PartnerPortalSession){
  return this.db.serial(async(tx:any)=>{const scopes=await validPartnerScopes(tx,session);ensure(scopes.length,401,'SESSION_EXPIRED','查看授权已失效，请联系运营');return Promise.all(scopes.map(scope=>this.portalOwner(tx,scope.ownerId,scope.accessVersion)));});
 }
 async portalDetail(session:PartnerPortalSession,ownerId:string){
  return this.db.serial(async(tx:any)=>{const scope=await requirePartnerReadAccess(tx,session,ownerId),owner=await tx.vehicleOwner.findUnique({where:{id:ownerId}});ensure(owner,404,'NOT_FOUND','合作商不存在');
   return{...await this.portalOwner(tx,ownerId,scope.accessVersion),id:owner.id,address:owner.address,platformContactPhone:process.env.PLATFORM_CONTACT_PHONE||'',executionMode:newOrderContractMode()};
  });
 }
 private async sharedCompanyAgreements(tx:any,ownerId:string){
  const agreements=await tx.partnerAgreement.findMany({where:{ownerId,status:{in:['ACTIVE','STOPPED']}},orderBy:{createdAt:'desc'}}),shared:any[]=[];
  for(const agreement of agreements){
   const version=agreement.currentVersionId&&await tx.partnerAgreementVersion.findUnique({where:{id:agreement.currentVersionId}});
   if(version?.status==='ACTIVE'&&version.agreementId===agreement.id&&version.ownerId===ownerId)shared.push({agreement,version});
  }
  return shared;
 }
 private async currentCompanyVehicles(tx:any,ownerId:string){
  const agreements=await this.sharedCompanyAgreements(tx,ownerId),bindings=await tx.partnerAgreementVehicle.findMany({where:{ownerId}}),items:any[]=[];
  for(const binding of bindings){
   const shared=agreements.find(({agreement,version})=>agreement.status==='ACTIVE'&&agreement.id===binding.agreementId&&version.id===binding.agreementVersionId&&version.vehicleIds.includes(binding.vehicleId));if(!shared)continue;
   const vehicle=await tx.vehicle.findUnique({where:{id:binding.vehicleId},include:{modelDefinition:true}});if(!vehicle)continue;
   items.push({vehicleId:vehicle.id,plateNumber:vehicle.plateNumber||'',modelId:vehicle.modelDefinitionId||null,modelName:vehicle.modelDefinition?.name||vehicle.model||vehicle.title,status:vehicle.status,agreementId:shared.agreement.id,agreementTitle:shared.version.title,partnerRateBps:shared.version.partnerRateBps,cooperationActive:!!await readSimpleAgreementSnapshot(tx,vehicle.id)});
  }
  return items.sort((a,b)=>a.plateNumber.localeCompare(b.plateNumber)||a.vehicleId.localeCompare(b.vehicleId));
 }
 async portalAgreements(session:PartnerPortalSession,ownerId:string){
  return this.db.serial(async(tx:any)=>{
   await requirePartnerReadAccess(tx,session,ownerId);const shared=await this.sharedCompanyAgreements(tx,ownerId),vehicles=await this.currentCompanyVehicles(tx,ownerId),items=[];
   for(const {agreement,version} of shared){
    await assertNotAssetFiles(tx,version.fileIds);
    const files=version.executionMode==='ELECTRONIC'?[await sharedElectronicCooperationFile(tx,ownerId,version)]:await tx.storedFile.findMany({where:{id:{in:version.fileIds}},select:{id:true,name:true,mimeType:true,size:true}});
    items.push({id:agreement.id,status:agreement.status,versionId:version.id,version:version.version,title:version.title,referenceNumber:version.referenceNumber,partnerRateBps:version.partnerRateBps,validFrom:version.validFrom,validUntil:version.validUntil,vehicleCount:vehicles.filter(v=>v.agreementId===agreement.id).length,executionMode:version.executionMode,files:files.map((f:any)=>({id:f.id,name:f.name,mimeType:f.mimeType,size:f.size}))});
   }
   return{items};
  });
 }
 async portalVehicles(session:PartnerPortalSession,ownerId:string,raw:unknown={}){
  const query=companyVehicleQuery.parse(raw);
  return this.db.serial(async(tx:any)=>{
   await requirePartnerReadAccess(tx,session,ownerId);const all=await this.currentCompanyVehicles(tx,ownerId);
   if(query.agreementId)ensure(all.some(row=>row.agreementId===query.agreementId),404,'NOT_FOUND','筛选范围不存在');
   if(query.modelId)ensure(all.some(row=>row.modelId===query.modelId),404,'NOT_FOUND','筛选范围不存在');
   const filtered=all.filter(row=>(!query.agreementId||row.agreementId===query.agreementId)&&(!query.modelId||row.modelId===query.modelId)&&(!query.status||row.status===query.status));
   const models=Array.from(new Map(all.filter(row=>row.modelId).map(row=>[row.modelId,{id:row.modelId,name:row.modelName}])).values()),agreements=Array.from(new Map(all.map(row=>[row.agreementId,{id:row.agreementId,title:row.agreementTitle}])).values());
   return{items:filtered.slice((query.page-1)*query.pageSize,query.page*query.pageSize),total:filtered.length,page:query.page,pageSize:query.pageSize,models,agreements};
  });
 }
 async portalAgreementFile(session:PartnerPortalSession,ownerId:string,agreementId:string,fileId:string){
  return this.db.serial(async(tx:any)=>{
   await requirePartnerReadAccess(tx,session,ownerId);const shared=(await this.sharedCompanyAgreements(tx,ownerId)).find(({agreement,version})=>agreement.id===agreementId);ensure(shared,404,'NOT_FOUND','协议文件不存在');
   if(shared.version.executionMode==='ELECTRONIC'){const file=await sharedElectronicCooperationFile(tx,ownerId,shared.version);ensure(file.id===fileId,404,'NOT_FOUND','协议文件不存在');return file;}
   ensure(shared.version.fileIds.includes(fileId),404,'NOT_FOUND','协议文件不存在');
   return readSimpleAgreementFile(tx,ownerId,agreementId,fileId);
  });
 }
 async list(customerId:string){
  const scope=await virtualActorScope(this.db,customerId,{current:false}),scopedOwnerId=scope?.ownerActorCustomerId===customerId?scope.ownerId:scope?.platformActorCustomerId===customerId?scope.platformId:null;
  if(newOrderContractMode()==='OFFLINE'&&!scopedOwnerId){const customer=await this.db.customer.findUnique({where:{id:customerId}});ensure(customer,401,'UNAUTHENTICATED','请登录合作商中心');const eligible=await partnerLoginEligibility(this.db,customer.mobile);return Promise.all((eligible?.choices||[]).map(async(c:any)=>{const owner=await this.db.vehicleOwner.findUnique({where:{id:c.ownerId}});return{ownerId:owner!.id,name:owner!.name,subjectType:(owner as any).subjectType,status:owner!.status,admissionStatus:'APPROVED',executionMode:'OFFLINE'};}));}
  const customer=await this.db.customer.findUnique({where:{id:customerId}});ensure(customer,401,'UNAUTHENTICATED','请登录法人中心');
  const members=await this.db.ownerMember.findMany({where:{customerId,status:{not:'SUSPENDED'},owner:{status:{not:'SUSPENDED'},legalRepresentative:{is:{mobileHash:ownerMobileHash(customer.mobile)}}}},include:{owner:{select:{id:true,name:true,subjectType:true,creditCode:true,status:true,legalRepresentative:{select:{name:true,mobileHash:true,evidenceHash:true,revision:true}},esignAccount:{select:{realNameStatus:true,certStatus:true,certSerialNo:true,providerCustomerId:true,verifiedAt:true,checkedAt:true,consentedAt:true,managerCustomerId:true,verificationTransactionNo:true,consentSnapshot:true,leaseToken:true,leaseUntil:true}},seals:{select:{status:true,checkedAt:true,providerCustomerId:true}}}}}});
  return members.filter(m=>newOrderContractMode()!=='OFFLINE'||m.ownerId===scopedOwnerId).map(m=>({ownerId:m.owner.id,name:m.owner.name,status:m.owner.status,memberStatus:m.status,verificationDisplay:ownerVerificationDisplay(m.owner,m,customerId)}));
 }
 claim(customerId:string,raw:unknown){return claimOwnerLegalInvitation(this.db,customerId,raw);}
 async detail(customerId:string,ownerId:string){
  const scoped=await virtualActorScope(this.db,customerId,{ownerId,current:false});
  if(newOrderContractMode()==='OFFLINE'&&!scoped){const binding=await requireOfflinePartnerCustomer(this.db,customerId,ownerId),owner=await this.db.vehicleOwner.findUnique({where:{id:ownerId}});return{id:owner!.id,name:owner!.name,subjectType:(owner as any).subjectType,creditCode:owner!.creditCode,address:owner!.address,contactPhone:owner!.contactPhone,revision:owner!.revision,admissionStatus:'APPROVED',identityRelationship:binding.relationship,executionMode:'OFFLINE',readyForSigning:false,autoSigningExecutionEnabled:false,authorizationEntryEnabled:false,capabilities:{canStartVerification:false,canRefreshVerification:false,canSelectSeal:false,canRequestAuthority:false,canEnableAuthority:false,canManageAuthority:false},blockers:[]};}
  const {profile,member,owner}=await requireOwnerLegalRepresentative(this.db,customerId,ownerId),account=owner.esignAccount,consent=account?.consentSnapshot as any;
  const view=await this.owners.memberDetail(customerId,ownerId),now=Date.now(),busy=!!account?.leaseUntil&&account.leaseUntil.getTime()>now;
  const onboarding=(newOrderContractMode()!=='OFFLINE'||!scoped||scoped.status==='READY'&&scoped.expiresAt>new Date())&&process.env.ESIGN_NEW_REQUESTS_ENABLED==='true'&&process.env.OWNER_ONBOARDING_ENABLED==='true'&&this.config.enabled&&this.config.accountRegisterEnabled&&this.config.realNameVerifyEnabled;
  const consentCurrent=!!account?.consentedAt&&consent?.channel==='OWNER_LEGAL_H5'&&consent.customerId===customerId&&consent.legalRevision===profile.revision&&consent.legalName===profile.name&&consent.legalMobileHash===profile.mobileHash;
  const materialMismatch=materialsChanged(owner,profile,account,customerId);
  const verified=!materialMismatch&&consentCurrent&&member.status==='VERIFIED'&&member.verifiedSerialNo===account?.verificationTransactionNo&&owner.status==='VERIFIED'&&account?.managerCustomerId===customerId&&account.realNameStatus==='VERIFIED';
  const certificateReady=verified&&account?.certStatus==='BOUND'&&!!account.certSerialNo&&!!account.checkedAt&&account.checkedAt.getTime()<=now&&account.checkedAt.getTime()>now-86400000;
  const sealEvidence=await this.db.ownerSeal.findMany({where:{ownerId},select:{status:true,checkedAt:true,providerCustomerId:true}});
  const verificationDisplay=ownerVerificationDisplay({...owner,seals:sealEvidence},member,customerId,now);
  const sealReady=certificateReady&&verificationDisplay.seal.state==='READY';
  const signingReady=sealReady&&verificationDisplay.state==='READY';
  const scopeVersion=ownerAuthorizationScopeVersion(),authorizationMethod=ownerAuthorizationMethod(),unilateral=authorizationMethod==='UNILATERAL_LETTER';
  const [vehicles,template,authorizationNotice,letterTemplate]=await Promise.all([
   this.db.ownerVehicle.findMany({where:{ownerId,status:'APPROVED'},select:{vehicleId:true}}),
   this.db.legalDocument.findFirst({where:{type:newOrderContractMode()==='ELECTRONIC'?'ELECTRONIC_V31_SUBSCRIPTION':'owner-rental-contract',status:'PUBLISHED',confirmedBy:{not:null},confirmedAt:{not:null}},orderBy:{version:'desc'}}),
   this.db.legalDocument.findFirst({where:{type:'owner-auto-sign',status:'PUBLISHED',...(scopeVersion===2?{version:{gte:unilateral?3:2}}:{}),confirmedBy:{not:null},confirmedAt:{not:null}},orderBy:{version:'desc'}}),
   unilateral?this.db.legalDocument.findFirst({where:{type:'owner-authorization-letter',status:'PUBLISHED',confirmedBy:{not:null},confirmedAt:{not:null}},orderBy:{version:'desc'}}):Promise.resolve(null)
  ]);
  const authorizationEnabled=newOrderContractMode()!=='OFFLINE'&&ownerAuthorizationEntryEnabled(),autoSigningExecutionEnabled=newOrderContractMode()!=='OFFLINE'&&process.env.OWNER_AUTO_SIGNING_ENABLED==='true',unknown=!account?.verificationTransactionNo&&['VERIFY_STARTING','VERIFY_UNKNOWN'].includes(account?.realNameStatus||'');
  const blockers:string[]=[];
  if(!onboarding)blockers.push('企业认证入口尚未开放，请联系运营');
  if(busy)blockers.push('企业认证正在处理中，请稍后刷新');
  if(!busy&&verificationDisplay.state==='PROCESSING')blockers.push('企业仍有未完成的核验记录，请主动重新核验企业与证书状态');
  if(unknown)blockers.push('企业认证请求结果待核对，系统不会重复发起认证');
  if(!consentCurrent)blockers.push('请由法人本人办理认证并同意企业认证说明');
  if(!verified)blockers.push('当前法人身份尚未通过供应商核验');
  if(!certificateReady)blockers.push(verificationDisplay.certification.message);
  if(!sealReady)blockers.push(verificationDisplay.seal.message);
  if(!authorizationEnabled)blockers.push('平台用印授权入口尚未开放');
  if(scopeVersion!==3&&!authorizationNotice)blockers.push('平台用印授权说明尚未发布');
  if(unilateral&&!letterTemplate)blockers.push('企业车主单方授权书正文尚未发布');
  if(scopeVersion!==3&&!template)blockers.push('企业租赁合同模板尚未发布');
  if(scopeVersion===1&&!vehicles.length)blockers.push('尚无归属审核通过的车辆');
  return{...view,verificationDisplay,authorizationMethod,authorizationScopeVersion:scopeVersion,readyForSigning:!!signingReady,certificationComplete:!!certificateReady,authorizationEntryEnabled:authorizationEnabled,autoSigningExecutionEnabled,legalRepresentative:{name:profile.name,maskedMobile:profile.maskedMobile},capabilities:{
   canStartVerification:!!(onboarding&&!busy&&!unknown&&!verificationDisplay.identity.complete),
   canRefreshVerification:!!(this.config.enabled&&!busy&&!materialMismatch&&consentCurrent&&account?.providerCustomerId&&account.verificationTransactionNo),
   canSelectSeal:!!(onboarding&&!busy&&certificateReady&&view.seals?.some((s:any)=>['DISCOVERED','ACTIVE'].includes(s.status)&&new Date(s.checkedAt).getTime()>now-86400000)),
   canRequestAuthority:!!(onboarding&&authorizationEnabled&&!busy&&signingReady&&(scopeVersion===3?!unilateral:template&&authorizationNotice&&(!unilateral||(scopeVersion===2&&letterTemplate))&&(scopeVersion===2||vehicles.length))),
   canEnableAuthority:!!(!unilateral&&autoSigningExecutionEnabled&&!busy&&signingReady),
   canManageAuthority:!!(verified&&!busy)
  },blockers};
 }
 async verification(customerId:string,ownerId:string,raw:unknown){await requireVirtualEnterpriseOrDefault(this.db,customerId,ownerId);await requireOwnerLegalRepresentative(this.db,customerId,ownerId);return this.identity.startLegal(customerId,ownerId,raw);}
 async refresh(customerId:string,ownerId:string){if(newOrderContractMode()==='OFFLINE'&&!await virtualActorScope(this.db,customerId,{ownerId,current:false}))return this.detail(customerId,ownerId);await this.identity.refreshLegal(customerId,ownerId);return this.detail(customerId,ownerId);}
 async selectSeal(customerId:string,ownerId:string,raw:unknown){await requireVirtualEnterpriseOrDefault(this.db,customerId,ownerId);
  const input=z.object({sealId:z.string().min(1).max(100),imageHash:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().parse(raw);
  await runOwnerH5(async()=>{await requireOwnerLegalRepresentative(this.db,customerId,ownerId);await this.identity.selectSeal(customerId,ownerId,input.sealId,input.imageHash);});return this.detail(customerId,ownerId);
 }
 async sealImage(customerId:string,ownerId:string,sealId:string){return runOwnerH5(async()=>{await requireOwnerLegalRepresentative(this.db,customerId,ownerId);return this.identity.sealImage(customerId,ownerId,sealId);});}
 async options(customerId:string,ownerId:string){
  await requireOwnerLegalRepresentative(this.db,customerId,ownerId);
  return ownerAuthorizationOptions(this.db,ownerId);
 }
 async authorities(customerId:string,ownerId:string){await requireOwnerLegalRepresentative(this.db,customerId,ownerId);return this.authority.list(customerId,ownerId);}
 async document(customerId:string,ownerId:string,id:string,variant:'source'|'signed'){return runOwnerH5(async()=>{await requireOwnerLegalRepresentative(this.db,customerId,ownerId);return this.authority.document(customerId,ownerId,id,variant);});}
 async requestAuthority(customerId:string,ownerId:string,raw:unknown){assertEnterpriseOnboardingAllowed();return runOwnerH5(async()=>{await requireOwnerLegalRepresentative(this.db,customerId,ownerId);return this.authority.request(customerId,ownerId,raw);});}
 async refreshAuthority(customerId:string,ownerId:string,authorityId:string){return runOwnerH5(async()=>{await requireOwnerLegalRepresentative(this.db,customerId,ownerId);return this.authority.refresh(customerId,ownerId,authorityId);});}
 async resumeAuthority(customerId:string,ownerId:string,authorityId:string){assertEnterpriseOnboardingAllowed();return runOwnerH5(async()=>{await requireOwnerLegalRepresentative(this.db,customerId,ownerId);return this.authority.resume(customerId,ownerId,authorityId);});}
 async switchAuthority(customerId:string,ownerId:string,authorityId:string,raw:unknown){return runOwnerH5(async()=>{await requireOwnerLegalRepresentative(this.db,customerId,ownerId);return this.authority.setEnabled(customerId,ownerId,authorityId,raw);});}
 async revokeAuthority(customerId:string,ownerId:string,authorityId:string,raw:unknown={}){return runOwnerH5(async()=>{await requireOwnerLegalRepresentative(this.db,customerId,ownerId);return this.authority.revoke(customerId,ownerId,authorityId,raw);});}
}
