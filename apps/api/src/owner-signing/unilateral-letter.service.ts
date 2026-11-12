import {createHash,randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {Db} from '../common/db';
import {audit,hash} from '../common/data';
import {ensure} from '../common/errors';
import {FadadaSettings} from '../esign/esign.settings';
import {FadadaApiClient} from '../esign/fadada/fadada-api.client';
import {assertSignerResult} from '../esign/fadada/fadada-safety';
import {isFadadaQueryAbsent} from '../esign/fadada-query-binding';
import {ContractPdfArtifactWriterService} from '../contract/contract-pdf-artifact-writer.service';
import {requireOwnerLegalRepresentative} from '../owner-h5/legal-representative';
import {OwnerService} from './owner.service';
import {FadadaOwnerClient,runOwnerH5} from './fadada-owner.client';
import {ownerScopeHash} from './rules';
import {renderUnilateralLetter,resolveUnilateralLetter} from './unilateral-letter-document';
import {assertNewEsignAllowed} from '../offline-documents/mode';

type Database=Db|Prisma.TransactionClient;
const digest=(buffer:Buffer)=>createHash('sha256').update(buffer).digest('hex');
const intakeEnabled=()=>{assertNewEsignAllowed();ensure((process.env.OWNER_AUTHORIZATION_ENABLED??process.env.OWNER_AUTO_SIGNING_ENABLED)==='true',503,'OWNER_AUTHORIZATION_DISABLED','企业用印授权办理入口尚未开放');};
const leaseMs=120000;

/** An owner-signed Ningda letter is evidence of the owner's grant, never a provider automatic-sign permission. */
export class OwnerAuthorizationLetterService {
 constructor(private db:Db,private owners:OwnerService,private config:FadadaSettings,private api:FadadaApiClient,private ownerApi:FadadaOwnerClient,private writer:ContractPdfArtifactWriterService){}
 private async load(customerId:string,ownerId:string,id:string,db:Database=this.db){
  await requireOwnerLegalRepresentative(db,customerId,ownerId);
  return this.loadBound(ownerId,id,db);
 }
 private async loadBound(ownerId:string,id:string,db:Database=this.db){
  const a=await db.ownerAutoAuthority.findFirst({where:{id,ownerId},include:{letter:true}});
  ensure(a?.method==='UNILATERAL_LETTER'&&a.letter,404,'OWNER_LETTER_NOT_FOUND','本企业单方授权书不存在');
  const snapshot=a.letter.snapshot as any,scope=a.scope as any,resolved=resolveUnilateralLetter(snapshot);
  ensure(snapshot.authorityId===a.id&&snapshot.ownerId===a.ownerId&&/^[a-f0-9]{64}$/.test(snapshot.sealImageHash||'')&&resolved.bodyHash===a.letter.bodyHash&&scope.version===2&&ownerScopeHash(scope)===a.scopeHash&&scope.validFrom===snapshot.validFrom&&scope.validUntil===snapshot.validUntil&&scope.delegates.length===1&&scope.delegates[0].id==='PLATFORM_OPERATOR'&&scope.delegates[0].name===snapshot.grantee&&hash(scope.documentKinds)===hash(snapshot.documentKinds),409,'OWNER_LETTER_BINDING','授权书正文或范围与原确认记录不一致');
  return a as typeof a&{letter:NonNullable<typeof a.letter>};
 }
 private async ready(customerId:string,ownerId:string,id:string,db:Database=this.db){
  intakeEnabled();
  const a=await this.load(customerId,ownerId,id,db),l=a.letter,s=l.snapshot as any;
  await this.owners.requireLegalSigningMember(customerId,ownerId,db);
  const {owner,member,profile}=await requireOwnerLegalRepresentative(db,customerId,ownerId),account=owner.esignAccount,now=Date.now();
  ensure(a.requestedBy===customerId&&account?.consentSnapshot&&(account.consentSnapshot as any).channel==='OWNER_LEGAL_H5',403,'OWNER_LETTER_ACTOR','请由确认本次授权的当前法人本人继续办理');
  ensure(!l.withdrawnAt&&!['WITHDRAWN','REVOKED','REVOKING','SIGNED'].includes(a.status)&&!l.signedAt&&!l.signedFileId&&!['REJECTED','ARCHIVED'].includes(l.state),409,'OWNER_LETTER_CLOSED','本份授权书已经签署或关闭，请查看原记录');
  ensure(owner.status==='VERIFIED'&&member.status==='VERIFIED'&&account.managerCustomerId===customerId&&account.realNameStatus==='VERIFIED'&&account.providerCustomerId===a.providerCustomerId&&owner.name===s.ownerName&&owner.creditCode===s.creditCode&&owner.address===s.ownerAddress&&profile.name===s.legalName,409,'OWNER_LETTER_IDENTITY_CHANGED','企业或法人信息与本份授权书不一致，请重新核验');
  ensure(account.certStatus==='BOUND'&&account.certSerialNo&&account.checkedAt&&account.checkedAt.getTime()<=now&&now-account.checkedAt.getTime()<86400000,409,'OWNER_CERT_REFRESH_REQUIRED','请先重新核验企业与证书状态，再继续办理授权');
  ensure(account.certSerialNo===a.certificateSerialNo,409,'OWNER_CERT_CHANGED','企业签署证书已变更，请重新核验；核验后撤回旧待签授权书，重新确认授权范围并生成新授权书');
  ensure(Date.parse(s.validUntil)>now,409,'OWNER_SCOPE_EXPIRED','本次授权期间已经结束');
  const seal=await db.ownerSeal.findFirst({where:{id:a.sealId,ownerId,status:'ACTIVE',providerCustomerId:a.providerCustomerId,providerSignatureId:a.providerSignatureId,checkedAt:{gt:new Date(now-86400000),lte:new Date(now)}}});
  ensure(seal&&seal.imageHash===s.sealImageHash&&await db.ownerSeal.count({where:{ownerId,status:'ACTIVE'}})===1,409,'OWNER_SEAL_UNAVAILABLE','本次授权印章已变化，请重新核验');
  const template=await db.legalDocument.findUnique({where:{id:s.templateId}});
  ensure(template?.type==='owner-authorization-letter'&&template.status==='PUBLISHED'&&template.confirmedBy&&template.confirmedAt&&template.version===s.templateVersion&&hash(template.content)===s.templateHash&&template.content===s.templateContent,409,'OWNER_LETTER_TEMPLATE_CHANGED','本份授权书模板已变化或不可继续签署');
  return a;
 }
 private async lease<T>(id:string,operation:(token:string)=>Promise<T>):Promise<T>{
  const token=randomUUID(),claimed=await this.db.ownerAuthorizationLetter.updateMany({where:{authorityId:id,OR:[{processingUntil:null},{processingUntil:{lt:new Date()}}]},data:{processingToken:token,processingUntil:new Date(Date.now()+leaseMs)}});
  ensure(claimed.count===1,409,'OWNER_LETTER_PROCESSING','授权书正在处理，请稍后查询原记录');
  try{return await operation(token);}
  finally{await this.db.ownerAuthorizationLetter.updateMany({where:{authorityId:id,processingToken:token},data:{processingToken:null,processingUntil:null}});}
 }
 private async update(id:string,token:string,data:Prisma.OwnerAuthorizationLetterUpdateManyMutationInput,where:Prisma.OwnerAuthorizationLetterWhereInput={}){
  const updated=await this.db.ownerAuthorizationLetter.updateMany({where:{authorityId:id,processingToken:token,processingUntil:{gt:new Date()},...where},data});
  ensure(updated.count===1,409,'OWNER_LETTER_LEASE_LOST','授权书处理状态已经变化，请查询原记录');
 }
 private expected(a:any){return{contractId:a.providerContractId,customerId:a.providerCustomerId,transactionId:a.providerTransactionId};}
 private async query(a:any){
  const expected=this.expected(a),result=await this.api.querySignResult(expected),absent=isFadadaQueryAbsent(result,expected);
  if(!absent)assertSignerResult(result,expected);
  return{result,absent,evidenceHash:hash({expected,result:result.raw})};
 }
 async requestEntry(customerId:string,ownerId:string,authorityId:string):Promise<{url:string}>{
  intakeEnabled();ensure(this.config.enabled,503,'FADADA_DISABLED','电子签署接口尚未配置');await this.ready(customerId,ownerId,authorityId);
  return this.lease(authorityId,async token=>{
   let a=await this.ready(customerId,ownerId,authorityId),l=a.letter;
   if(l.signIssuedAt){
    const proof=await this.query(a);
    ensure(proof.result.status!=='SIGNED',409,'OWNER_LETTER_ALREADY_SIGNED','本份授权书已签署，请查询并下载原文件');
    ensure(proof.absent,409,'OWNER_LETTER_RESULT_UNKNOWN','原签署结果尚待核对，请查询原记录后再继续');
   }
   if(!l.sourceFileId){
    ensure(l.state==='DRAFT'&&!l.uploadedAt&&!l.signIssuedAt,409,'OWNER_LETTER_SOURCE_MISSING','原授权书文件缺失，不能重新生成');
    ensure(this.config.cjkFontPath,503,'CJK_FONT_REQUIRED','正式授权书中文字体尚未配置');
    const rendered=await renderUnilateralLetter(l.snapshot as any,this.config.cjkFontPath);
    ensure(rendered.bodyHash===l.bodyHash,409,'OWNER_LETTER_BINDING','生成的授权正文与原确认记录不一致');
    const file=await this.writer.persistPdf(rendered.buffer,{customerId,name:authorityId+'-authorization-source.pdf',purpose:'owner-authorization'});
    await this.update(authorityId,token,{sourceFileId:file.id,sourceSha256:file.sha256,slotCoordinates:rendered.slotCoordinates as any,state:'PREPARED',lastErrorCode:null},{withdrawnAt:null,sourceFileId:null});
   }
   a=await this.ready(customerId,ownerId,authorityId);l=a.letter;
   ensure(l.sourceFileId&&l.sourceSha256&&Array.isArray(l.slotCoordinates)&&l.slotCoordinates.length===1,409,'OWNER_LETTER_SOURCE_MISSING','授权书原文或签章位置尚未就绪');
   const bytes=await this.writer.readVerified(l.sourceFileId,l.sourceSha256);
   if(!l.uploadedAt){
    try{
     if(['UPLOADING','UPLOAD_UNKNOWN'].includes(l.state)){
      const remote=await this.api.downloadSignedContract({contractId:a.providerContractId});
      ensure(digest(remote.buffer)===l.sourceSha256,409,'OWNER_LETTER_UPLOAD_UNKNOWN','渠道文件与原授权书尚未核对，不能重复上传');
     }else{
      ensure(l.state==='PREPARED',409,'OWNER_LETTER_STATE','原授权书当前不能上传');
      await this.update(authorityId,token,{state:'UPLOADING'},{withdrawnAt:null,uploadedAt:null});
      const result=await this.api.uploadDocs({contractId:a.providerContractId,docTitle:'企业车主单方用印授权书',fileName:a.providerContractId+'.pdf',pdf:bytes});
      ensure(['1','1000','success'].includes(String((result.raw as any)?.code||(result.raw as any)?.result_code||'')),502,'FADADA_UPLOAD_UNCONFIRMED','渠道上传结果尚未确认，请查询原记录');
     }
     await this.update(authorityId,token,{uploadedAt:new Date(),state:'READY',lastErrorCode:null},{uploadedAt:null});
    }catch(error){await this.db.ownerAuthorizationLetter.updateMany({where:{authorityId,processingToken:token,uploadedAt:null,state:'UPLOADING'},data:{state:'UPLOAD_UNKNOWN',lastErrorCode:'UPLOAD_UNCONFIRMED'}});throw error;}
   }
   a=await this.ready(customerId,ownerId,authorityId);
   const cert=await this.ownerApi.queryCertificate(a.providerCustomerId);
   ensure(cert.bound&&cert.serialNo,409,'OWNER_CERT_INVALID','当前企业签署证书未通过有效性核验，请重新核验企业与证书状态');
   ensure(cert.serialNo===a.certificateSerialNo,409,'OWNER_CERT_CHANGED','企业签署证书已变更，请重新核验；核验后撤回旧待签授权书，重新确认授权范围并生成新授权书');
   const current=await this.db.serial(async tx=>{
    intakeEnabled();const fresh=await this.ready(customerId,ownerId,authorityId,tx);
    ensure(fresh.letter.uploadedAt&&fresh.letter.processingToken===token&&fresh.letter.processingUntil&&fresh.letter.processingUntil>new Date(),409,'OWNER_LETTER_LEASE_LOST','授权书处理状态已经变化');
    await tx.vehicleOwner.update({where:{id:ownerId},data:{revision:{increment:1}}});
    await tx.ownerAuthorizationLetter.update({where:{authorityId},data:{state:'SIGNING',signIssuedAt:fresh.letter.signIssuedAt||new Date(),lastErrorCode:null}});
    await tx.ownerAutoAuthority.update({where:{id:authorityId},data:{status:'PENDING',enabled:false,revision:{increment:1}}});
    await audit(tx,customerId,'OWNER_LETTER_SIGN_ENTRY','vehicle-owners',ownerId,{authorityId,bodyHash:fresh.letter.bodyHash,sourceHash:fresh.letter.sourceSha256},'CUSTOMER');return fresh;
   });
   return runOwnerH5(()=>this.ownerApi.createAuthorityDocumentSignUrl({customerId:current.providerCustomerId,signatureId:current.providerSignatureId,contractId:current.providerContractId,transactionId:current.providerTransactionId,title:'企业车主单方用印授权书',positions:current.letter.slotCoordinates as any}));
  });
 }
 async refresh(customerId:string,ownerId:string,authorityId:string):Promise<void>{
  await this.load(customerId,ownerId,authorityId);
  await this.refreshBound(ownerId,authorityId,customerId);
 }
 /** Internal reconciliation only: the caller must first verify and bind the provider callback. Never expose as a customer endpoint. */
 async refreshTrusted(ownerId:string,authorityId:string):Promise<void>{
  await this.loadBound(ownerId,authorityId);
  await this.refreshBound(ownerId,authorityId);
 }
 private async refreshBound(ownerId:string,authorityId:string,customerId?:string):Promise<void>{
  ensure(this.config.enabled,503,'FADADA_DISABLED','电子签署核验接口尚未配置');
  const load=(db:Database=this.db)=>customerId===undefined?this.loadBound(ownerId,authorityId,db):this.load(customerId,ownerId,authorityId,db);
  await this.lease(authorityId,async token=>{
   const a=await load(),l=a.letter;
   if(l.signedFileId&&l.signedPdfHash){await this.writer.readVerified(l.signedFileId,l.signedPdfHash);return;}
   if(!l.signIssuedAt)return;
   try{
    const proof=await this.query(a);
    if(proof.absent){await this.update(authorityId,token,{lastErrorCode:null});return;}
    if(proof.result.status!=='SIGNED'){
     if(proof.result.status==='FAILED')await this.db.serial(async tx=>{
      const current=await load(tx);
      ensure(current.letter.processingToken===token&&current.letter.processingUntil&&current.letter.processingUntil>new Date(),409,'OWNER_LETTER_LEASE_LOST','授权书处理状态已经变化');
      await tx.ownerAuthorizationLetter.update({where:{authorityId},data:{state:'REJECTED',queryEvidenceHash:proof.evidenceHash,lastErrorCode:null}});
      await tx.ownerAutoAuthority.update({where:{id:authorityId},data:{status:current.letter.withdrawnAt?'WITHDRAWN':'REJECTED',enabled:false,checkedAt:new Date(),revision:{increment:1}}});
     });
     return;
    }
    ensure(l.uploadedAt&&l.sourceFileId&&l.sourceSha256,409,'OWNER_LETTER_TRACE','授权书缺少原文及上传记录');await this.writer.readVerified(l.sourceFileId,l.sourceSha256);
    const downloaded=await this.api.downloadSignedContract({contractId:a.providerContractId});
    ensure(digest(downloaded.buffer)!==l.sourceSha256,409,'OWNER_LETTER_SIGNED_PDF_REQUIRED','渠道尚未返回签后授权书，请稍后查询');
    const file=await this.writer.persistPdf(downloaded.buffer,{customerId:a.requestedBy,name:authorityId+'-authorization-signed.pdf',purpose:'owner-authorization'});
    await this.db.serial(async tx=>{
     const current=await load(tx),now=new Date();
     ensure(current.letter.processingToken===token&&current.letter.processingUntil&&current.letter.processingUntil>now&&!current.letter.signedFileId,409,'OWNER_LETTER_LEASE_LOST','授权书归档处理状态已经变化');
     await tx.vehicleOwner.update({where:{id:ownerId},data:{revision:{increment:1}}});
     await tx.ownerAuthorizationLetter.update({where:{authorityId},data:{state:'ARCHIVED',signedAt:now,signedFileId:file.id,signedPdfHash:file.sha256,queryEvidenceHash:proof.evidenceHash,lastErrorCode:null}});
     await tx.ownerAutoAuthority.update({where:{id:authorityId},data:{status:current.letter.withdrawnAt||current.status==='WITHDRAWN'?'WITHDRAWN':'SIGNED',enabled:false,checkedAt:now,revision:{increment:1}}});
     await audit(tx,'fadada','OWNER_LETTER_ARCHIVED','vehicle-owners',ownerId,{authorityId,bodyHash:l.bodyHash,sourceHash:l.sourceSha256,signedHash:file.sha256,withdrawn:!!current.letter.withdrawnAt},'PROVIDER');
    });
   }catch(error){
    // A failed query does not erase a signed/withdrawn fact or create another transaction.
    await this.db.ownerAuthorizationLetter.updateMany({where:{authorityId,processingToken:token},data:{lastErrorCode:'QUERY_UNCONFIRMED'}});
    await this.db.ownerAutoAuthority.updateMany({where:{id:authorityId,enabled:true},data:{enabled:false,disabledAt:new Date(),revision:{increment:1}}});throw error;
   }
  });
 }
 async withdraw(customerId:string,ownerId:string,authorityId:string):Promise<void>{
  await this.db.serial(async tx=>{
   const a=await this.load(customerId,ownerId,authorityId,tx),now=new Date();
   await this.owners.requireLegalSigningMember(customerId,ownerId,tx);
   ensure(a.requestedBy===customerId,403,'OWNER_LETTER_ACTOR','请由确认本次授权的法人本人撤回');
   if(a.letter.withdrawnAt)return;
   await tx.vehicleOwner.update({where:{id:ownerId},data:{revision:{increment:1}}});
   await tx.ownerAuthorizationLetter.update({where:{authorityId},data:{withdrawnAt:now}});
   await tx.ownerAutoAuthority.update({where:{id:authorityId},data:{status:'WITHDRAWN',enabled:false,disabledAt:now,revokedAt:now,revision:{increment:1}}});
   await audit(tx,customerId,'OWNER_LETTER_WITHDRAWN','vehicle-owners',ownerId,{authorityId,bodyHash:a.letter.bodyHash},'CUSTOMER');
  });
 }
 async document(customerId:string,ownerId:string,id:string,variant:'source'|'signed'):Promise<{buffer:Buffer;fileName:string;sha256:string}>{
  ensure(variant==='source'||variant==='signed',404,'NOT_FOUND','授权书文件不存在');const a=await this.load(customerId,ownerId,id),l=a.letter;
  ensure(a.requestedBy===customerId,403,'OWNER_LETTER_ACTOR','仅本份授权书的原办理法人可读取文件');
  const member=await this.owners.requireSigningMember(customerId,ownerId);
  ensure((member.owner.esignAccount?.consentSnapshot as any)?.channel==='OWNER_LEGAL_H5',403,'OWNER_LEGAL_NOT_VERIFIED','请由当前法人本人完成核验后读取授权书');
  const fileId=variant==='source'?l.sourceFileId:l.signedFileId,sha256=variant==='source'?l.sourceSha256:l.signedPdfHash;
  ensure(fileId&&sha256,404,'OWNER_LETTER_FILE_NOT_READY','授权书文件尚未就绪');
  return{buffer:await this.writer.readVerified(fileId,sha256),fileName:id+'-authorization-'+variant+'.pdf',sha256};
 }
}
