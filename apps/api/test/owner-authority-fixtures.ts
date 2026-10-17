import {randomUUID} from 'node:crypto';
import {hash} from '../src/common/data';
export async function ownerAuthorityFixture(db:any){
 const seed=randomUUID().replaceAll('-',''),customer=await db.customer.create({data:{mobile:'fixture'+seed}}),owner=await db.vehicleOwner.create({data:{name:'Synthetic owner',creditCode:seed.slice(0,18).toUpperCase(),address:'Synthetic',contactPhone:'13900000000',createdBy:'fixture',status:'VERIFIED'}});
 await db.ownerMember.create({data:{ownerId:owner.id,customerId:customer.id,status:'VERIFIED',verifiedAt:new Date(),verifiedSerialNo:'Verify'+seed}});
 await db.ownerESignAccount.create({data:{ownerId:owner.id,providerCustomerId:'Company'+seed,managerCustomerId:customer.id,verificationTransactionNo:'Verify'+seed,realNameStatus:'VERIFIED',certStatus:'BOUND',certSerialNo:'Cert'+seed,checkedAt:new Date(),verifiedAt:new Date()}});
 const seal=await db.ownerSeal.create({data:{ownerId:owner.id,providerCustomerId:'Company'+seed,providerSignatureId:'Seal'+seed,status:'ACTIVE',imageHash:'a'.repeat(64),imageCiphertext:'synthetic',checkedAt:new Date(),selectedBy:customer.id,selectedAt:new Date()}});
 const vehicle=await db.vehicle.create({data:{brand:'Synthetic',model:'Test',title:'Synthetic owner vehicle',year:2026,city:'上海',mileageKm:100,status:'DRAFT'}});
 await db.ownerVehicle.create({data:{ownerId:owner.id,vehicleId:vehicle.id,status:'APPROVED',evidenceFileId:'synthetic-evidence',createdBy:'fixture',reviewedBy:'reviewer',reviewedAt:new Date()}});
 const docs=[];for(const type of ['terms','privacy','owner-auto-sign','owner-rental-contract']){const version=((await db.legalDocument.aggregate({where:{type},_max:{version:true}}))._max.version||0)+1;docs.push(await db.legalDocument.create({data:{type,version,title:'Synthetic '+type,content:'Synthetic approved '+seed,status:'PUBLISHED',confirmedBy:'fixture',confirmedAt:new Date()}}));}
 const template=docs.find(d=>d.type==='owner-rental-contract'),scope={version:1,vehicleIds:[vehicle.id],templateId:template.id,templateVersion:template.version,templateHash:hash(template.content),validFrom:new Date(Date.now()-3600000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString(),minMonthlyFeeAmount:1,maxMonthlyFeeAmount:500000,minDepositAmount:0,maxDepositAmount:1000000,minMonths:1,maxMonths:12};
 return{customer,owner,seal,vehicle,docs,scope,request:{scope,sealId:seal.id,accepted:true,consents:docs.filter(d=>d.type!=='owner-rental-contract').map(d=>({documentId:d.id,version:d.version})),idempotencyKey:randomUUID()}};
}
