import assert from 'node:assert/strict';
import {trustedProfileFixture} from './customer-profile-fixture';
import {randomInt,randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {Db} from '../src/common/db';
import {projectRoot} from '../src/common/config';
import {createApp} from '../src/app';
import {tokenHash} from '../src/auth/auth.service';
import {listenForHttpTests} from './http-listener';
import {PaymentGateway} from '../src/common/gateways';
import {Role} from '@prisma/client';
import {RealIdentityGateway} from '../src/integrations/identity';
import {partnerCapabilities} from '../src/partners/capabilities';

export const command=(revision=0)=>({revision,idempotencyKey:randomUUID()});
export const approval=(revision:number)=>({...command(revision),decision:'APPROVE',reason:'仅本地合成材料，另一员工独立核对'});
export type Login={id:string;headers:Record<string,string>;role?:string};

/** Only the provider boundary is substituted. All money rows are produced by BillingService. */
export class LocalVerifiedPayment extends PaymentGateway {
 readonly payments=new Map<string,any>();readonly refunds=new Map<string,any>();providerCalls=0;
 async create(input:any){this.providerCalls++;this.payments.set(input.paymentId,{status:'PENDING',amount:input.amount});return{timeStamp:String(Math.floor(Date.now()/1000)),nonceStr:'synthetic-local-only',package:`prepay_id=synthetic-${input.paymentId}`,signType:'RSA',paySign:'SYNTHETIC_NOT_A_WECHAT_SIGNATURE'};}
 capture(id:string){const event=this.payments.get(id);assert.ok(event,'Only locally requested payments may be captured');this.payments.set(id,{...event,status:'SUCCEEDED',transactionId:`synthetic-verified-${id}`});}
 async query(id:string){this.providerCalls++;assert.ok(this.payments.has(id));return this.payments.get(id);}
 async close(id:string){const event=await this.query(id);this.payments.set(id,{...event,status:'CLOSED'});}
 async refund(input:any){this.providerCalls++;assert.equal((await this.query(input.paymentId)).status,'SUCCEEDED');const result={status:'SUCCEEDED' as const,providerRefundId:`synthetic-refund-${input.refundId}`};this.refunds.set(input.refundId,{...result,paymentId:input.paymentId,amount:input.amount,totalAmount:input.totalAmount});return result;}
 async queryRefund(id:string){this.providerCalls++;assert.ok(this.refunds.has(id));return this.refunds.get(id);}
}

export class JourneyHarness {
 readonly db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});
 readonly payment=new LocalVerifiedPayment();readonly docs:Record<string,any>={};
 readonly prefix=randomUUID();readonly origin='https://journey.example.test';
 app:any;base='';externalCalls=0;esignCalls=0;identityCalls=0;preparedPdfs=0;readonly databaseErrors:{code:string;databaseCode?:string}[]=[];
 maker!:Login;reviewer!:Login;finance!:Login;support!:Login;field!:Login;partnerReviewer!:Login;samePersonAlias!:Login;
 readonly smsCodes=new Map<string,string>();syntheticSmsSends=0;realSmsSends=0;
 private saved=new Map<string,string|undefined>();private fetchBefore=globalThis.fetch;
 async start(){
  const target=new URL(process.env.TEST_DATABASE_URL||'http://invalid');
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(target.hostname)&&target.port==='55432'&&target.pathname==='/chundian_test','Journey requires loopback:55432/chundian_test');
  const serial=this.db.serial.bind(this.db);
  this.db.serial=(async(operation:any)=>{try{return await serial(operation);}catch(error:any){if(error?.code)this.databaseErrors.push({code:error.code,databaseCode:error.meta?.code});throw error;}}) as typeof this.db.serial;
  // Preserve credentials only in memory for finally; never expose their values.
  for(const key of Object.keys(process.env).filter(k=>k.startsWith('FADADA_')||k==='ESIGN_IDENTITY_ENCRYPTION_KEY')){this.saved.set(key,process.env[key]);delete process.env[key];}
  const font=[process.env.CONTRACT_CJK_FONT_PATH,resolve(projectRoot,'.runtime/delivery-delay-pdf-qa/fonts/NotoSansCJK-Regular.ttc'),'C:/Windows/Fonts/simhei.ttf','/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttf'].find((path):path is string=>!!path&&existsSync(path));
  assert.ok(font,'A local CJK font is required for the synthetic archive PDF acceptance');
  for(const [key,value] of Object.entries({DATABASE_URL:process.env.TEST_DATABASE_URL!,ADMIN_ORIGIN:this.origin,H5_SIGNING_ORIGIN:this.origin,CONTRACT_CJK_FONT_PATH:font,NEW_ORDER_CONTRACT_MODE:'OFFLINE',MVP_V2_ENABLED:'true',OWNER_LEGAL_H5_ENABLED:'true',PORTAL_SMS_ENABLED:'true',SESSION_SECRET:'synthetic-local-n11-session-secret-never-for-production',ALIYUN_SMS_ACCESS_KEY_ID:'synthetic-disabled',ALIYUN_SMS_ACCESS_KEY_SECRET:'synthetic-disabled',ALIYUN_SMS_SIGN_NAME:'synthetic-disabled',ALIYUN_SMS_LOGIN_TEMPLATE_CODE:'synthetic-disabled',ESIGN_NEW_REQUESTS_ENABLED:'false',FADADA_ENABLED:'false',WECHAT_PAY_ENABLED:'false'})){if(!this.saved.has(key))this.saved.set(key,process.env[key]);process.env[key]=value;}
  [this.maker,this.reviewer,this.finance,this.support,this.field]=await Promise.all((['OPERATIONS','ADMIN','FINANCE','SUPPORT','FIELD'] as const).map(role=>this.staff(role)));
  this.partnerReviewer=await this.staff('OPERATIONS','partner-reviewer');this.samePersonAlias=await this.staff('OPERATIONS','maker-alias',`person-OPERATIONS-${this.prefix}`);
  for(const type of ['terms','privacy','application','usage-policy','credit-verification','owner-data-sharing','OFFLINE_OWNER_COOPERATION','OFFLINE_RENTAL','OFFLINE_DELIVERY_RECEIPT','OFFLINE_RETURN_RECEIPT','OFFLINE_TERMINATION']){
   const max=await this.db.legalDocument.aggregate({where:{type},_max:{version:true}});
   this.docs[type]=await this.db.legalDocument.create({data:{type,version:(max._max.version||0)+1,title:`N11合成 ${type}`,content:type==='owner-data-sharing'?'向本单实际出租方 {{lessorName}} 提供本订单必要资料':'本地合成已确认文案；本资料不得用于真实交易或签章。',status:'PUBLISHED',confirmedBy:this.reviewer.id,confirmedAt:new Date()}});
  }
  const denied=async()=>{this.identityCalls++;throw new Error('External identity/SMS disabled in N11');};
  const identity=new RealIdentityGateway(this.db,{appId:'synthetic-unused',secret:'synthetic-unused',smsEnabled:true,smsHashSecret:process.env.SESSION_SECRET!},denied,async(mobile,code)=>{this.syntheticSmsSends++;this.smsCodes.set(mobile,code);});
  const esignDenied=async()=>{this.esignCalls++;throw new Error('ESIGN forbidden for N11 OFFLINE journey');};
  this.app=await createApp({db:this.db,payment:this.payment,identity,esign:{create:esignDenied,query:esignDenied}});
  this.base=await listenForHttpTests(this.app);
  globalThis.fetch=(async(input:any,init:any)=>{const url=new URL(typeof input==='string'?input:input.url||String(input));if(url.origin!==new URL(this.base).origin){this.externalCalls++;throw new Error('N11 external HTTP request prohibited');}return this.fetchBefore(input,init);}) as typeof fetch;
 }
 async close(){globalThis.fetch=this.fetchBefore;try{if(this.app)await this.app.close();}finally{try{await this.db.$disconnect();}finally{for(const[k,v]of this.saved){if(v===undefined)delete process.env[k];else process.env[k]=v;}}}}
 async staff(role:Role,label:string=role,staffPersonId=`person-${label}-${this.prefix}`):Promise<Login>{const token=randomUUID(),csrf=randomUUID(),user=await this.db.adminUser.create({data:{username:`n11-${label}-${this.prefix}`,name:`合成${label}`,role,staffPersonId,partnerCapabilities:role==='OPERATIONS'||role==='ADMIN'?[...partnerCapabilities]:[],passwordHash:'synthetic-no-password-login'}});await this.db.adminSession.create({data:{id:tokenHash(token),adminId:user.id,authVersion:user.authVersion,csrfToken:csrf,expiresAt:new Date(Date.now()+3600000)}});return{id:user.id,role,headers:{Origin:this.origin,Cookie:`admin_session=${token}`,'X-CSRF-Token':csrf}};}
 async customer(label:string):Promise<Login>{const token=randomUUID(),c=await this.db.customer.create({data:{mobile:`n11-${label}-${randomUUID()}`,name:`合成${label}`,openId:`n11-${token}`,drivingYears:5,profile:{}}});await this.db.customerSession.create({data:{id:tokenHash(token),customerId:c.id,expiresAt:new Date(Date.now()+3600000)}});const login={id:c.id,headers:{Authorization:`Bearer ${token}`}};await this.post('/customer/consents',{consents:['terms','privacy'].map(type=>({documentId:this.docs[type].id,version:this.docs[type].version}))},login);return login;}
 async portalGrant(ownerId:string,mobile=`139${randomInt(10000000,99999999)}`){
  const root=`/admin/partners/${ownerId}/portal-access`,before=await this.get(root),sends=this.syntheticSmsSends;
  const saved=await this.post(root,{...command(before.revision),displayName:'合成只读管理员',mobile,reason:'合成本地查看范围核对'});
  assert.equal(this.syntheticSmsSends,sends,'Saving a phone never sends an invitation');
  const submitted=await this.post(`${root}/submit`,{...command(saved.revision),candidateId:saved.candidate.id});
  const input={...approval(submitted.revision),candidateId:submitted.candidate.id};
  await this.reject(`${root}/review`,input,this.samePersonAlias,'PARTNER_SELF_REVIEW');
  const enabled=await this.post(`${root}/review`,input,this.partnerReviewer);assert.equal(enabled.current.status,'ENABLED');
  return{mobile,...enabled};
 }
 async ownerLogin(mobile:string):Promise<Login>{
  const anonymous:Login={id:'anonymous',headers:{Origin:this.origin}},challenge=await this.post('/owner-h5/auth/sms/request',{mobile},anonymous);
  assert.match(challenge.challengeId,/^[a-f0-9]{64}$/);const code=this.smsCodes.get(mobile);assert.ok(code,'Fake sendCode transport must capture the exact challenge code');
  const response=await fetch(`${this.base}/api/owner-h5/auth/login`,{method:'POST',headers:{Origin:this.origin,'Content-Type':'application/json'},body:JSON.stringify({mobile,challengeId:challenge.challengeId,code,consents:['terms','privacy'].map(type=>({documentId:this.docs[type].id,version:this.docs[type].version}))})}),data=await response.json() as any;
  assert.equal(response.status,201,JSON.stringify(data));assert.equal(data.mode,'PARTNER_READONLY');assert.equal('customer' in data,false);
  const cookie=response.headers.get('set-cookie');assert.ok(cookie);return{id:mobile,headers:{Cookie:cookie.split(';')[0],Origin:this.origin,'X-CSRF-Token':data.csrfToken}};
 }
 async raw(path:string,body?:any,who:Login=this.maker,method=body===undefined?'GET':'POST'){const headers={...who.headers,...(body instanceof FormData?{}:{'Content-Type':'application/json'})};const response=await fetch(`${this.base}/api${path}`,{method,headers,body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});const data=response.headers.get('content-type')?.includes('application/json')?await response.json() as any:await response.text();return{status:response.status,data};}
 async post(path:string,body:any,who:Login=this.maker,method='POST'){const result=await this.raw(path,body,who,method);assert.ok(result.status>=200&&result.status<300,`${method} ${path}: ${result.status} ${JSON.stringify(result.data)}`);return result.data;}
 async get(path:string,who:Login=this.maker){return this.post(path,undefined,who,'GET');}
 async reject(path:string,body:any,who:Login,code?:string,method=body===undefined?'GET':'POST'){const result=await this.raw(path,body,who,method);assert.ok(result.status>=400&&result.status<500,`Expected rejection ${path}: ${result.status} ${JSON.stringify(result.data)}`);if(code)assert.equal(result.data.error?.code,code,`${path}: ${JSON.stringify(result.data)}`);return result;}
 form(fields:Record<string,any>,label='proof',jpeg=false){const form=new FormData();for(const[k,v]of Object.entries(fields))form.set(k,typeof v==='string'?v:JSON.stringify(v));const identity=`${this.prefix}-${label}-${randomUUID()}`,bytes=jpeg?new Uint8Array([255,216,255,224,...Buffer.from(`SYNTHETIC-N11-${identity}`)]):`%PDF-1.4\nSYNTHETIC N11 ONLY ${identity}\n%%EOF`;form.set('file',new Blob([bytes],{type:jpeg?'image/jpeg':'application/pdf'}),`${label}.${jpeg?'jpg':'pdf'}`);return form;}
 async proof(who:Login,purpose='evidence',jpeg=false){return this.post(who.role?'/admin/files':'/customer/files',this.form({purpose},purpose,jpeg),who);}
 async publishGoods(vehicleId:string,productVersionId:string){
  const draft=await this.post('/admin/goods',{vehicleId,productVersionId,visible:true,recommended:false,sortOrder:0,...command()});
  assert.equal(draft.status,'DRAFT');assert.equal(draft.source,'EXPLICIT');
  const published=await this.post(`/admin/goods/${draft.id}/publish`,command(draft.revision));
  assert.equal(published.status,'PUBLISHED');assert.equal(published.vehicleId,vehicleId);assert.equal(published.productVersionId,productVersionId);
  const plan=await this.db.subscriptionPlan.findUniqueOrThrow({where:{id:published.subscriptionPlanId}});
  assert.equal(plan.vehicleId,vehicleId);assert.equal(plan.productVersionId,productVersionId);assert.equal(plan.active,true);
  return plan;
 }
 async completeProfile(who:Login,identityFront:any){
  const customer=await this.db.customer.findUniqueOrThrow({where:{id:who.id}}),identityBack=await this.proof(who,'identity'),drivingLicense=await this.proof(who,'identity');
  const current=await this.get('/customer/profile',who);
  await this.post('/customer/profile',{revision:current.revision,idempotencyKey:randomUUID(),name:customer.name,drivingYears:customer.drivingYears,identityFrontFileId:identityFront.id,identityBackFileId:identityBack.id,drivingLicenseFileId:drivingLicense.id},who,'PUT');
  // Trusted provider outcome is synthetic. Classification and private files use real HTTP.
  if(!this.saved.has('ESIGN_IDENTITY_ENCRYPTION_KEY'))this.saved.set('ESIGN_IDENTITY_ENCRYPTION_KEY',process.env.ESIGN_IDENTITY_ENCRYPTION_KEY);
  const {account}=trustedProfileFixture(customer);await this.db.eSignAccount.create({data:account});
  assert.equal((await this.get('/customer/profile',who)).readiness.readyForApplication,true);
  return{identityFront,identityBack,drivingLicense};
 }
 async assertPdf(path:string,who:Login=this.maker){const response=await fetch(`${this.base}/api${path}`,{headers:who.headers});assert.equal(response.status,200,path);assert.match(response.headers.get('content-type')||'',/^application\/pdf(?:;|$)/);const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.length>20,'PDF response must contain bytes');assert.equal(bytes.subarray(0,5).toString(),'%PDF-');return bytes;}
 async fieldInspection(orderId:string,actualAt:string,readingKm:number){
  let task=await this.post('/admin/handover-tasks',{orderId,type:'DELIVERY',assigneeId:this.field.id,note:'N11企业合成现场交车任务'});
  const own=await this.get(`/admin/field-tasks/${task.id}`,this.field);assert.equal(own.assigneeId,this.field.id);assert.equal(own.orderId,orderId);assert.equal('finalPlanSnapshot'in own,false);
  await this.reject('/admin/orders',undefined,this.field,'FORBIDDEN');
  const uploaded=await this.post(`/admin/field-tasks/${task.id}/files`,this.form({version:task.version},'field-inspection',true),this.field);task=uploaded.task;
  const draft={actualAt,readingKm,batteryPercent:80,place:'合成现场交付车位',accessories:'合成钥匙及充电线齐全',condition:'合成现场查验完好',openItems:'无',resolutionPlan:'无',fileIds:[uploaded.id]};
  task=await this.post(`/admin/field-tasks/${task.id}/draft`,{version:task.version,draft},this.field);
  await this.reject(`/admin/field-tasks/${task.id}/draft`,{version:task.version-1,draft},this.field,'VERSION_CONFLICT');
  const publication={version:task.version,idempotencyKey:randomUUID(),checked:true};
  task=await this.post(`/admin/field-tasks/${task.id}/publish`,publication,this.field);
  assert.equal((await this.post(`/admin/field-tasks/${task.id}/publish`,publication,this.field)).handover.id,task.handover.id);
  assert.equal(task.handover.status,'PUBLISHED');return task;
 }
 async archive(kind:string,subjectType:string,subjectId:string,scope?:any,fieldTask?:{id:string;version:number},draftOnly=false){
  const created=await this.post('/admin/offline-archives',{kind,subjectType,subjectId,templateId:this.docs[`OFFLINE_${kind}`].id,...(scope?{scope}:{}),...command()});
  const root=`/admin/offline-archives/${created.archiveId}`,version=`${root}/versions/${created.versionId}`;
  let revision=created.revision;
  const day=new Date().toISOString().slice(0,10),metadata={signedOn:day,contractNumber:`N11-${created.archiveId}`,originalCustodian:'合成原件保管员',originalLocation:'本地合成资料柜',declaredPages:1};
  let terminationDetails:any;
  if(kind==='TERMINATION'){
   const context=(await this.get(root)).terminationContext;assert.deepEqual(context.blockers,[]);assert.equal(context.delivery.state,'RETURNED');
   terminationDetails={reasonType:'CUSTOMER_REQUEST',reason:'合成客户提前还车协商终止',effectiveAt:new Date().toISOString(),conditionSummary:'依据本单已完成还车查验记录',violationStatus:'NONE',violationSummary:'合成测试无待处理违章',additionalPaymentAmount:0,refundAmount:context.funds.depositReceivedAmount-context.funds.depositRefundedAmount,refundDueOn:day,retainedDepositAmount:0,retainedDepositHandling:'无保留押金',settlementBasis:'本期租金按原合同结算，押金全额退回',unresolvedMatters:'无'};
  }
  const meta=await this.post(version,{...command(revision),...metadata,...(terminationDetails?{terminationDetails}:{})},this.maker,'PATCH');revision=meta.revision;
  const prepared=await this.post(`${version}/prepare`,command(revision));revision=prepared.revision;
  const bytes=await this.assertPdf(`${version}/files/${prepared.sourceFileId}`);assert.ok(bytes.length>1000,'PDFKit must render the synthetic Chinese template');this.preparedPdfs++;
  const confirmed=await this.post(`${version}/confirm-print`,command(revision));assert.equal(confirmed.printConfirmed,true);revision=confirmed.revision;
  let upload:any,submitted:any;
  if(fieldTask){
   const taskRoot=`/admin/field-tasks/${fieldTask.id}/offline-receipt`,scope={taskVersion:fieldTask.version,archiveId:created.archiveId,versionId:created.versionId};
   upload=await this.post(`${taskRoot}/files`,this.form({...scope,position:1,...command(revision)},kind),this.field);
   await this.assertPdf(`${taskRoot}/files/${upload.id}`,this.field);
   submitted=await this.post(`${taskRoot}/submit`,{...scope,...metadata,...command(upload.revision)},this.field);
  }else{
   upload=await this.post(`${version}/files`,this.form({position:1,...command(revision)},kind));
   if(draftOnly){assert.equal(kind,'OWNER_COOPERATION');return{...created,fileId:upload.id,revision:upload.revision,root,upload,metadata};}
   submitted=await this.post(`${root}/submit`,{versionId:created.versionId,...command(upload.revision)});
  }
  const current=await this.db.archiveVersion.findUniqueOrThrow({where:{id:created.versionId}}),parties=current.partiesSnapshot as any[];
  const input={...approval(submitted.revision),versionId:created.versionId,checklist:{partiesComplete:true,authorityChecked:true,pagesComplete:true,vehicleMatches:true,termsMatch:true,annexesComplete:true,legible:true,originalRecorded:true},partyChecks:parties.filter(p=>current.requiredSigners.includes(p.role)).map(p=>({role:p.role,partyId:p.partyId,signerName:`合成${p.role}签署人`,signedOn:day,signaturePageRefs:[{fileId:upload.id,page:1}],passed:true}))};
  await this.reject(`${root}/review`,input,this.field,'FORBIDDEN');
  if(kind==='RENTAL')await this.reject(`${root}/review`,{...input,partyChecks:input.partyChecks.filter(p=>p.role!=='OWNER')},this.reviewer,'ARCHIVE_PARTIES_REQUIRED');
  const reviewingStaff=fieldTask?this.maker:this.reviewer;
  const reviewed=await this.post(`${root}/review`,input,reviewingStaff);
  assert.equal(reviewed.status,'REVIEWED');assert.deepEqual(await this.post(`${root}/review`,input,reviewingStaff),reviewed);
  assert.equal((await this.db.documentArchive.findUniqueOrThrow({where:{id:created.archiveId}})).currentApprovedVersionId,null);
  const archiveInput={versionId:created.versionId,...command(reviewed.revision)},archived=await this.post(`${root}/archive`,archiveInput,reviewingStaff);
  assert.equal(archived.status,'ARCHIVED');assert.deepEqual(await this.post(`${root}/archive`,archiveInput,reviewingStaff),archived);
  if(fieldTask){const record=await this.db.archiveVersion.findUniqueOrThrow({where:{id:created.versionId}}),file=await this.db.storedFile.findUniqueOrThrow({where:{id:upload.id}});assert.equal(record.submittedBy,this.field.id);assert.equal(record.reviewedBy,this.maker.id);assert.equal(file.adminId,this.field.id);assert.equal(file.fieldTaskId,fieldTask.id);}
  return{...created,fileId:upload.id,revision:archived.revision,root,upload,metadata};
 }
}
