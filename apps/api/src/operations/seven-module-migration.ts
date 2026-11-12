import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evaluateCoverage} from '../insurance/coverage';
import {effectivePolicyVersion,validRegistration} from '../insurance/registration-facts';
import {cooperationBusinessHash} from '../offline-documents/snapshot';
import {migrateLegacyProducts} from '../products/service';
import type {Prisma} from '@prisma/client';

export type MigrationIssue={resourceType:'vehicles'|'partners'|'subscription-plans'|'insurance-policies';resourceId:string;code:string};
export type SevenModuleFacts={
 vehicles:any[];plans:any[];owners:any[];verifications:any[];identityBindings:any[];
 archives:any[];feedback:any[];requirements:any[];policies:any[];productVersions:any[];
 counts:{products:number;legacyEsignOrders:number;offlineOrders:number;legacyEsignContracts:number};
};
export type MigrationInspection={
 formatVersion:1;checkedAt:string;
 counts:SevenModuleFacts['counts']&{vehicles:number;partners:number;plans:number;legacyPlans:number;productVersions:number;issues:number;resourcesNeedingAttention:number};
 issues:MigrationIssue[];
};
const dateValue=(value:unknown)=>new Date(value as string).getTime();
const currentVersion=(rows:any[],at:Date)=>rows.filter(v=>dateValue(v.effectiveAt)<=at.getTime()).sort((a,b)=>dateValue(b.effectiveAt)-dateValue(a.effectiveAt)||b.version-a.version)[0];

/** Pure audit. Never returns business content, VINs, names, identity or financial details. */
export function auditSevenModuleFacts(facts:SevenModuleFacts,at:Date=new Date()):MigrationInspection{
 if(!Number.isFinite(at.getTime()))throw new Error('BACKFILL_AUDIT_TIME_INVALID');
 const issues:MigrationIssue[]=[],seen=new Set<string>();
 const add=(resourceType:MigrationIssue['resourceType'],resourceId:string,code:string)=>{
  const key=JSON.stringify([resourceType,resourceId,code]);if(!seen.has(key)){seen.add(key);issues.push({resourceType,resourceId,code});}
 };
 const owners=new Map(facts.owners.map(row=>[row.id,row])),versions=new Map(facts.productVersions.map(row=>[row.id,row]));
 const normalizedVins=new Map<string,string[]>();
 for(const vehicle of facts.vehicles){
  const vin=typeof vehicle.vin==='string'?vehicle.vin.trim().toUpperCase():'';
  if(!vin)add('vehicles',vehicle.id,'VIN_MISSING');
  else{
   if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))add('vehicles',vehicle.id,'VIN_INVALID');
   const ids=normalizedVins.get(vin)||[];ids.push(vehicle.id);normalizedVins.set(vin,ids);
  }
 }
 for(const ids of normalizedVins.values())if(ids.length>1)for(const id of ids)add('vehicles',id,'VIN_DUPLICATE');
 for(const owner of facts.owners){
  const verification=facts.verifications.filter(v=>v.ownerId===owner.id).sort((a,b)=>b.revision-a.revision)[0];
  const identity=facts.identityBindings.find(b=>b.id===verification?.identityBindingId);
  const approved=owner.status!=='SUSPENDED'&&verification?.status==='APPROVED'&&verification.reviewedBy&&verification.reviewedAt&&verification.profileRevision===owner.revision&&
   identity?.ownerId===owner.id&&identity.status==='APPROVED'&&!identity.revokedAt&&identity.reviewedBy&&identity.reviewedAt&&identity.revision===verification.identityBindingRevision&&identity.profileRevision===owner.revision&&
   (owner.subjectType==='INDIVIDUAL'?owner.creditCode==null&&identity.relationship==='SELF':owner.subjectType==='ENTERPRISE'&&/^[A-Z0-9]{18}$/.test(owner.creditCode||'')&&identity.relationship==='ENTERPRISE_REPRESENTATIVE');
  if(!approved)add('partners',owner.id,'OWNER_BUSINESS_UNVERIFIED');
 }
 for(const plan of facts.plans){
  const version=versions.get(plan.productVersionId);
  if(!version)add('subscription-plans',plan.id,'PRODUCT_VERSION_MISSING');
  else if(version.status!=='PUBLISHED')add('subscription-plans',plan.id,'PRODUCT_REVIEW_REQUIRED');
 }
 // This is an as-of-today inventory audit; order confirmation separately checks the full lease range.
 const today=new Date(at.getTime()+8*3600000).toISOString().slice(0,10);
 for(const vehicle of facts.vehicles){
  const binding=vehicle.ownerBinding,owner=owners.get(binding?.ownerId);
  if(!owner||binding?.status!=='APPROVED'||!binding.reviewedBy||!binding.reviewedAt)add('vehicles',vehicle.id,'OWNER_VEHICLE_REQUIRED');
  if(owner){
   const archive=facts.archives.find(a=>a.ownerId===owner.id),current=archive?.versions.find((v:any)=>v.id===archive.currentApprovedVersionId),scope=current?.scopeSnapshot;
   const scopeValid=Array.isArray(scope?.vehicleIds)&&scope.vehicleIds.every((id:unknown)=>typeof id==='string')&&typeof scope.validFrom==='string'&&typeof scope.validUntil==='string';
   const ready=current?.status==='ARCHIVED'&&scopeValid&&current.businessSnapshotHash===cooperationBusinessHash(owner.id,owner.revision,scope)&&scope.vehicleIds.includes(vehicle.id)&&scope.validFrom<=today&&scope.validUntil>=today;
   if(!ready)add('vehicles',vehicle.id,'OWNER_COOPERATION_REQUIRED');
   if(archive&&facts.feedback.some(f=>f.version?.archiveId===archive.id&&(f.versionId===current?.id||f.version?.scopeSnapshot?.vehicleIds?.includes(vehicle.id))))add('vehicles',vehicle.id,'OWNER_COOPERATION_FEEDBACK_OPEN');
  }
  const vehiclePlans=facts.plans.filter(p=>p.vehicleId===vehicle.id);
  if(!vehiclePlans.length)add('vehicles',vehicle.id,'PRODUCT_VERSION_MISSING');
  const productIds=[...new Set(vehiclePlans.flatMap(p=>versions.has(p.productVersionId)?[p.productVersionId]:[]))];
  for(const productId of productIds.length?productIds:[null]){
   const result=evaluateCoverage({vehicleId:vehicle.id,modelDefinitionId:vehicle.modelDefinitionId,productVersionId:productId||'',requirements:[],versions:facts.policies},at);
   for(const blocker of result.blockers)add(blocker.resourceId===vehicle.id?'vehicles':'insurance-policies',blocker.resourceId,blocker.code);
  }
  const policyIds=[...new Set(facts.policies.filter(p=>p.vehicleIds.includes(vehicle.id)).map(p=>p.policyId))];
  const hasCurrentPolicy=policyIds.some(id=>{const policy=effectivePolicyVersion(facts.policies.filter(p=>p.policyId===id),at);return policy&&(policy.status!=='REGISTERED'||validRegistration(policy,vehicle.id))&&policy.vehicleIds.includes(vehicle.id)&&policy.changeKind!=='CANCELLATION'&&dateValue(policy.startAt)<=at.getTime()&&dateValue(policy.endAt)>at.getTime();});
  if(!hasCurrentPolicy)add('vehicles',vehicle.id,'INSURANCE_POLICY_MISSING');
 }
 issues.sort((a,b)=>a.resourceType.localeCompare(b.resourceType)||a.resourceId.localeCompare(b.resourceId)||a.code.localeCompare(b.code));
 return {formatVersion:1,checkedAt:at.toISOString(),counts:{...facts.counts,vehicles:facts.vehicles.length,partners:facts.owners.length,plans:facts.plans.length,legacyPlans:facts.plans.filter(p=>p.productVersionId===null).length,productVersions:facts.productVersions.length,issues:issues.length,resourcesNeedingAttention:new Set(issues.map(i=>`${i.resourceType}:${i.resourceId}`)).size},issues};
}

/** Read-only queries. Call in a repeatable transaction when a consistent inventory is required. */
export async function inspectSevenModuleMigration(tx:Prisma.TransactionClient,at:Date=new Date()):Promise<MigrationInspection>{
 const [vehicles,plans,owners,verifications,identityBindings,archives,feedback,policies,productVersions,products,legacyEsignOrders,offlineOrders,legacyEsignContracts]=await Promise.all([
  tx.vehicle.findMany({select:{id:true,vin:true,modelDefinitionId:true,ownerBinding:{select:{id:true,ownerId:true,status:true,reviewedBy:true,reviewedAt:true}}}}),
  tx.subscriptionPlan.findMany({select:{id:true,vehicleId:true,productVersionId:true,active:true}}),
  tx.vehicleOwner.findMany({select:{id:true,subjectType:true,creditCode:true,status:true,revision:true}}),
  tx.partnerVerification.findMany({select:{id:true,ownerId:true,revision:true,profileRevision:true,status:true,reviewedBy:true,reviewedAt:true,identityBindingId:true,identityBindingRevision:true}}),
  tx.partnerIdentityBinding.findMany({select:{id:true,ownerId:true,relationship:true,profileRevision:true,revision:true,status:true,reviewedBy:true,reviewedAt:true,revokedAt:true}}),
  tx.documentArchive.findMany({where:{kind:'OWNER_COOPERATION'},select:{id:true,ownerId:true,currentApprovedVersionId:true,versions:{select:{id:true,status:true,scopeSnapshot:true,businessSnapshotHash:true}}}}),
  tx.archiveFeedback.findMany({where:{status:'OPEN',version:{archive:{kind:'OWNER_COOPERATION'}}},select:{versionId:true,version:{select:{archiveId:true,scopeSnapshot:true}}}}),
  tx.insurancePolicyVersion.findMany({select:{id:true,policyId:true,version:true,status:true,changeKind:true,effectiveAt:true,startAt:true,endAt:true,vehicleIds:true,fileIds:true,coverageItems:true,requirementVersionIds:true,reviewChecks:true,policyType:true,insuredParty:true,insurerSnapshot:true,policyNumberSnapshot:true,registeredBy:true,registeredAt:true,registrationSnapshot:true,terms:true}}),
  tx.productVersion.findMany({select:{id:true,status:true}}),tx.product.count(),
  tx.order.count({where:{contractMode:'ESIGN'}}),tx.order.count({where:{contractMode:'OFFLINE'}}),tx.contract.count({where:{executionMode:'ESIGN'}})
 ]);
 return auditSevenModuleFacts({vehicles,plans,owners,verifications,identityBindings,archives,feedback,requirements:[],policies,productVersions,counts:{products,legacyEsignOrders,offlineOrders,legacyEsignContracts}},at);
}

export function validateBackfillTarget(env:NodeJS.ProcessEnv):string{
 if(env.NODE_ENV!=='test'||!env.TEST_DATABASE_URL||env.DATABASE_URL!==env.TEST_DATABASE_URL)throw new Error('BACKFILL_ENVIRONMENT: test environment and matching dedicated database variables are required');
 let url:URL;try{url=new URL(env.TEST_DATABASE_URL);}catch{throw new Error('BACKFILL_TARGET: only loopback:55432/chundian_test is allowed');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.port!=='55432'||url.pathname!=='/chundian_test'||url.hash||[...url.searchParams].some(([key,value])=>key!=='schema'||value!=='public'))throw new Error('BACKFILL_TARGET: only loopback:55432/chundian_test is allowed');
 return env.TEST_DATABASE_URL;
}
export function parseBackfillArguments(args:string[]):{apply:boolean}{
 if(!args.includes('--test')||new Set(args).size!==args.length||args.some(arg=>!['--test','--apply'].includes(arg)))throw new Error('BACKFILL_ARGUMENTS: safe runner test preview or test apply only');
 return {apply:args.includes('--apply')};
}
export function assertBackfillRunner(lock:unknown,parentPid:number=process.ppid):void{
 const data=lock as {pid?:unknown;token?:unknown}|null;
 if(!data||data.pid!==parentPid||typeof data.token!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data.token))throw new Error('BACKFILL_RUNNER_REQUIRED: use scripts/run-mvp-api-tests.mjs');
}

/** Constructs its own strictly guarded datasource; never accepts an arbitrary connected database. */
export async function runSevenModuleBackfill(options:{apply?:boolean}={},env:NodeJS.ProcessEnv=process.env){
 const datasourceUrl=validateBackfillTarget(env);
 const {Db}=await import('../common/db');const db=new Db({datasourceUrl});
 try{return await db.serial(async tx=>{
  // Dry-run is enforced by PostgreSQL as well as the absence of application writes.
  if(options.apply)await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ninda-seven-module-backfill-v1'))`;
  else await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  const at=new Date(),before=await inspectSevenModuleMigration(tx,at);
  const result=options.apply?await migrateLegacyProducts(tx):{migrated:0};
  const after=options.apply?await inspectSevenModuleMigration(tx,at):before;
  return {mode:options.apply?'APPLIED':'DRY_RUN',migrated:result.migrated,before,after};
 });}finally{await db.$disconnect();}
}
export async function applySevenModuleMigration(env:NodeJS.ProcessEnv=process.env){return runSevenModuleBackfill({apply:true},env);}

if(require.main===module){
 void(async()=>{
  try{
   const options=parseBackfillArguments(process.argv.slice(2));validateBackfillTarget(process.env);
   let lock:unknown;try{lock=JSON.parse(readFileSync(resolve(__dirname,'../../../..','.runtime/mvp-api-tests.lock'),'utf8'));}catch{lock=null;}
   assertBackfillRunner(lock);
   process.stdout.write(JSON.stringify(await runSevenModuleBackfill(options),null,2)+'\n');
  }catch(error){
   // ORM errors may contain customer values or connection details; CLI exposes only fixed guard codes.
   const message=error instanceof Error?error.message:'';
   process.stderr.write((/^BACKFILL_(ENVIRONMENT|TARGET|ARGUMENTS|RUNNER_REQUIRED|AUDIT_TIME_INVALID)(:|$)/.test(message)?message:'BACKFILL_FAILED: transaction rolled back; inspect through the controlled test environment')+'\n');process.exitCode=1;
  }
 })();
}
