import {Db} from '../common/db';
import type {FadadaSettings} from '../esign/esign.settings';
import {ContractPdfArtifactWriterService} from '../contract/contract-pdf-artifact-writer.service';
import {OwnerIdentityService} from '../owner-signing/identity';
import {OwnerAuthorizationService} from '../owner-signing/authorization';
import {ElectronicProvider} from './provider';
import {ElectronicDocumentService} from './service';
export function electronicIntegration(db:Db,config:FadadaSettings,writer:ContractPdfArtifactWriterService,identity:OwnerIdentityService,authorization:OwnerAuthorizationService){
 return new ElectronicDocumentService(db,new ElectronicProvider(config),writer,{
  refreshAuthorities:async(task:any)=>{
   for(const party of task.parties.filter((p:any)=>p.mode==='AUTO'&&!p.attemptedAt)){
    const id=party.identitySnapshot?.autoAuthority?.id;if(!id)continue;
    const business=await db.electronicAutoAuthority.findUnique({where:{id},include:{providerAuthority:true,owner:{include:{esignAccount:true}}}});
    if(!business?.enabled||business.revokedAt||!business.providerAuthority.enabled||business.providerAuthority.method!=='PROVIDER_AUTO_GRANT'||business.owner.esignAccount?.managerCustomerId!==business.acceptedBy)continue;
    const account=business.owner.esignAccount;if(!account.checkedAt||Date.now()-account.checkedAt.getTime()>23*3600000)await identity.refreshLegal(business.acceptedBy,business.ownerId);
    await authorization.refresh(business.acceptedBy,business.ownerId,business.providerAuthorityId);
   }
  }
 });
}
