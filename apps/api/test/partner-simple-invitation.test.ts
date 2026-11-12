import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomInt,randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {CompanyAdminService} from '../src/partners/company-admin';
import {OwnerH5AuthController} from '../src/owner-h5/auth.controller';
import {PortalAccessService,portalMobileHash,protectedPortalMobile} from '../src/partners/portal-access';
import {requirePartnerReadAccess,validPartnerScopes} from '../src/partners/portal-session';
import {portalPathPolicy} from '../src/owner-h5/access';
import {OWNER_H5_COOKIE} from '../src/owner-h5/config';
import {currentDocuments} from '../src/auth/consents';
import {tokenHash} from '../src/auth/auth.service';
import {OwnerH5Service} from '../src/owner-h5/service';
import {SimpleAgreementService} from '../src/partners/simple-agreements';
import {SevenModuleViewsController} from '../src/orders/seven-module-views';

let db:any,service:CompanyAdminService,controller:OwnerH5AuthController,operator:any,consents:any[];
const err=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
const phone=()=>`139${randomInt(10000000,99999999)}`;
const testIp='synthetic-'+randomUUID();
const command=(revision:number,extra:any={})=>({revision,idempotencyKey:randomUUID(),...extra});
const request=(cookie?:string,ip=testIp)=>({cookies:cookie?{[OWNER_H5_COOKIE]:cookie}:{},ip,headers:{}});
function response(){const values:any={};return{values,cookie:(name:string,value:string,options:any)=>{values[name]={value,options};}};}
async function owner(){return db.vehicleOwner.create({data:{name:'Synthetic invitation '+randomUUID(),address:'',createdBy:operator.id}});}
async function invitation(mobile=phone()) {const company=await owner();return{company,mobile,...await service.invite(operator,company.id,command(0,{mobile}))};}
async function preview(invite:any,ip=testIp){return controller.invitationPreview({mobile:invite.mobile,invitationCode:invite.invitationCode},request(undefined,ip));}
async function confirm(previewToken:string,cookie?:string){const res=response();const dto=await controller.invitationConfirm({previewToken,consents},request(cookie),res);return{dto,rawToken:res.values[OWNER_H5_COOKIE].value,options:res.values[OWNER_H5_COOKIE].options};}
async function session(rawToken:string){return db.partnerPortalSession.findUnique({where:{id:tokenHash(rawToken)}});}

before(async()=>{
 assert.ok(process.env.TEST_DATABASE_URL&&new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test'));
 process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.SESSION_SECRET='synthetic-simple-invitation-secret-12345678901234567890';
 db=new Db();service=new CompanyAdminService(db);
 const challenges=new Map<string,string>();
 controller=new OwnerH5AuthController(db,{
  requestSmsChallenge:async(mobile:string)=>{const challengeId=randomUUID();challenges.set(challengeId,mobile);return{challengeId};},
  verifySmsChallenge:async(input:any)=>{assert.equal(challenges.get(input.challengeId),input.mobile);assert.equal(input.code,'123456');return{mobile:input.mobile};}
 } as any);
 operator=await db.adminUser.create({data:{username:'simple-invite-'+randomUUID(),name:'Synthetic operator',passwordHash:'unused',role:'OPERATIONS',partnerCapabilities:[]}});
 for(const type of ['terms','privacy'])if(!await db.legalDocument.findFirst({where:{type,status:'PUBLISHED',confirmedAt:{not:null}}}))await db.legalDocument.create({data:{type,version:1,title:'Synthetic legal',content:'Synthetic only',status:'PUBLISHED',confirmedBy:operator.id,confirmedAt:new Date()}});
 consents=(await currentDocuments(db,['terms','privacy'])).map(d=>({documentId:d.id,version:d.version}));
});
after(async()=>{await db?.$disconnect();});

test('direct operator invitation is pending, seven days, hashed, and replay never reveals plaintext',async()=>{
 const company=await owner(),mobile=phone(),input=command(0,{mobile}),issued=await service.invite(operator,company.id,input);
 assert.equal(issued.status,'PENDING');assert.match(issued.invitationCode!,/^[A-Za-z0-9_-]{24}$/);
 assert.ok(Math.abs(new Date(issued.invitation!.expiresAt).getTime()-Date.now()-7*86400000)<5000);
 assert.equal(await db.customer.count({where:{mobile}}),0);
 const stored=await db.partnerPortalInvitation.findUnique({where:{id:issued.invitation!.id}}),access=await db.partnerPortalAccess.findUnique({where:{ownerId:company.id}});
 assert.equal(access.status,'PENDING');assert.equal(access.reviewedBy,null);assert.equal(access.reviewedAt,null);assert.notEqual(stored.codeHash,issued.invitationCode);
 const replay=await service.invite(operator,company.id,input);assert.equal(replay.invitationCode,undefined);assert.equal(replay.requiresRegeneration,true);assert.equal(replay.invitation!.id,issued.invitation!.id);
 assert.equal(await db.partnerPortalInvitation.count({where:{accessId:access.id,status:'PENDING'}}),1);
 const records=await db.archiveCommand.findMany({where:{actorId:operator.id,resourceId:`partner-company-admin:${company.id}`}}),logs=await db.auditLog.findMany({where:{resourceId:company.id}});
 assert.equal(JSON.stringify([stored,access,records,logs]).includes(issued.invitationCode!),false);assert.equal(JSON.stringify([stored,access,records,logs]).includes(mobile),false);
 await assert.rejects(service.invite(operator,company.id,{...input,mobile:phone()}),err('IDEMPOTENCY_CONFLICT'));
 await assert.rejects(service.invite(operator,company.id,command(0,{mobile})),err('REVISION_CONFLICT'));
});

test('only the designated phone can preview and expired invitation or preview cannot bind',async()=>{
 const invite=await invitation();
 await assert.rejects(controller.invitationPreview({mobile:phone(),invitationCode:invite.invitationCode},request()),err('INVITATION_UNAVAILABLE'));
 const view=await preview(invite);assert.equal(view.ownerId,invite.company.id);assert.equal(view.companyName,invite.company.name);assert.equal(view.maskedMobile,invite.mobile.slice(0,3)+'****'+invite.mobile.slice(-4));
 assert.deepEqual(Object.keys(view).sort(),['companyName','expiresAt','maskedMobile','ownerId','previewToken']);
 await db.partnerPortalInvitation.update({where:{id:invite.invitation.id},data:{previewExpiresAt:new Date(Date.now()-1)}});
 await assert.rejects(confirm(view.previewToken),err('INVITATION_UNAVAILABLE'));
 await db.partnerPortalInvitation.update({where:{id:invite.invitation.id},data:{expiresAt:new Date(Date.now()-1)}});
 await assert.rejects(preview(invite),err('INVITATION_UNAVAILABLE'));
});

test('confirmation is atomic, one use, requires current consents, and creates independent readonly session',async()=>{
 const invite=await invitation(),view=await preview(invite);
 await assert.rejects(controller.invitationConfirm({previewToken:view.previewToken,consents:[]},request(),response()),err('CONSENT_VERSION'));
 const outcomes=await Promise.allSettled([confirm(view.previewToken),confirm(view.previewToken)]);
 assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(outcomes.filter(o=>o.status==='rejected').length,1);
 const accepted=(outcomes.find(o=>o.status==='fulfilled') as PromiseFulfilledResult<any>).value;
 assert.equal(accepted.dto.mode,'PARTNER_READONLY');assert.deepEqual(accepted.dto.scopes.map((s:any)=>s.ownerId),[invite.company.id]);assert.equal(accepted.options.httpOnly,true);
 const access=await db.partnerPortalAccess.findUnique({where:{ownerId:invite.company.id}});
 assert.equal(access.status,'ENABLED');assert.equal(access.bindingMethod,'INVITATION');assert.equal(access.boundInvitationId,invite.invitation.id);assert.ok(access.boundAt);assert.equal(access.reviewedBy,null);assert.equal(access.reviewedAt,null);
 await requirePartnerReadAccess(db,await session(accepted.rawToken),invite.company.id);
 await assert.rejects(confirm(view.previewToken),err('INVITATION_ALREADY_BOUND'));
 assert.equal(await db.partnerPortalSession.count({where:{mobileHash:portalMobileHash(invite.mobile)}}),1);
});

test('regeneration invalidates old code and preview while response loss can explicitly regenerate',async()=>{
 const invite=await invitation(),view=await preview(invite),next=await service.invite(operator,invite.company.id,command(invite.revision,{mobile:invite.mobile}));
 assert.notEqual(next.invitationCode,invite.invitationCode);
 await assert.rejects(preview(invite),err('INVITATION_UNAVAILABLE'));await assert.rejects(confirm(view.previewToken),err('INVITATION_UNAVAILABLE'));
 assert.equal((await db.partnerPortalInvitation.findUnique({where:{id:invite.invitation.id}})).status,'REVOKED');
 const accepted=await confirm((await preview({...invite,...next})).previewToken);await requirePartnerReadAccess(db,await session(accepted.rawToken),invite.company.id);
});

test('same phone accepts each company separately and a code never authenticates unrelated enabled grants',async()=>{
 const mobile=phone(),first=await invitation(mobile),second=await invitation(mobile);
 const firstLogin=await confirm((await preview(first)).previewToken);assert.deepEqual(firstLogin.dto.scopes.map((s:any)=>s.ownerId),[first.company.id]);
 const secondLogin=await confirm((await preview(second)).previewToken);assert.deepEqual(secondLogin.dto.scopes.map((s:any)=>s.ownerId),[second.company.id]);
 const third=await invitation(mobile),thirdLogin=await confirm((await preview(third)).previewToken,secondLogin.rawToken);
 assert.deepEqual(thirdLogin.dto.scopes.map((s:any)=>s.ownerId).sort(),[second.company.id,third.company.id].sort());
 await requirePartnerReadAccess(db,await session(firstLogin.rawToken),first.company.id);
 const sms=await controller.sms({mobile}),res=response();const login=await controller.login({mobile,challengeId:sms.challengeId,code:'123456',consents},request(),res);
 assert.deepEqual(login.scopes.map((s:any)=>s.ownerId).sort(),[first.company.id,second.company.id,third.company.id].sort());
});

test('changing number immediately revokes only that company and old SMS challenge cannot restore it',async()=>{
 const mobile=phone(),first=await invitation(mobile),second=await invitation(mobile),a=await confirm((await preview(first)).previewToken),b=await confirm((await preview(second)).previewToken,a.rawToken),oldSession=await session(b.rawToken);
 const challenge=await controller.sms({mobile}),current=await service.get(operator,first.company.id);
 await service.invite(operator,first.company.id,command(current.revision,{mobile:phone()}));
 await assert.rejects(requirePartnerReadAccess(db,oldSession,first.company.id),err('PARTNER_ACCESS_DENIED'));
 await requirePartnerReadAccess(db,oldSession,second.company.id);
 await assert.rejects(controller.login({mobile,challengeId:challenge.challengeId,code:'123456',consents},request(),response()),err('LOGIN_UNAVAILABLE'));
 assert.deepEqual((await validPartnerScopes(db,oldSession)).map((s:any)=>s.ownerId),[second.company.id]);
});

test('disable invalidates a bound session and an outstanding invitation without changing other companies',async()=>{
 const invite=await invitation(),view=await preview(invite),bound=await confirm(view.previewToken),current=await service.get(operator,invite.company.id);
 const disabled=await service.disable(operator,invite.company.id,command(current.revision));assert.equal(disabled.status,'DISABLED');
 await assert.rejects(requirePartnerReadAccess(db,await session(bound.rawToken),invite.company.id),err('PARTNER_ACCESS_DENIED'));
 const pending=await service.invite(operator,invite.company.id,command(disabled.revision,{mobile:invite.mobile})),pendingView=await preview({...invite,...pending});
 await service.disable(operator,invite.company.id,command(pending.revision));await assert.rejects(confirm(pendingView.previewToken),err('INVITATION_UNAVAILABLE'));
});

test('preview failures remain counted and repeated guesses cannot eventually redeem the correct code',async()=>{
 const invite=await invitation(),ip='synthetic-'+randomUUID(),wrongCode=randomBytes(18).toString('base64url');
 for(let n=0;n<10;n++)await assert.rejects(controller.invitationPreview({mobile:invite.mobile,invitationCode:wrongCode},request(undefined,ip)),err('INVITATION_UNAVAILABLE'));
 await assert.rejects(preview(invite,ip),err('INVITATION_RATE_LIMITED'));
 assert.equal((await db.partnerPortalAccess.findUnique({where:{ownerId:invite.company.id}})).status,'PENDING');
});

test('company projections expose current shared agreement and assigned vehicle facts while hiding draft and internal fields',async()=>{
 const invite=await invitation(),bound=await confirm((await preview(invite)).previewToken),viewer=await session(bound.rawToken),portal=new OwnerH5Service(db,{} as any,{} as any,{} as any,{} as any),agreements=new SimpleAgreementService();
 const file=await db.storedFile.create({data:{adminId:operator.id,name:'已登记协议.pdf',mimeType:'application/pdf',size:10,sha256:'c'.repeat(64),storagePath:'private-test-path',purpose:'contract'}});
 const vehicle=await db.vehicle.create({data:{brand:'合成',model:'测试车型',title:'合成车辆',year:2026,city:'上海',mileageKm:0,plateNumber:'合成'+randomUUID().slice(0,5),status:'IN_USE'}});
 const saved=await db.serial((tx:any)=>agreements.save(tx,operator,invite.company.id,command(0,{status:'ACTIVE',title:'当前协议',fileIds:[file.id],vehicleIds:[vehicle.id],partnerRateBps:0,notes:'INTERNAL SECRET'})));
 const draftFile=await db.storedFile.create({data:{adminId:operator.id,name:'未共享草稿.pdf',mimeType:'application/pdf',size:10,sha256:'d'.repeat(64),storagePath:'private-draft-path',purpose:'contract'}});
 await db.serial((tx:any)=>agreements.save(tx,operator,invite.company.id,command(saved.revision,{agreementId:saved.id,status:'DRAFT',title:'未生效标题',fileIds:[draftFile.id],vehicleIds:[vehicle.id],partnerRateBps:8000,notes:'INTERNAL DRAFT'})));
 const detail=await portal.portalDetail(viewer,invite.company.id);assert.equal(detail.companyAdmin.status,'BOUND');assert.equal(detail.cooperationMode,'SIMPLE');assert.equal(detail.vehicleCount,1);
 const shared=await portal.portalAgreements(viewer,invite.company.id);assert.equal(shared.items.length,1);assert.equal(shared.items[0].title,'当前协议');assert.equal(shared.items[0].partnerRateBps,0);assert.deepEqual(shared.items[0].files.map((f:any)=>f.id),[file.id]);
 const vehicles=await portal.portalVehicles(viewer,invite.company.id,{});assert.equal(vehicles.items.length,1);assert.equal(vehicles.items[0].status,'IN_USE');assert.equal(vehicles.items[0].agreementId,saved.id);assert.equal(vehicles.items[0].partnerRateBps,0);
 const safe=JSON.stringify([detail,shared,vehicles]);for(const secret of ['INTERNAL','private-test-path','未生效标题','customerId','reviewedBy'])assert.equal(safe.includes(secret),false);
 assert.equal((await portal.portalAgreementFile(viewer,invite.company.id,saved.id,file.id)).id,file.id);
 await assert.rejects(portal.portalAgreementFile(viewer,invite.company.id,saved.id,draftFile.id),err('NOT_FOUND'));
 const foreign=await owner();await assert.rejects(portal.portalVehicles(viewer,foreign.id,{}),err('PARTNER_ACCESS_DENIED'));
 await assert.rejects(portal.portalVehicles(viewer,invite.company.id,{agreementId:'foreign-agreement'}),err('NOT_FOUND'));
 assert.equal((await portal.portalVehicles(viewer,invite.company.id,{status:'PUBLISHED'})).total,0);
});

test('legacy reviewed grants remain usable and simple operations reject revoked or unrelated staff',async()=>{
 const company=await owner(),mobile=phone(),grant=await db.partnerPortalAccess.create({data:{ownerId:company.id,mobileHash:portalMobileHash(mobile),maskedMobile:'139****0000',status:'ENABLED',accessVersion:1,reviewedBy:operator.id,reviewedAt:new Date()}});
 const legacy=await db.partnerPortalSession.create({data:{id:randomUUID(),mode:'PARTNER_READONLY',mobileHash:grant.mobileHash,maskedMobile:grant.maskedMobile,csrfToken:randomUUID(),consentSnapshot:[],scopeSnapshot:[{accessId:grant.id,ownerId:company.id,accessVersion:1}],expiresAt:new Date(Date.now()+60000)}});
 await requirePartnerReadAccess(db,legacy,company.id);assert.equal((await service.get(operator,company.id)).status,'BOUND');
 const support=await db.adminUser.create({data:{username:randomUUID(),name:'Support',passwordHash:'unused',role:'SUPPORT'}});
 await assert.rejects(service.invite(support,company.id,command(0,{mobile})),err('FORBIDDEN'));
 await assert.rejects(service.invite({...operator,authVersion:operator.authVersion+1},company.id,command(0,{mobile})),err('STAFF_SESSION_CHANGED'));
});

test('old submitted candidates cannot enable access after an invitation or disable using a refreshed revision',async()=>{
 const company=await owner(),mobile=phone();
 const writer=await db.adminUser.create({data:{username:randomUUID(),name:'Legacy writer',passwordHash:'unused',role:'OPERATIONS',staffPersonId:randomUUID(),partnerCapabilities:['partner.portal.write']}}),reviewer=await db.adminUser.create({data:{username:randomUUID(),name:'Legacy reviewer',passwordHash:'unused',role:'OPERATIONS',staffPersonId:randomUUID(),partnerCapabilities:['partner.portal.review']}});
 const legacy=new PortalAccessService(db);let old=await legacy.save(writer,company.id,command(0,{displayName:'Legacy candidate',mobile,reason:'Synthetic old workflow'}));old=await legacy.submit(writer,company.id,command(old.revision,{candidateId:old.candidate.id}));
 let invited=await service.invite(operator,company.id,command(old.revision,{mobile}));
 await assert.rejects(legacy.review(reviewer,company.id,command(invited.revision,{candidateId:old.candidate.id,decision:'APPROVE',reason:'Stale candidate must not bind'})),err('PARTNER_PORTAL_LEGACY_READONLY'));
 assert.notEqual((await db.partnerPortalAccess.findUnique({where:{ownerId:company.id}})).status,'ENABLED');
 invited=await service.disable(operator,company.id,command(invited.revision));
 await assert.rejects(legacy.review(reviewer,company.id,command(invited.revision,{candidateId:old.candidate.id,decision:'APPROVE',reason:'Cannot resurrect disabled access'})),err('PARTNER_PORTAL_LEGACY_READONLY'));
 await assert.rejects(legacy.save(writer,company.id,command(invited.revision,{displayName:'Legacy override',mobile,reason:'Must use invitation'})),err('PARTNER_PORTAL_LEGACY_READONLY'));
 assert.equal((await db.partnerPortalAccess.findUnique({where:{ownerId:company.id}})).status,'DISABLED');
});

test('only exact invitation authentication routes are writable; company business mutations remain denied',()=>{
 for(const path of ['/owner-h5/auth/invitation/preview','/owner-h5/auth/invitation/confirm'])assert.equal(portalPathPolicy('POST',path),'AUTH');
 assert.equal(portalPathPolicy('POST','/owner-h5/auth/invitation/confirm/other'),'UNKNOWN');assert.equal(portalPathPolicy('PUT','/owner-h5/auth/invitation/confirm'),'UNKNOWN');
 assert.equal(portalPathPolicy('POST','/owner-h5/owners/company/verification'),'DENY_WRITE');assert.equal(portalPathPolicy('POST','/owner-h5/owners/company/contracts/task/sign'),'DENY_WRITE');
});

test('legacy vehicle and policy reads exclude every simple assignment marker, including transfer and stopped markers',async()=>{
 const invite=await invitation(),bound=await confirm((await preview(invite)).previewToken),viewer=await session(bound.rawToken),other=await owner(),views=new SevenModuleViewsController(db);
 const cars=[];for(let i=0;i<3;i++){const vehicle=await db.vehicle.create({data:{brand:'Synthetic',model:'Private current state',title:'Legacy vehicle '+i,year:2026,city:'上海',mileageKm:0,status:'IN_USE'}});cars.push(vehicle);await db.ownerVehicle.create({data:{ownerId:invite.company.id,vehicleId:vehicle.id,status:'APPROVED',evidenceFileId:'synthetic-evidence',createdBy:operator.id,reviewedBy:operator.id,reviewedAt:new Date()}});}
 for(const vehicle of cars.slice(0,2))await db.partnerAgreementVehicle.create({data:{vehicleId:vehicle.id,ownerId:other.id,agreementId:'stopped-or-transferred',agreementVersionId:'historical-marker',assignedBy:operator.id}});
 const result=await views.ownerVehicles(invite.company.id,{}, {partnerPortalSession:viewer});assert.deepEqual(result.items.map((item:any)=>item.id),[cars[2].id]);assert.equal(result.total,1);
 assert.equal((await views.ownerVehicles(invite.company.id,{vehicleId:cars[0].id},{partnerPortalSession:viewer})).total,0);
 await assert.rejects(views.ownerPolicies(invite.company.id,{vehicleId:cars[0].id},{partnerPortalSession:viewer}),err('NOT_FOUND'));
 const policy=await db.insurancePolicy.create({data:{insurer:'Synthetic insurer',policyNumber:randomUUID(),createdBy:operator.id,versions:{create:{version:1,status:'APPROVED',effectiveAt:new Date('2026-01-01'),startAt:new Date('2026-01-01'),endAt:new Date('2099-01-01'),policyholder:'Synthetic holder',insuredParty:'Synthetic insured',vehicleIds:cars.map(car=>car.id),coverageItems:[],terms:'Synthetic',fileIds:[],requirementVersionIds:[],createdBy:operator.id}}}});
 const policies=await views.ownerPolicies(invite.company.id,{}, {partnerPortalSession:viewer});assert.deepEqual(policies.items.find((item:any)=>item.policyId===policy.id)?.vehicleIds,[cars[2].id]);
});
