import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {OwnerService} from '../src/owner-signing/owner.service';
import {OwnerAuthorizationService} from '../src/owner-signing/authorization';
import {OwnerSigningTasks} from '../src/owner-signing/tasks';
import {ownerAuthorityFixture} from './owner-authority-fixtures';
let db:Db,tasks:OwnerSigningTasks,authorities:OwnerAuthorizationService;
const error=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
before(async()=>{assert.ok(new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith('_test'));db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});tasks=new OwnerSigningTasks(db,new OwnerService(db));authorities=new OwnerAuthorizationService(db,new OwnerService(db),{} as any);process.env.OWNER_AUTO_SIGNING_ENABLED='true';});
after(async()=>{delete process.env.OWNER_AUTO_SIGNING_ENABLED;await db?.$disconnect();});
async function fixture(){const f=await ownerAuthorityFixture(db),account=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:f.owner.id}});const grant=await db.ownerAutoAuthority.create({data:{ownerId:f.owner.id,sealId:f.seal.id,providerCustomerId:account.providerCustomerId!,providerSignatureId:f.seal.providerSignatureId,certificateSerialNo:account.certSerialNo!,providerContractId:randomUUID(),providerTransactionId:randomUUID(),requestedBy:f.customer.id,idempotencyKey:randomUUID(),requestHash:'synthetic',scope:f.scope,scopeHash:'synthetic',consentSnapshot:{},status:'AUTHORIZED',enabled:true,checkedAt:new Date()}});
 const task=await db.ownerSigningTask.create({data:{ownerId:f.owner.id,customerId:f.customer.id,kind:'SUBSCRIPTION',resourceId:randomUUID(),documentHash:randomUUID(),sourceFileId:'synthetic',sourceSha256:'a'.repeat(64),providerContractId:randomUUID(),ownerSealId:f.seal.id,status:'UPLOADED',uploadedAt:new Date(),reviewedBy:'synthetic-operator',reviewedAt:new Date(),snapshot:{vehicleId:f.vehicle.id,monthlyFeeAmount:100,depositAmount:0,months:12,template:{id:f.scope.templateId,version:f.scope.templateVersion,hash:f.scope.templateHash},lessor:{ownerId:f.owner.id,providerCustomerId:account.providerCustomerId,providerSignatureId:f.seal.providerSignatureId,certificateSerialNo:account.certSerialNo,sealImageHash:f.seal.imageHash}},parties:{create:[{role:'OWNER',providerCustomerId:account.providerCustomerId!,providerSignatureId:f.seal.providerSignatureId,transactionId:randomUUID()},{role:'CUSTOMER',providerCustomerId:'SyntheticCustomer',transactionId:randomUUID(),status:'SIGNED',verifiedAt:new Date(),queryEvidenceHash:'synthetic-evidence'}]}}});return{...f,grant,task};}
test('manual choice wins against a pending auto claim and prevents automatic dispatch',async()=>{
 const f=await fixture();await Promise.allSettled([tasks.claimAuto(f.task.id),tasks.claimManual(f.customer.id,f.owner.id,f.task.id)]);
 const saved=await db.ownerSigningTask.findUniqueOrThrow({where:{id:f.task.id}});assert.equal(saved.ownerMode,'MANUAL');assert.equal(saved.ownerDispatchAt,null);
 await assert.rejects(tasks.beginAuto(f.task.id),error('OWNER_MANUAL_SELECTED'));
});
test('only one concurrent automatic dispatcher owns the persisted transaction',async()=>{
 const f=await fixture();await tasks.claimAuto(f.task.id);const results=await Promise.allSettled([tasks.beginAuto(f.task.id),tasks.beginAuto(f.task.id)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const saved=await db.ownerSigningParty.findUniqueOrThrow({where:{taskId_role:{taskId:f.task.id,role:'OWNER'}}});assert.equal(saved.status,'SUBMITTING');assert.ok(saved.attemptedAt);
 await assert.rejects(tasks.claimManual(f.customer.id,f.owner.id,f.task.id),error('OWNER_ALREADY_DISPATCHED'));
 await assert.rejects(tasks.beginAuto(f.task.id),error('OWNER_ALREADY_DISPATCHED'));
});
test('closing authorization before dispatch blocks it even after the task had selected auto mode',async()=>{
 const f=await fixture();await tasks.claimAuto(f.task.id);await authorities.setEnabled(f.customer.id,f.owner.id,f.grant.id,{enabled:false,revision:0,scopeHash:''});
 await assert.rejects(tasks.beginAuto(f.task.id),error('OWNER_AUTO_NOT_ALLOWED'));assert.equal((await db.ownerSigningTask.findUniqueOrThrow({where:{id:f.task.id}})).ownerDispatchAt,null);
});
test('manual begin and automatic begin cannot both issue a signing request',async()=>{
 const f=await fixture();await tasks.claimAuto(f.task.id);const result=await Promise.allSettled([tasks.beginAuto(f.task.id),tasks.claimManual(f.customer.id,f.owner.id,f.task.id).then(()=>tasks.beginManual(f.customer.id,f.owner.id,f.task.id))]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
 const p=await db.ownerSigningParty.findUniqueOrThrow({where:{taskId_role:{taskId:f.task.id,role:'OWNER'}}});assert.ok(p.attemptedAt);
});
test('suspended members and another owner cannot obtain a manual signing request',async()=>{
 const f=await fixture();await assert.rejects(tasks.claimManual('other',f.owner.id,f.task.id),error('NOT_FOUND'));await db.ownerMember.update({where:{ownerId_customerId:{ownerId:f.owner.id,customerId:f.customer.id}},data:{status:'SUSPENDED'}});await assert.rejects(tasks.claimManual(f.customer.id,f.owner.id,f.task.id),error('NOT_FOUND'));
});
