import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {v31TemplateType,v31RoleLabels,validateV31Template,paragraphs} from '../src/contract-terms/template-map';
import {hash} from '../src/common/data';
import {buildV31Document,productMinimumExpression} from '../src/contract-terms/render-model';
import {buildElectronicPrintModel} from '../src/electronic-documents/print';
import {NINDA_PLATFORM_LEGAL_ENTITY} from '../src/common/platform-legal-entity';
import {cooperationSourcesInput} from '../src/contract-terms/types';
const draft=(id:string)=>JSON.parse(readFileSync(`../../docs/legal/drafts/ninda/launch-20261107-v31/${id}.json`,'utf8'));
test('cooperation deposit authorization is explicit per product with exact coverage',()=>{
 const base={vehicleScopes:[{vehicleId:'v',validFrom:'2027-01-01',validUntil:'2028-01-01',authorityEvidenceFileIds:['e'],rightsRestrictions:{status:'NONE',evidenceFileIds:['e']}}],productVersionIds:['p'],templateRefs:[{id:'t',hash:'a'.repeat(64)}]};
 assert.equal(cooperationSourcesInput.safeParse({...base,productDepositRules:[{productVersionId:'p',rule:{kind:'CREDIT_POLICY',policyVersion:'ZHIMA_MANUAL_V1'}}]}).success,true);
 assert.equal(cooperationSourcesInput.safeParse({...base,productDepositRules:[{productVersionId:'other',rule:{kind:'FIXED',amount:100}}]}).success,false);
 assert.equal(cooperationSourcesInput.safeParse({...base,productDepositRules:[{productVersionId:'p',rule:{kind:'FIXED',amount:1.5}}]}).success,false);
});
test('seven distinct artifacts and explicit legal party roles; unsupported texts fail closed',()=>{
 assert.equal(new Set(['SUBSCRIPTION','COOPERATION','COOPERATION_GRANT','VEHICLE_SWAP','PRE_DELIVERY_CANCELLATION','RENEWAL','EARLY_TERMINATION'].map(v31TemplateType)).size,7);
 assert.deepEqual(v31RoleLabels('COOPERATION'),{PLATFORM:'甲方',OWNER:'乙方'});
 assert.deepEqual(v31RoleLabels('SUBSCRIPTION'),{CUSTOMER:'甲方',OWNER:'乙方',PLATFORM:'丙方'});
 assert.throws(()=>v31TemplateType('RETURN_SETTLEMENT'));
});
test('actual electronic print path accepts structured approved V31 and retains bold nodes',()=>{
 const content=draft('01'),values=Object.fromEntries(content.markers.filter((m:any)=>m.category!=='SIGNATURE').map((m:any)=>[m.binding,'已确认合成资料']));
 const model=buildElectronicPrintModel({kind:'SUBSCRIPTION',number:'TEST-V31',version:1,businessHash:'a'.repeat(64),template:{type:v31TemplateType('SUBSCRIPTION'),version:1,status:'PUBLISHED',confirmedBy:'sample-only',confirmedAt:new Date(),title:'测试',content:JSON.stringify(content)},parties:[{role:'CUSTOMER',partyId:'c',subjectType:'INDIVIDUAL',name:'测试客户',identityNumber:'110101199001011234',phone:'13800000000'},{role:'OWNER',partyId:'o',subjectType:'ENTERPRISE',name:'测试出租方',creditCode:'913100001234567890'},{role:'PLATFORM',partyId:'p',subjectType:'ENTERPRISE',name:NINDA_PLATFORM_LEGAL_ENTITY,creditCode:'913100009876543210'}],sections:[],variables:{},v31Snapshot:{values}} as any) as any;
 assert.ok(model.structuredNodes.length>70);assert.ok(!model.body.includes('【'));assert.ok(model.structuredNodes.some((n:any)=>n.runs?.some((r:any)=>r.bold)));
});
test('all original 47 markers have unique explicit binding/control mappings',()=>{
 const templates=['01','02-main','02-grant','03','04','05','06'].map(draft);
 const markers=templates.flatMap(t=>t.markers);
 assert.equal(markers.length,47);assert.equal(markers.filter(m=>m.category==='BLOCK').length,24);
 assert.equal(markers.filter(m=>m.category==='PARAMETER').length,4);assert.equal(markers.filter(m=>m.category==='SIGNATURE').length,19);
 for(const template of templates)validateV31Template(template);
 assert.ok(!JSON.stringify(draft('02-main').nodes).includes('附件三 企业电子印章使用授权书'));
 assert.ok(JSON.stringify(draft('02-grant').nodes).includes('附件三 企业电子印章使用授权书'));
});
test('marker categories and source bindings cannot be rebound during activation',()=>{
 const content=draft('01');content.markers.find((m:any)=>m.binding==='product.minimumTermMonths').binding='subscription.conditions';assert.throws(()=>validateV31Template(content));
});
test('different product minima retain each actual version and three month floor',()=>{
 assert.equal(productMinimumExpression([{id:'A-v1',minimumTermMonths:3},{id:'B-v2',minimumTermMonths:6}]),'A-v1：3个月；B-v2：6个月（各产品均不得低于3个月）');
 assert.throws(()=>productMinimumExpression([{id:'A',minimumTermMonths:2}]));
});
test('unapproved text and missing required block cannot produce a signable document',()=>{
 const content=draft('01');
 const template={type:v31TemplateType('SUBSCRIPTION'),version:1,status:'DRAFT',content:JSON.stringify(content)};
 assert.throws(()=>buildV31Document({kind:'SUBSCRIPTION'}, {values:{}},template));
 assert.throws(()=>buildV31Document({kind:'SUBSCRIPTION'}, {values:{}},{...template,status:'PUBLISHED',confirmedBy:'sample-only',confirmedAt:new Date()}));
});
test('cooperation visibly includes every fixed subscription paragraph and binds complete source bytes',()=>{
 const content=draft('02-main'),subscription=draft('01'),source=JSON.stringify(subscription),template={type:v31TemplateType('COOPERATION'),version:1,status:'PUBLISHED',confirmedBy:'synthetic-only',confirmedAt:new Date(),content:JSON.stringify(content)};
 const values=Object.fromEntries(content.markers.filter((m:any)=>m.category!=='SIGNATURE').map((m:any)=>[m.binding,m.binding==='cooperation.minimumTerms'?'产品A-v1：3个月；产品B-v2：6个月':'已确认合成资料']));
 const rendered=buildV31Document({kind:'COOPERATION'},{values,fixedTemplates:[{id:'fixed01',version:1,content:source,hash:hash(source)}]},template),text=paragraphs(rendered.sections).map(p=>p.runs.map(r=>r.text).join('')).join('\n');
 for(const p of paragraphs(subscription.nodes)){const original=p.runs.map(r=>r.text).join('');if(!original.includes('【'))assert.ok(text.includes(original),p.loc);}
 assert.ok(text.includes(hash(source)));assert.ok(text.includes('不是已成立或已签署的客户合同'));assert.ok(!/【|待填写|审阅值/.test(text));
 assert.throws(()=>buildV31Document({kind:'COOPERATION'},{values,fixedTemplates:[{id:'fixed01',version:1,content:source+' ',hash:hash(source)}]},template));
});
test('renewal without exception retains unchanged terms without empty exception authorization',()=>{
 const content=draft('05'),values=Object.fromEntries(content.markers.filter((m:any)=>m.category!=='SIGNATURE'&&m.required).map((m:any)=>[m.binding,'已确认合成资料']));
 const model=buildV31Document({kind:'RENEWAL'},{values},{type:v31TemplateType('RENEWAL'),version:1,status:'PUBLISHED',confirmedBy:'synthetic-only',confirmedAt:new Date(),content:JSON.stringify(content)});
 const text=paragraphs(model.sections).map(p=>p.runs.map(r=>r.text).join('')).join('\n');assert.ok(text.includes('联系人、押金及未明确变更的通用条款沿用原约定。'));assert.ok(!text.includes('仅有真实协商例外时'));assert.ok(!text.includes('【'));
});
