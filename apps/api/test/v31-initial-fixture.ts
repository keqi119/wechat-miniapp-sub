import {randomUUID} from 'node:crypto';
import {syntheticSigningTime,syntheticFinalVerification,signingParties,sha} from './electronic-fixtures';
import {SimpleAgreementService} from '../src/partners/simple-agreements';
import {activateElectronicCooperation} from '../src/electronic-documents/cooperation';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';
import {canonicalHash} from '../src/customers/types';
import {finalizeElectronicArchive} from '../src/electronic-documents/archive';
import {seedV31CooperationSources,v31FixtureContent} from './v31-cooperation-fixture';
import {activateElectronicSubscription} from '../src/electronic-documents/subscription';
async function fixture(db:any){const uid=randomUUID(),staff=await db.adminUser.create({data:{username:uid,passwordHash:'synthetic-only',name:'合成运营',role:'OPERATIONS'}}),owner=await db.vehicleOwner.create({data:{name:'合成合作商',address:'合成地址',createdBy:staff.id}}),vehicle=await db.vehicle.create({data:{brand:'测试',model:'EV',title:'合成车辆',year:2026,city:'上海',mileageKm:1}});return{owner,vehicle,actor:{id:staff.id,role:staff.role,authVersion:staff.authVersion},input:{revision:0,idempotencyKey:uid,status:'DRAFT',title:'合成电子合作协议',vehicleIds:[vehicle.id],partnerRateBps:7500,validFrom:'2026-11-01',validUntil:'2027-12-31'}};}
export async function prepareFixture(db:any,range:{cooperationUntil?:string;vehicleUntil?:string}={}){
 const f=await fixture(db);if(range.cooperationUntil)f.input.validUntil=range.cooperationUntil;await db.vehicle.update({where:{id:f.vehicle.id},data:{vin:'SYN'+randomUUID().replaceAll('-','').slice(0,14).toUpperCase()}});await db.vehicleOwner.update({where:{id:f.owner.id},data:{creditCode:'SYN'+randomUUID().replaceAll('-','').slice(0,15).toUpperCase()}});
 const platform=await db.vehicleOwner.create({data:{name:'上海宁达信息科技有限公司',creditCode:'SYN'+randomUUID().replaceAll('-','').slice(0,15).toUpperCase(),address:'合成地址',createdBy:f.actor.id}}),providerId='ND'+randomUUID().replace(/-/g,'').slice(0,25);
 await db.ownerESignAccount.create({data:{ownerId:platform.id,providerCustomerId:providerId}});process.env.FADADA_PLATFORM_CUSTOMER_ID=providerId;
 const v31Sources=await seedV31CooperationSources(db,f.actor.id,f.owner,platform,f.vehicle,{countBenefit:true});
 if(range.vehicleUntil||range.cooperationUntil)v31Sources.vehicleScopes=v31Sources.vehicleScopes.map(s=>({...s,validUntil:range.vehicleUntil??range.cooperationUntil!}));
 const draft=await db.serial((tx:any)=>new SimpleAgreementService().save(tx,f.actor,f.owner.id,{...f.input,v31Sources}));
 const template=await db.legalDocument.create({data:{type:'ELECTRONIC_V31_COOPERATION',version:Math.floor(Math.random()*1000000000)+1,title:'合成车辆合作协议',content:v31FixtureContent('02-main'),status:'DRAFT'}});
 const resolveParties=async()=>signingParties().filter(p=>p.role!=='CUSTOMER').map(p=>({...p,subjectId:p.role==='OWNER'?f.owner.id:platform.id,autoAuthority:null,certificate:{...p.certificate,checkedAt:new Date().toISOString()}}));
 const input={kind:'COOPERATION',resourceId:draft.latestVersion.id,revision:draft.revision,templateId:template.id,idempotencyKey:randomUUID()};return{...f,platform,draft,template,input,v31Sources,options:{resolveParties,fontPath:'C:/Windows/Fonts/msyh.ttc'},writer:new ContractPdfArtifactWriterService(db)};
}
export async function syntheticArchive(db:any,f:any,prepared:any){
 const task=await db.electronicSigningTask.findUnique({where:{id:prepared.taskId},include:{parties:true}}),now=Date.now(),uploadedAt=task.uploadedAt??new Date(now-60000);
 const final=await f.writer.persistPdf(Buffer.from('%PDF-1.7\nSynthetic signed PDF for database test only.\n'+sha('f')+'\n%%EOF'),{customerId:task.customerId??null,name:'合成签后.pdf',purpose:'electronic-final'});
 await db.serial(async(tx:any)=>{
  for(const [i,p]of task.parties.entries()){const attemptedAt=new Date(now-50000+i*10000),manualConsent={version:1,taskId:task.id,role:p.role,actorId:'synthetic',sourceSha256:task.sourceSha256,businessHash:task.businessHash,identityHash:p.identityHash,acceptedAt:attemptedAt.toISOString()};await tx.electronicSigningParty.update({where:{id:p.id},data:{manualConsent,manualConsentHash:canonicalHash(manualConsent)}});await tx.electronicSigningParty.update({where:{id:p.id},data:{attemptedAt,verifiedAt:new Date(attemptedAt.getTime()+5000),...syntheticSigningTime(new Date(attemptedAt.getTime()+1000)),queryEvidenceHash:sha('b'),status:'SIGNED'}});}
  await tx.electronicSigningTask.update({where:{id:task.id},data:{status:'ARCHIVING',uploadStatus:'UPLOADED',uploadedAt,uploadEvidenceHash:task.uploadEvidenceHash??sha('c'),filingStatus:'CONFIRMED',filedAt:new Date(now-10000),filingEvidenceHash:sha('d'),finalFileId:final.id,finalSha256:final.sha256,finalVerification:syntheticFinalVerification(task,final.sha256)}});
  if(prepared.deferArchive)return;await finalizeElectronicArchive(tx,task.id);const current=await tx.electronicSigningTask.findUnique({where:{id:task.id}});if(current.kind==='SUBSCRIPTION')await activateElectronicSubscription(tx,current);else await activateElectronicCooperation(tx,current);
 });return task;
}


