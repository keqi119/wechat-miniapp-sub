import {requireOfflinePartnerCustomer} from './offline-access';
import {assertNewEsignAllowed,newOrderContractMode} from '../offline-documents/mode';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {requireCurrentConsents} from '../auth/consents';
import {FadadaSettings} from '../esign/esign.settings';
import {OwnerContractAccess} from '../owner-signing/contract-access';
import {OwnerContractGateway,ownerManualContractsEnabled} from '../owner-signing/gateway';
import {runOwnerH5} from '../owner-signing/fadada-owner.client';
import {requireOwnerLegalRepresentative} from './legal-representative';
const signInput=z.object({accepted:z.literal(true),documentHash:z.string().regex(/^[a-f0-9]{64}$/),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const queryInput=z.object({}).strict();

/** Only current legal representatives may view the customer-authorized, immutable owner contract. */
export class OwnerH5ContractsService {
 constructor(private db:Db,private access:OwnerContractAccess,private gateway:OwnerContractGateway,private config:FadadaSettings){}
 private project(record:Awaited<ReturnType<OwnerContractAccess['detail']>>){
  const {sourceFileId,signedFileId,signedPdfHash,canChooseManual,...result}=record;
  const enabled=ownerManualContractsEnabled(this.config);
  return{...result,canSign:newOrderContractMode()!=='OFFLINE'&&enabled&&result.canSign,blockers:[...result.blockers,...(enabled?[]:['平台逐单手动签署入口尚未开放'])]};
 }
 async list(customerId:string,ownerId:string){return runOwnerH5(async()=>{
  if(newOrderContractMode()==='OFFLINE')await requireOfflinePartnerCustomer(this.db,customerId,ownerId);else await requireOwnerLegalRepresentative(this.db,customerId,ownerId);
  const rows=await this.access.list(customerId,ownerId),items=[];
  for(const row of rows){
   try{const {body,...summary}=this.project(await this.access.detail(customerId,ownerId,row.id));items.push(summary);}
   catch(error:any){if(error.getResponse?.()?.error?.code!=='OWNER_SHARING_CONSENT')throw error;}
  }
  return{items,signingMode:'MANUAL' as const,manualSigningEnabled:newOrderContractMode()!=='OFFLINE'&&ownerManualContractsEnabled(this.config),automaticSigningEnabled:false as const};
 });}
 async detail(customerId:string,ownerId:string,id:string){return runOwnerH5(async()=>{if(newOrderContractMode()==='OFFLINE')await requireOfflinePartnerCustomer(this.db,customerId,ownerId);else await requireOwnerLegalRepresentative(this.db,customerId,ownerId);return this.project(await this.access.detail(customerId,ownerId,id));});}
 async file(customerId:string,ownerId:string,id:string,variant:string){return runOwnerH5(async()=>{if(newOrderContractMode()==='OFFLINE')await requireOfflinePartnerCustomer(this.db,customerId,ownerId);else await requireOwnerLegalRepresentative(this.db,customerId,ownerId);return this.access.file(customerId,ownerId,id,variant);});}
 async sign(customerId:string,ownerId:string,id:string,raw:unknown){assertNewEsignAllowed({executionMode:newOrderContractMode()});return runOwnerH5(async()=>{
  const input=signInput.parse(raw);if(newOrderContractMode()==='OFFLINE')await requireOfflinePartnerCustomer(this.db,customerId,ownerId);else await requireOwnerLegalRepresentative(this.db,customerId,ownerId);await requireCurrentConsents(this.db,customerId,['terms','privacy']);
  const t=this.project(await this.access.detail(customerId,ownerId,id));
  ensure(input.documentHash===t.documentHash&&input.sourceSha256===t.sourceSha256,409,'DOCUMENT_MISMATCH','请重新核对本份合同全文及PDF');
  ensure(t.canSign,409,'OWNER_CONTRACT_NOT_READY',t.blockers[0]||'当前合同尚未满足签署条件');
  // Missing or altered source bytes never obtain a sign URL.
  await this.access.file(customerId,ownerId,id,'source');
  return this.gateway.ownerSign(customerId,ownerId,id);
 });}
 async sync(customerId:string,ownerId:string,id:string,raw:unknown){return runOwnerH5(async()=>{
  queryInput.parse(raw);if(newOrderContractMode()==='OFFLINE')await requireOfflinePartnerCustomer(this.db,customerId,ownerId);else await requireOwnerLegalRepresentative(this.db,customerId,ownerId);const t=await this.access.detail(customerId,ownerId,id);
  ensure(t.canQuery,409,'SIGNATURE_STATE','本份合同当前不能查询签署');return this.gateway.query(id,false);
 });}
}
