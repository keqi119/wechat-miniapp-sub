import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomInt,randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {PortalAccessService,portalMobileHash} from '../src/partners/portal-access';
import {requirePartnerReadAccess,validPartnerScopes} from '../src/partners/portal-session';

let db:any,service:PortalAccessService,writer:any,reviewer:any,owner:any;
const secret='synthetic-portal-test-secret-12345678901234567890';
const originalMobile=`139${randomInt(10000000,99999999)}`;
const err=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
before(async()=>{
 assert.ok(process.env.TEST_DATABASE_URL&&new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test'));
 process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.SESSION_SECRET=secret;db=new Db();service=new PortalAccessService(db);
 const capabilities=['partner.portal.read','partner.portal.write','partner.portal.review','partner.portal.disable'];
 for(const name of ['writer','reviewer']){const staffPersonId='synthetic-'+randomUUID();const user=await db.adminUser.create({data:{username:'portal-'+randomUUID(),name,passwordHash:'unused',role:'OPERATIONS',staffPersonId,partnerCapabilities:capabilities}});if(name==='writer')writer=user;else reviewer=user;}
 owner=await db.vehicleOwner.create({data:{name:'Portal synthetic '+randomUUID(),address:'Synthetic only',createdBy:writer.id}});
});
after(async()=>{await db?.$disconnect();});
const command=(revision:number,extra:any={})=>({revision,idempotencyKey:randomUUID(),...extra});
test('candidate save and submit never grant access; unregistered mobile independently approved without changing business revision',async()=>{
 const before=await db.vehicleOwner.findUnique({where:{id:owner.id}}),mobile=originalMobile;
 const saved=await service.save(writer,owner.id,command(0,{displayName:'查看人员',mobile,reason:'合成授权'}));
 assert.equal(saved.current,null);assert.equal(saved.candidate.status,'DRAFT');assert.equal(JSON.stringify(saved).includes(mobile),false);
 const submitted=await service.submit(writer,owner.id,command(saved.revision,{candidateId:saved.candidate.id}));
 assert.equal(await db.partnerPortalAccess.count({where:{ownerId:owner.id,mobileHash:portalMobileHash(mobile),status:'ENABLED'}}),0);
 await assert.rejects(service.review(writer,owner.id,command(submitted.revision,{candidateId:saved.candidate.id,decision:'APPROVE',reason:'本人不得复核'})),err('PARTNER_SELF_REVIEW'));
 const approved=await service.review(reviewer,owner.id,command(submitted.revision,{candidateId:saved.candidate.id,decision:'APPROVE',reason:'独立核对'}));
 assert.equal(approved.current.accessVersion,1);assert.equal(approved.current.status,'ENABLED');assert.equal(approved.candidate,null);
 assert.equal(await db.customer.count({where:{mobile}}),0);assert.equal((await db.vehicleOwner.findUnique({where:{id:owner.id}})).revision,before.revision);
});
test('scope versions survive candidate preparation, revoke immediately, and do not resurrect when mobile changes back',async()=>{
 let dto=await service.get(writer,owner.id);const access=await db.partnerPortalAccess.findUnique({where:{ownerId:owner.id}});
 const session:any=await db.partnerPortalSession.create({data:{id:randomUUID(),mode:'PARTNER_READONLY',mobileHash:access.mobileHash,maskedMobile:access.maskedMobile,csrfToken:randomUUID(),consentSnapshot:[],scopeSnapshot:[{accessId:access.id,ownerId:owner.id,accessVersion:access.accessVersion}],expiresAt:new Date(Date.now()+100000)}});
 await requirePartnerReadAccess(db,session,owner.id);
 dto=await service.save(writer,owner.id,command(dto.revision,{displayName:'新人员',mobile:'13920002222',reason:'准备换号'}));
 await requirePartnerReadAccess(db,session,owner.id);
 dto=await service.disable(writer,owner.id,command(dto.revision,{reason:'立即撤权'}));
 await assert.rejects(requirePartnerReadAccess(db,session,owner.id),err('PARTNER_ACCESS_DENIED'));assert.equal((await validPartnerScopes(db,session)).length,0);
 dto=await service.submit(writer,owner.id,command(dto.revision,{candidateId:dto.candidate.id}));
 dto=await service.review(reviewer,owner.id,command(dto.revision,{candidateId:dto.candidate.id,decision:'APPROVE',reason:'新号启用'}));
 dto=await service.save(writer,owner.id,command(dto.revision,{displayName:'原人员',mobile:originalMobile,reason:'改回原号'}));
 dto=await service.submit(writer,owner.id,command(dto.revision,{candidateId:dto.candidate.id}));
 dto=await service.review(reviewer,owner.id,command(dto.revision,{candidateId:dto.candidate.id,decision:'APPROVE',reason:'独立核对原号'}));
 assert.equal(dto.current.accessVersion,4);await assert.rejects(requirePartnerReadAccess(db,session,owner.id),err('PARTNER_ACCESS_DENIED'));
});
test('candidate commands enforce exact revision/idempotency and actual-person review across accounts and editors',async()=>{
 const subject=await db.vehicleOwner.create({data:{name:'Candidate controls '+randomUUID(),address:'Synthetic',createdBy:writer.id}});
 const request=command(0,{displayName:'候选',mobile:'13920003333',reason:'合成'}),saved=await service.save(writer,subject.id,request);
 assert.deepEqual(await service.save(writer,subject.id,request),JSON.parse(JSON.stringify(saved)));
 await assert.rejects(service.save(writer,subject.id,{...request,mobile:'13920004444'}),err('IDEMPOTENCY_CONFLICT'));
 await assert.rejects(service.save(writer,subject.id,command(0,{displayName:'过期',mobile:'13920004444',reason:'过期'})),err('REVISION_CONFLICT'));
 const alias=await db.adminUser.create({data:{username:'portal-alias-'+randomUUID(),name:'Alias',passwordHash:'unused',role:'OPERATIONS',staffPersonId:writer.staffPersonId,partnerCapabilities:['partner.portal.review']}});
 let dto=await service.submit(writer,subject.id,command(saved.revision,{candidateId:saved.candidate.id}));
 await assert.rejects(service.review(alias,subject.id,command(dto.revision,{candidateId:saved.candidate.id,decision:'APPROVE',reason:'同人双号'})),err('PARTNER_SELF_REVIEW'));
 await assert.rejects(service.save(writer,subject.id,command(dto.revision,{displayName:'已提交编辑',mobile:'13920004444',reason:'不可改'})),err('PORTAL_CANDIDATE_FROZEN'));
 dto=await service.review(reviewer,subject.id,command(dto.revision,{candidateId:saved.candidate.id,decision:'REJECT',reason:'退回'}));assert.equal(dto.current,null);assert.equal(dto.candidate.status,'REJECTED');
 const readOnly=await db.adminUser.create({data:{username:'portal-reader-'+randomUUID(),name:'Reader',passwordHash:'unused',role:'OPERATIONS',staffPersonId:randomUUID(),partnerCapabilities:['partner.portal.read']}});
 await assert.rejects(service.save(readOnly,subject.id,command(dto.revision,{displayName:'不可写',mobile:'13920004444',reason:'不可写'})),err('FORBIDDEN'));
});


test('ADMIN ordinary portal self review needs no extra capability and preserves audit, replay and stale-session guards',async()=>{
 const admin=await db.adminUser.create({data:{username:'admin-ordinary-'+randomUUID(),name:'合成管理员',passwordHash:'unused',role:'ADMIN',staffPersonId:'person-'+randomUUID(),partnerCapabilities:[]}});
 const partner=await db.vehicleOwner.create({data:{name:'合成普通资料自审'+randomUUID(),address:'Synthetic only',createdBy:admin.id}});
 await service.save(admin,partner.id,{revision:0,idempotencyKey:'admin-portal-save',displayName:'合成查看人',mobile:`138${randomInt(10000000,99999999)}`,reason:'合成资料审核'});
 let view=await service.get(admin,partner.id);await service.submit(admin,partner.id,{revision:view.revision,idempotencyKey:'admin-portal-submit',candidateId:view.candidate.id});
 view=await service.get(admin,partner.id);const input={revision:view.revision,idempotencyKey:'admin-portal-review',candidateId:view.candidate.id,decision:'APPROVE',reason:'已核对合成原件'};
 const result=await service.review(admin,partner.id,input);assert.equal((await service.get(admin,partner.id)).current.reviewedBy,admin.id);assert.deepEqual(await service.review(admin,partner.id,input),result);
 assert.equal(await db.auditLog.count({where:{actorId:admin.id,action:'PARTNER_PORTAL_REVIEW'}}),1);
 await db.adminUser.update({where:{id:admin.id},data:{authVersion:{increment:1}}});await assert.rejects(service.get(admin,partner.id),err('STAFF_SESSION_CHANGED'));
});
