import test from 'node:test';
import {resolve} from 'node:path';
import {projectRoot} from '../src/common/config';
import assert from 'node:assert/strict';
import {assertIndependentStaffReview,getPartnerCapabilities,requirePartnerCapability} from '../src/partners/capabilities';
import {financeCommand,financialFiles,ruleInput} from '../src/partners/revenue-types';
import {SettlementService} from '../src/partners/settlements';
import {RevenueRuleService,PartnerAccountService} from '../src/partners/revenue-rules';
import {SettlementPaymentService} from '../src/partners/settlement-payments';
import {PartnerRevenueRuleController,PartnerSettlementController,PartnerFinanceWorkspaceController} from '../src/partners/settlement-controller';
const row=(id:string,capabilities:string[]=[],staffPersonId:string|null=id,role='OPERATIONS')=>({id,role,active:true,authVersion:1,partnerCapabilities:capabilities,staffPersonId});
const db=(rows:any[])=>({adminUser:{findUnique:async({where}:any)=>rows.find(r=>r.id===where.id),findMany:async({where}:any)=>rows.filter(r=>where.id.in.includes(r.id))}}) as any;
const code=(expected:string)=>(error:any)=>error.getResponse?.().error?.code===expected;
test('explicit exact capabilities: no FINANCE or ADMIN automatic privilege',async()=>{
 for(const role of ['FINANCE','ADMIN','OPERATIONS','SUPPORT','FIELD'])await assert.rejects(requirePartnerCapability(db([row('a',[],null,role)]),{id:'a',role,authVersion:1},'partner.rules.review'),code('FORBIDDEN'));
 assert.deepEqual(getPartnerCapabilities(row('a',['partner.rules.write','unknown'])),['partner.rules.write']);
 await assert.rejects(requirePartnerCapability(db([row('a')]),{id:'a',role:'OPERATIONS',authVersion:1},'partner.rules.*' as any),code('FORBIDDEN'));
});
test('operator write grants never imply review, stale session rejects after revoke',async()=>{
 const rows=[row('a',['partner.rules.write'])],tx=db(rows),actor={id:'a',role:'OPERATIONS',authVersion:1};
 await requirePartnerCapability(tx,actor,'partner.rules.write');
 await assert.rejects(requirePartnerCapability(tx,actor,'partner.rules.review'),code('FORBIDDEN'));
 rows[0].authVersion=2;rows[0].partnerCapabilities=[];
 await assert.rejects(requirePartnerCapability(tx,actor,'partner.rules.write'),code('STAFF_SESSION_CHANGED'));
});
test('independent reviews reject creator, submitter, uploader and second account of same person',async()=>{
 const tx=db([row('reviewer',[],'person-a'),row('same-person',[],'person-a'),row('other',[],'person-b'),row('unmapped',[],null)]);
 await assertIndependentStaffReview(tx,'reviewer',['other']);
 for(const id of ['reviewer','same-person'])await assert.rejects(assertIndependentStaffReview(tx,'reviewer',[id]),code('SETTLEMENT_SELF_REVIEW'));
 await assert.rejects(assertIndependentStaffReview(tx,'reviewer',['unmapped']),code('STAFF_PERSON_UNVERIFIED'));
 await assert.rejects(assertIndependentStaffReview(tx,'reviewer',['missing']),code('STAFF_PERSON_UNVERIFIED'));
 await assert.rejects(assertIndependentStaffReview(tx,'reviewer',[null]),code('STAFF_PERSON_UNVERIFIED'));
});
test('each finance command selects its own domain and action before touching records',async()=>{
 const cases=[['rule.create:new','partner.rules.write'],['rule.submit:v','partner.rules.write'],['rule.review:v','partner.rules.review'],['account.submit','partner.accounts.write'],['account.review:a','partner.accounts.review'],['settlement.create','partner.settlements.write'],['settlement.submit:s','partner.settlements.write'],['settlement.review:s','partner.settlements.review'],['settlement.payment.record:s','partner.payments.record'],['settlement.payment.reconcile:s','partner.payments.review'],['file.upload:PAYMENT','partner.payments.record'],['file.upload:ACCOUNT','partner.accounts.write']];
 for(const [action,capability] of cases){const tx:any={...db([row('a',[capability])]),$queryRaw:async()=>[],vehicleOwner:{findUnique:async()=>({id:'owner'})},archiveCommand:{findUnique:async()=>null,create:async()=>({})}};const actor={id:'a',role:'OPERATIONS',authVersion:1};assert.equal(await financeCommand(tx,actor,'owner',action,{idempotencyKey:'permission-test-key'},async()=>true),true);tx.adminUser=db([row('a',['partner.settlements.read'])]).adminUser;await assert.rejects(financeCommand(tx,actor,'owner',action,{idempotencyKey:'permission-test-key'},async()=>true),code('FORBIDDEN'));}
});
test('draft may retain known 20 percent while agreed basis and archive are missing',()=>{
 const input={revision:0,idempotencyKey:'draft-permission-key',terms:{method:'RATE',rateBps:2000,basis:null},evidenceFileIds:[]};assert.equal(ruleInput.safeParse(input).success,true);
 assert.equal(ruleInput.safeParse({...input,terms:{...input.terms,rateBps:2000.1}}).success,false);
});
test('settlement-only reader sees masked frozen account and no payment evidence',async()=>{
 const tx:any={...db([row('a',['partner.settlements.read'])]),partnerSettlement:{findUnique:async()=>({id:'s',ownerId:'owner',accountSnapshot:{accountName:'真实收款对象',bankName:'合成银行',accountNumber:'6222000012345678'}})},partnerSettlementLine:{findMany:async()=>[]},partnerSettlementPayment:{findMany:async()=>[{evidenceFileIds:['secret-payment'],reference:'secret-reference'}]},partnerSettlementFeedback:{findMany:async()=>[]}};
 const result=await new SettlementService().detail(tx,{id:'a',role:'OPERATIONS',authVersion:1},'s');assert.equal(result.accountSnapshot.accountNumber,'************5678');assert.equal(JSON.stringify(result).includes('secret-payment'),false);assert.equal(JSON.stringify(result).includes('secret-reference'),false);
});
test('draft service persists incomplete agreed terms without archive readiness and submit still refuses missing basis',async()=>{
 const actor={id:'a',role:'OPERATIONS',authVersion:1};let saved:any;
 const tx:any={...db([row('a',['partner.rules.write'])]),$queryRaw:async()=>[],vehicleOwner:{findUnique:async()=>({id:'owner'})},archiveCommand:{findUnique:async()=>null,create:async()=>({})},partnerRevenueRule:{create:async()=>({id:'rule'}),update:async()=>({})},partnerRevenueRuleVersion:{findFirst:async()=>null,create:async({data}:any)=>(saved={id:'version',revision:0,status:'DRAFT',...data}),findUnique:async()=>saved},auditLog:{create:async()=>({})}};
 const service=new RevenueRuleService(),result=await service.create(tx,actor,'owner',{terms:{method:'RATE',rateBps:2000,basis:null},evidenceFileIds:[],revision:0,idempotencyKey:'partial-rules-draft'});
 assert.equal(result.terms.basis,null);assert.equal(result.cooperationVersionId,null);assert.equal(result.validFrom,null);assert.ok(result.missingFields.some((field:any)=>field.code==='RULE_BASIS_REQUIRED'));
 await assert.rejects(service.submit(tx,actor,'version',{revision:0,idempotencyKey:'partial-rules-submit'}),(error:any)=>error.name==='ZodError');
});
test('domain file downloads require the matching explicit read and reject ADMIN without it',async()=>{
 for(const [kind,capability]of [['RULE','partner.rules.read'],['ACCOUNT','partner.accounts.read'],['SETTLEMENT','partner.settlements.read'],['PAYMENT','partner.payments.read']]){
  for(const permitted of [false,true]){const tx:any={...db([row('a',permitted?[capability]:[],null,'ADMIN')]),partnerSettlementFile:{findUnique:async()=>({ownerId:'owner',kind})},storedFile:{findUnique:async()=>({id:'file',purpose:'partner-settlement',mimeType:'application/pdf',name:'synthetic.pdf',storagePath:resolve(projectRoot,'var/uploads/synthetic-no-real-file')})}};const controller=kind==='RULE'?new PartnerRevenueRuleController({serial:(fn:any)=>fn(tx)} as any):new PartnerSettlementController({serial:(fn:any)=>fn(tx)} as any);let streamed=false;const out={setHeader(){},sendFile(){streamed=true;}};const call=()=>controller.file({admin:{id:'a',role:'ADMIN',authVersion:1}},'owner','file',out);if(permitted){await call();assert.equal(streamed,true);}else{await assert.rejects(call(),code('FORBIDDEN'));assert.equal(streamed,false);}}
 }
});
test('financial evidence cannot be borrowed from another owner or domain',async()=>{
 const tx:any={storedFile:{findMany:async()=>[{id:'file',adminId:'maker',purpose:'partner-settlement',sha256:'a'.repeat(64)}]},partnerSettlementFile:{findMany:async()=>[{fileId:'file',ownerId:'owner',kind:'RULE'}]}};
 await financialFiles(tx,'owner',['file'],'RULE');
 await assert.rejects(financialFiles(tx,'other-owner',['file'],'RULE'),code('SETTLEMENT_EVIDENCE_REQUIRED'));
 await assert.rejects(financialFiles(tx,'owner',['file'],'PAYMENT'),code('SETTLEMENT_EVIDENCE_REQUIRED'));
});
test('independent financial services reject same-person alternate accounts, including uploaders',async()=>{
 for(const role of ['ADMIN','OPERATIONS'])for(const domain of ['RULE','ACCOUNT','SETTLEMENT','PAYMENT']){
  const capability={RULE:'partner.rules.review',ACCOUNT:'partner.accounts.review',SETTLEMENT:'partner.settlements.review',PAYMENT:'partner.payments.review'}[domain]!;
  for(const uploadOnly of [false,true]){
   const rows=[row('reviewer',[capability],'person-r',role),row('maker',[],'person-m'),row('uploader',[],uploadOnly?'person-r':'person-m'),row('same-person',[],'person-r')];
   const current={id:'version',ownerId:'owner',ruleId:'rule',revision:0,status:domain==='PAYMENT'?'PAYMENT_RECORDED':'SUBMITTED',createdBy:uploadOnly?'maker':'same-person',submittedBy:'maker',recordedBy:uploadOnly?'maker':'same-person',evidenceFileIds:['file']};
   const table={findUnique:async()=>current,findFirst:async()=>({...current,status:'RECORDED'})};
   const tx:any={...db(rows),$queryRaw:async()=>[],vehicleOwner:{findUnique:async()=>({id:'owner'})},archiveCommand:{findUnique:async()=>null},partnerRevenueRuleVersion:table,partnerAccountVersion:table,partnerSettlement:table,partnerSettlementPayment:table,partnerSettlementLine:{findMany:async()=>[{evidenceFileIds:['file']}]},storedFile:{findMany:async()=>[{id:'file',adminId:'uploader',purpose:'partner-settlement',sha256:'a'.repeat(64)}]},partnerSettlementFile:{findMany:async()=>[{fileId:'file',ownerId:'owner',kind:domain}]}};
   const actor={id:'reviewer',role,authVersion:1},input={revision:0,idempotencyKey:'same-person-review',decision:'APPROVE',reason:'独立核实'};
   const call=()=>domain==='RULE'?new RevenueRuleService().review(tx,actor,'version',input):domain==='ACCOUNT'?new PartnerAccountService().review(tx,actor,'version',input):domain==='PAYMENT'?new SettlementPaymentService().reconcile(tx,actor,'version',input):new SettlementService().review(tx,actor,'version',input);
   await assert.rejects(call(),code('SETTLEMENT_SELF_REVIEW'));
  }
 }
});
test('idempotent command replay applies current read grants to sensitive snapshots',async()=>{
 const tx:any={...db([row('a',['partner.settlements.write'])]),$queryRaw:async()=>[],vehicleOwner:{findUnique:async()=>({id:'owner'})},archiveCommand:{findUnique:async()=>({requestHash:'',resultSnapshot:{id:'s',accountSnapshot:{accountNumber:'6222000012345678'},payments:[{reference:'secret'}]}})}};
 const input={idempotencyKey:'replay-sanitization'};const {hash}=await import('../src/common/data');tx.archiveCommand.findUnique=async()=>({requestHash:hash(input),resultSnapshot:{id:'s',accountSnapshot:{accountNumber:'6222000012345678'},payments:[{reference:'secret'}]}});
 const result=await financeCommand(tx,{id:'a',role:'OPERATIONS',authVersion:1},'owner','settlement.create',input,async()=>assert.fail('replay cannot execute command twice'));
 assert.equal(result.accountSnapshot.accountNumber,'************5678');assert.deepEqual(result.payments,[]);
});
test('external settlement feedback remains forbidden in direct controller invocation',async()=>{
 const session={id:'session',mode:'PARTNER_READONLY',mobileHash:'synthetic-hash',expiresAt:new Date(Date.now()+60000),scopeSnapshot:[{accessId:'grant',ownerId:'owner',accessVersion:1}]};
 const tx:any={partnerPortalSession:{findUnique:async()=>session},partnerPortalAccess:{findMany:async()=>[{id:'grant',ownerId:'owner',accessVersion:1,status:'ENABLED',reviewedBy:'reviewer',reviewedAt:new Date()}]}};
 const controller=new PartnerFinanceWorkspaceController({serial:(fn:any)=>fn(tx)} as any);
 await assert.rejects(controller.feedback({partnerPortalSession:session},'owner','settlement',{message:'不能写入'}),code('PARTNER_READ_ONLY'));
});
