import type {Prisma} from '@prisma/client';

export type RegisteredPartner={id:string;name:string};
export type CooperationRegistration={status:'PENDING_AGREEMENT'|'CONFLICT';owners:RegisteredPartner[]}|null;

/** Admin ledger facts only. These drafts must never be used as effective cooperation or rental eligibility. */
export async function readPartnerRegistrationCandidates(tx:Prisma.TransactionClient,vehicleIds:string[]):Promise<Map<string,RegisteredPartner[]>>{
 const wanted=new Set(vehicleIds),result=new Map<string,RegisteredPartner[]>();
 if(!wanted.size)return result;
 const agreements=await tx.partnerAgreement.findMany({where:{status:'DRAFT'},select:{id:true,ownerId:true,status:true}});
 const drafts=new Map(agreements.filter(row=>row.status==='DRAFT').map(row=>[row.id,row]));
 if(!drafts.size)return result;
 // Fetch the latest version BEFORE checking its status or vehicle set. Filtering either earlier can revive historical associations.
 const versions=await tx.partnerAgreementVersion.findMany({where:{agreementId:{in:[...drafts.keys()]}},
  orderBy:[{agreementId:'asc'},{version:'desc'}],distinct:['agreementId'],
  select:{agreementId:true,ownerId:true,version:true,status:true,vehicleIds:true}});
 const latest=new Map<string,(typeof versions)[number]>();
 for(const row of versions){const previous=latest.get(row.agreementId);if(!previous||row.version>previous.version)latest.set(row.agreementId,row);}
 const ownerIdsByVehicle=new Map<string,Set<string>>(),ownerIds=new Set<string>();
 for(const version of latest.values()){
  const agreement=drafts.get(version.agreementId);
  if(!agreement||agreement.ownerId!==version.ownerId||version.status!=='DRAFT')continue;
  for(const vehicleId of version.vehicleIds){
   if(!wanted.has(vehicleId))continue;
   if(!ownerIdsByVehicle.has(vehicleId))ownerIdsByVehicle.set(vehicleId,new Set());
   ownerIdsByVehicle.get(vehicleId)!.add(agreement.ownerId);ownerIds.add(agreement.ownerId);
  }
 }
 if(!ownerIds.size)return result;
 const owners=await tx.vehicleOwner.findMany({where:{id:{in:[...ownerIds]},status:{not:'SUSPENDED'}},select:{id:true,name:true,status:true}});
 const available=new Map<string,RegisteredPartner>(owners.filter(row=>ownerIds.has(row.id)&&row.status!=='SUSPENDED').map(row=>[row.id,{id:row.id,name:row.name}]));
 for(const [vehicleId,ids] of ownerIdsByVehicle){
  const rows=[...ids].map(id=>available.get(id)).filter((row):row is RegisteredPartner=>!!row).sort((a,b)=>a.id.localeCompare(b.id));
  if(rows.length)result.set(vehicleId,rows);
 }
 return result;
}

export function cooperationRegistration(candidates:RegisteredPartner[],effectiveOwnerId?:string):CooperationRegistration{
 const owners=candidates.filter(owner=>owner.id!==effectiveOwnerId);
 if(!owners.length)return null;
 return{status:effectiveOwnerId||owners.length>1?'CONFLICT':'PENDING_AGREEMENT',owners};
}
