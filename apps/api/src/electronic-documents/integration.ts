import {activateTermination06} from '../orders/termination';
import {activateCancellation04} from '../orders/cancellation04';
import {activateElectronicRenewal} from '../order-renewals/electronic-archive';
import {archiveSealGrant} from './seal-authorization';
import {activateElectronicSwap} from '../vehicle-changes/electronic-archive';
import {Db} from '../common/db';
import type {FadadaSettings} from '../esign/esign.settings';
import {ContractPdfArtifactWriterService} from '../contract/contract-pdf-artifact-writer.service';
import {OwnerIdentityService} from '../owner-signing/identity';
import {OwnerAuthorizationService} from '../owner-signing/authorization';
import {ElectronicProvider} from './provider';
import {ElectronicDocumentService} from './service';
import {activateElectronicCooperation} from './cooperation';
import {activateElectronicSubscription} from './subscription';
export function electronicIntegration(db:Db,config:FadadaSettings,writer:ContractPdfArtifactWriterService,identity:OwnerIdentityService,authorization:OwnerAuthorizationService){
 return new ElectronicDocumentService(db,new ElectronicProvider(config),writer,{
  afterArchive:async(tx:any,task:any)=>{if(task.kind==='EARLY_TERMINATION')await activateTermination06(tx,task);else if(task.kind==='PRE_DELIVERY_CANCELLATION')await activateCancellation04(tx,task);else if(task.kind==='COOPERATION_GRANT')await archiveSealGrant(tx,task);else if(['COOPERATION','COOPERATION_AMENDMENT','COOPERATION_TERMINATION'].includes(task.kind))await activateElectronicCooperation(tx,task);else if(task.kind==='SUBSCRIPTION')await activateElectronicSubscription(tx,task);else if(task.kind==='VEHICLE_SWAP')await activateElectronicSwap(tx,task);else if(task.kind==='RENEWAL')await activateElectronicRenewal(tx,task);},
  refreshAuthorities:async(task:any)=>{
   const context=task.snapshot?.context;
   if(context?.autoSigningPolicyVersion===3&&context.signaturePolicy!=='MANUAL_ONLY'&&context.kind!=='COOPERATION_GRANT'&&process.env.OWNER_AUTO_SIGNING_ENABLED==='true'){
    for(const party of task.parties.filter((p:any)=>p.subjectType==='ENTERPRISE'&&(!task.kind.startsWith('COOPERATION')||p.role==='PLATFORM'))){
     const grant=await db.ownerAutoAuthority.findFirst({where:{ownerId:party.subjectId,enabled:true,status:'AUTHORIZED',revokedAt:null,createdAt:{lte:new Date(context.authorityCreatedBefore)},scope:{path:['version'],equals:3}},include:{owner:{include:{esignAccount:true}}},orderBy:{createdAt:'desc'}});
     if(!grant)continue;
     try{const account=grant.owner.esignAccount;if(!account?.checkedAt||Date.now()-account.checkedAt.getTime()>23*3600000)await identity.refreshLegal(grant.requestedBy,grant.ownerId);await authorization.refresh(grant.requestedBy,grant.ownerId,grant.id);}catch{/* Failed checks disable the grant or fail current identity validation; the business task retains its personal-sign fallback. */}
    }
   }
   for(const party of task.parties.filter((p:any)=>p.mode==='AUTO'&&!p.attemptedAt)){
    if(party.identitySnapshot?.autoAuthority?.policyVersion===3)continue;
    const id=party.identitySnapshot?.autoAuthority?.id;if(!id)continue;
    const business=await db.electronicAutoAuthority.findUnique({where:{id},include:{providerAuthority:true,owner:{include:{esignAccount:true}}}});
    if(!business?.enabled||business.revokedAt||!business.providerAuthority.enabled||business.providerAuthority.method!=='PROVIDER_AUTO_GRANT'||business.owner.esignAccount?.managerCustomerId!==business.acceptedBy)continue;
    const account=business.owner.esignAccount;if(!account.checkedAt||Date.now()-account.checkedAt.getTime()>23*3600000)await identity.refreshLegal(business.acceptedBy,business.ownerId);
    await authorization.refresh(business.acceptedBy,business.ownerId,business.providerAuthorityId);
   }
  }
 });
}
