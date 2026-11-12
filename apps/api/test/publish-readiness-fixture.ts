import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {projectRoot} from '../src/common/config';
import {fileReadStore} from './file-store-fixture';

const root=resolve(process.env.UPLOAD_DIR||resolve(projectRoot,'var/uploads'));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9fcAAAAASUVORK5CYII=','base64');
export function syntheticPublicationFile(id:string,purpose='vehicle',mimeType='image/png',bytes=png){const sha256=createHash('sha256').update(bytes).digest('hex'),storagePath=resolve(root,sha256.slice(0,2),sha256);mkdirSync(resolve(root,sha256.slice(0,2)),{recursive:true});writeFileSync(storagePath,bytes);return{id,name:id+(mimeType==='application/pdf'?'.pdf':'.png'),purpose,mimeType,size:bytes.length,sha256,storagePath,customerId:null,adminId:'operator',fieldTaskId:null};}

/** Genuine synthetic byte manifests; never a production mock fallback. */
export function addPublicationFacts(tx:any,vehicle:any){
 Object.assign(vehicle,{revision:vehicle.revision??0,title:vehicle.title??'合成车辆',brand:vehicle.brand??'合成',model:vehicle.model??'合成车型',modelDefinitionId:vehicle.modelDefinitionId??'model',year:vehicle.year??2026,city:vehicle.city??'上海',mileageKm:vehicle.mileageKm??100,coverFileId:vehicle.coverFileId??'public-image',mediaFileIds:vehicle.mediaFileIds??['public-image']});
 const publicFile=syntheticPublicationFile('public-image'),files:any[]=[publicFile],bindings:any[]=[],policies:any[]=[];
 const at=new Date('2026-01-01T00:00:00Z'),startAt=new Date('2025-12-31T16:00:00Z'),endAt=new Date('2040-12-31T16:00:00Z');
 for(const policyType of ['COMPULSORY_TRAFFIC','COMMERCIAL']){
  const policyId='policy-'+policyType,original=syntheticPublicationFile('file-'+policyType,'insurance','application/pdf',Buffer.from('%PDF-1.4 synthetic '+policyType));files.push(original);bindings.push({policyId,fileId:original.id,vehicleIds:[vehicle.id],uploadedBy:'operator'});
  const registrationSnapshot={schemaVersion:1,confirmed:true,registeredBy:'operator',registeredAt:at.toISOString(),policy:{insurer:'合成机构',policyNumber:policyId,policyType,insuredParty:'合成被保人',startAt:startAt.toISOString(),endAt:endAt.toISOString()},vehicles:[{id:vehicle.id,vin:vehicle.vin??null,plateNumber:vehicle.plateNumber??null,title:vehicle.title}],files:[{id:original.id,name:original.name,mimeType:original.mimeType,size:original.size,sha256:original.sha256,vehicleIds:[vehicle.id]}]};
  policies.push({id:policyId,insurer:'合成机构',policyNumber:policyId,versions:[{id:'version-'+policyType,policyId,version:1,status:'REGISTERED',changeKind:'ORIGINAL',effectiveAt:at,registeredAt:at,registeredBy:'operator',insurerSnapshot:'合成机构',policyNumberSnapshot:policyId,policyType,insuredParty:'合成被保人',startAt,endAt,vehicleIds:[vehicle.id],coverageItems:[],terms:'',fileIds:[original.id],requirementVersionIds:[],reviewChecks:null,registrationSnapshot}]});
 }
 const asset:any={vehicleId:vehicle.id,revision:1,batteryOwnership:'OWNED'},owner:any={id:'partner',subjectType:'ENTERPRISE',name:'合成合作方',creditCode:'91310000123456789X',address:'上海合成地址',contactPhone:'13800000000',ordinaryContactPhone:'',status:'DRAFT'},condition:any={vehicleId:vehicle.id,revision:1,fireDamage:false,floodDamage:false,structuralDamage:false,assessedBy:'operator',assessedAt:at},baas:any[]=[];
 const privacy=fileReadStore();for(const [name,delegate] of Object.entries(privacy))if(!tx[name])tx[name]=delegate;
 tx.vehicleOperationalRestriction??={count:async()=>0};
 tx.vehicleAssetProfile={findUnique:async()=>asset};tx.vehicleConditionAssessment={findUnique:async()=>condition};tx.vehicleBaasContract={findMany:async()=>baas};
 tx.partnerAgreementVehicle={findUnique:async()=>null};tx.partnerAgreement={findMany:async()=>[{id:'draft-agreement',ownerId:owner.id,status:'DRAFT'}]};
 tx.partnerAgreementVersion={...tx.partnerAgreementVersion,findMany:async()=>[{agreementId:'draft-agreement',ownerId:owner.id,version:1,status:'DRAFT',vehicleIds:[vehicle.id]}]};
 tx.vehicleOwner={findMany:async()=>[owner],findUnique:async()=>owner};tx.ownerVehicle={...tx.ownerVehicle,findUnique:async()=>null};tx.partnerVehicleBindingProposal={...tx.partnerVehicleBindingProposal,findMany:async()=>[]};
 tx.insurancePolicy={findMany:async()=>policies};tx.insurancePolicyFile={findMany:async({where}:any)=>bindings.filter(b=>b.policyId===where.policyId&&(!where.fileId?.in||where.fileId.in.includes(b.fileId))),count:async({where}:any)=>bindings.filter(b=>b.fileId===where.fileId).length};
 tx.storedFile={findMany:async({where}:any)=>files.filter(f=>where.id.in.includes(f.id)),findUnique:async({where}:any)=>files.find(f=>f.id===where.id)??null};
 tx.modelDefinition={...tx.modelDefinition,findUnique:async()=>({id:vehicle.modelDefinitionId,brand:vehicle.brand,name:vehicle.model})};
 return{asset,owner,condition,baas,files,policies,bindings,publicFile};
}
