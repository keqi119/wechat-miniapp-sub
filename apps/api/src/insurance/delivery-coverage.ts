import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {resolve,sep} from 'node:path';
import {projectRoot} from '../common/config';
import {validMime} from '../files/storage';
import {evaluateCoverage} from './coverage';
import {effectivePolicyVersion} from './registration-facts';
import type {CoverageResult,InsuranceTx} from './types';

const requiredTypes=[['COMPULSORY_TRAFFIC','交强险'],['COMMERCIAL','商业险']] as const;
const uploadRoot=resolve(process.env.UPLOAD_DIR||resolve(projectRoot,'var/uploads'));
async function originalIsIntact(file:any){
 if(!file||!['application/pdf','image/jpeg','image/png'].includes(file.mimeType)||!Number.isSafeInteger(file.size)||file.size<=0||file.size>10*1024*1024||!/^[a-f0-9]{64}$/.test(file.sha256)||typeof file.storagePath!=='string'||!resolve(file.storagePath).startsWith(uploadRoot+sep))return false;
 try{
  const [root,path]=await Promise.all([fs.realpath(uploadRoot),fs.realpath(file.storagePath)]);
  if(!path.startsWith(root+sep))return false;const stat=await fs.stat(path);if(!stat.isFile()||stat.size!==file.size)return false;
  const bytes=await fs.readFile(path);return bytes.length===file.size&&validMime(bytes,file.mimeType)&&createHash('sha256').update(bytes).digest('hex')===file.sha256;
 }catch{return false;}
}

/** Actual-delivery guard. Never inferred from publication status or a previous readiness response. */
export async function deliveryCoverageAt(tx:InsuranceTx,vehicleId:string,productVersionId:string,at:Date):Promise<CoverageResult>{
 const blockers:CoverageResult['blockers']=[],policyVersionIds:string[]=[],requirementIds:string[]=[];
 if(!Number.isFinite(at.getTime()))return{ready:false,blockers:[{code:'INSURANCE_TIME_INVALID',label:'请核对实际交付时间',resourceType:'vehicles',resourceId:vehicleId}],policyVersionIds,requirementIds};
 const [vehicle,product]=await Promise.all([tx.vehicle.findUnique({where:{id:vehicleId},select:{modelDefinitionId:true}}),tx.productVersion.findUnique({where:{id:productVersionId},select:{id:true}})]);
 if(!vehicle||!product)return{ready:false,blockers:[{code:!vehicle?'INSURANCE_VEHICLE_MISSING':'INSURANCE_PRODUCT_MISSING',label:!vehicle?'被保车辆不存在':'对应产品版本不存在',resourceType:!vehicle?'vehicles':'products',resourceId:!vehicle?vehicleId:productVersionId}],policyVersionIds,requirementIds};
 const policies=await tx.insurancePolicy.findMany({where:{versions:{some:{vehicleIds:{has:vehicleId}}}},include:{versions:true}}),types=new Set<string>();
 for(const policy of policies){
  const v:any=effectivePolicyVersion(policy.versions,at);if(!v||!v.vehicleIds?.includes(vehicleId)||v.changeKind==='CANCELLATION'||new Date(v.startAt)>at||new Date(v.endAt)<=at)continue;
  if(!evaluateCoverage({vehicleId,modelDefinitionId:vehicle.modelDefinitionId,productVersionId,requirements:[],versions:policy.versions},at).ready)continue;
  const explicit=requiredTypes.some(([type])=>type===v.policyType);
  const classified:string[]=v.status==='REGISTERED'||explicit?[v.policyType]:v.coverageItems.map((item:any)=>item.code).filter((code:string)=>requiredTypes.some(([type])=>type===code));
  if(!classified.some(type=>requiredTypes.some(([required])=>required===type)))continue;
  const ids:string[]=v.fileIds;if(new Set(ids).size!==ids.length)continue;
  const [files,bindings]=await Promise.all([tx.storedFile.findMany({where:{id:{in:ids}}}),tx.insurancePolicyFile.findMany({where:{policyId:policy.id,fileId:{in:ids}}})]);
  if(files.length!==ids.length)continue;let valid=true;
  for(const f of files){
   const b=bindings.find(row=>row.fileId===f.id),frozen=v.status==='REGISTERED'?v.registrationSnapshot.files.find((row:any)=>row.id===f.id):null;
   if(!b||b.policyId!==policy.id||!b.vehicleIds.some(id=>v.vehicleIds.includes(id))||f.purpose!=='insurance'||f.customerId||!f.adminId||f.adminId!==b.uploadedBy||frozen&&(frozen.sha256!==f.sha256||frozen.size!==f.size||frozen.mimeType!==f.mimeType||!frozen.vehicleIds.every((id:string)=>b.vehicleIds.includes(id)))||!await originalIsIntact(f)){valid=false;break;}
  }
  const ownFiles=bindings.filter(b=>b.vehicleIds.includes(vehicleId)).map(b=>b.fileId);
  if(!ownFiles.length||v.status==='APPROVED'&&!v.reviewChecks?.some((proof:any)=>proof.vehicleId===vehicleId&&ownFiles.includes(proof.fileId)))valid=false;
  if(valid){for(const type of classified)types.add(type);policyVersionIds.push(v.id);}
 }
 for(const [type,label] of requiredTypes)if(!types.has(type))blockers.push({code:'DELIVERY_INSURANCE_'+type+'_REQUIRED',label:`交付前请补齐实际交付时有效的${label}及保单原件，并完成登记或复核`,resourceType:'vehicles',resourceId:vehicleId});
 return{ready:!blockers.length,blockers,policyVersionIds,requirementIds};
}
