import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildOfflinePrintModel} from '../src/offline-documents/print';
import {safeArchive} from '../src/offline-documents/projection';
import {ArchiveService} from '../src/offline-documents/archive.service';
import {frozenPartyDetails} from '../src/offline-documents/parties';
const parties=[{role:'CUSTOMER',partyId:'c',name:'合成客户',subjectType:'INDIVIDUAL',identityNumber:'110101199001010011',phone:'13800000000'},{role:'OWNER',partyId:'o',name:'合成出租企业',subjectType:'ENTERPRISE',creditCode:'91310000TEST000001'},{role:'PLATFORM',partyId:'p',name:'合成平台企业',subjectType:'ENTERPRISE',creditCode:'91310000TEST000002'}];
const input:any={archive:{id:'a',kind:'RENTAL'},version:{version:1,businessSnapshotHash:'a'.repeat(64)},template:{id:'t',version:1,title:'合成合同',content:'双方约定'},context:{requiredSigners:['CUSTOMER','OWNER','PLATFORM'],partiesSnapshot:parties,scopeSnapshot:{}}};
test('print includes natural person identity and phone, enterprise credit codes',()=>{
 const text=JSON.stringify(buildOfflinePrintModel(input));for(const value of ['身份证号','电话','统一社会信用代码',...parties.flatMap(p=>[p.identityNumber,p.phone,p.creditCode].filter(Boolean))])assert.ok(text.includes(value!));
});
test('new print rejects missing legal details with actionable field labels',()=>{
 for(const [index,key,label] of [[0,'identityNumber','身份证号'],[0,'phone','电话'],[1,'creditCode','统一社会信用代码']] as const){const incomplete=structuredClone(input);delete incomplete.context.partiesSnapshot[index][key];assert.throws(()=>buildOfflinePrintModel(incomplete),(e:any)=>e.getResponse?.().error.code==='PRINT_PARTIES_REQUIRED'&&e.getResponse().error.message.includes(label));}
});
test('archive projection repairs legacy multipart names without mutating frozen rows or file hashes',()=>{
 const name='签字合同🚗.pdf',garbled=Buffer.from(name).toString('latin1'),stored=Object.freeze({name:garbled,sha256:'a'.repeat(64),size:10,mimeType:'application/pdf'}),archive:any={id:'a',kind:'RENTAL',customerId:'c',versions:[{id:'v',status:'ARCHIVED',files:[{fileId:'f',position:1,file:stored}]}]};
 const dto=safeArchive(archive,'',{id:'c',role:'CUSTOMER'});assert.equal(dto.versions[0].files[0].name,name);assert.equal(stored.name,garbled);assert.equal(dto.versions[0].files[0].sha256,stored.sha256);
});
function draft(){
 const v:any={id:'v',version:1,status:'DRAFT',sourceFileId:'old-pdf',files:[],requiredSigners:parties.map(p=>p.role),partiesSnapshot:structuredClone(parties)};
 const a:any={id:'a',kind:'RENTAL',revision:2,versions:[v]},events:any[]=[];
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},$queryRaw:async()=>[],adminUser:{findUnique:async()=>({active:true,role:'OPERATIONS'})},documentArchive:{findUnique:async()=>a,update:async()=>a},archiveVersion:{update:async({data}:any)=>Object.assign(v,data)},archiveCommand:{findUnique:async()=>null,create:async()=>({})},auditLog:{create:async({data}:any)=>events.push(data)}};
 return{v,a,events,service:new ArchiveService({serial:async(fn:any)=>fn(tx)} as any,{} as any)};
}
const details={verified:true,verificationNote:'已与合成身份原件逐项核对',parties:[{role:'CUSTOMER',partyId:'c',identityNumber:'110101199001010011',phone:'13900000000'}]};
test('draft legal details freeze roles and identities, invalidate prior PDF and record verification without raw identity in audit',async()=>{
 const f=draft(),before=f.v.partiesSnapshot[0].name;delete f.v.partiesSnapshot[0].phone;await f.service.patch('a','v',{revision:2,idempotencyKey:'legal-details-edit',partyDetails:details},{id:'op',role:'OPERATIONS'});
 assert.equal(f.v.partiesSnapshot[0].phone,'13900000000');assert.equal(f.v.partiesSnapshot[0].name,before);assert.equal(f.v.sourceFileId,null);assert.ok(f.events.some(e=>e.action==='PARTY_DETAILS_VERIFIED'));assert.ok(!JSON.stringify(f.events).includes('110101199001010011'));
});
test('signed drafts and archived versions cannot alter party details; unknown identity/role and replacing frozen names rejected',async()=>{
 for(const scenario of ['signed','archived','unknown','name']){const f=draft();if(scenario==='signed')f.v.files=[{fileId:'signed'}];if(scenario==='archived')f.v.status='ARCHIVED';const payload:any=structuredClone(details);if(scenario==='unknown')payload.parties[0].partyId='other';if(scenario==='name')payload.parties[0].name='替换客户';await assert.rejects(f.service.patch('a','v',{revision:2,idempotencyKey:'legal-details-'+scenario,partyDetails:payload},{id:'op',role:'OPERATIONS'}));assert.equal(f.v.sourceFileId,'old-pdf');}
});
test('frozen sources fill only the matching legal party, never another company contact',()=>{
 const base:any=[{role:'CUSTOMER',partyId:'c',name:'合成客户',subjectType:'INDIVIDUAL'},{role:'OWNER',partyId:'o',name:'合成出租方',subjectType:'ENTERPRISE'}];
 const snapshot={customerProfileSnapshot:{mobile:'13800000000'},lessorSnapshot:{ownerId:'o',name:'其他企业',creditCode:'91310000TEST000099',phone:'13900000000'}};
 const result=frozenPartyDetails(base,snapshot);assert.equal(result[0].phone,'13800000000');assert.equal(result[1].creditCode,undefined);assert.equal(result[1].phone,undefined);assert.equal(base[0].phone,undefined);
 snapshot.lessorSnapshot.name='合成出租方';assert.equal(frozenPartyDetails(base,snapshot)[1].creditCode,'91310000TEST000099');
});
test('partner cooperation read capability never adds full personal identity to support DTOs',async()=>{
 const f=draft();f.a.kind='OWNER_COOPERATION';f.v.sourceFileId=null;f.v.status='ARCHIVED';const service:any=f.service;service.loaded=async()=>f.a;service.authorized=async()=>undefined;
 const dto=await service.detail('a',{id:'support',role:'SUPPORT',partnerCapabilities:['partner.cooperation.read']});assert.equal(dto.versions[0].partiesSnapshot[0].identityNumber,undefined);assert.equal(dto.versions[0].partiesSnapshot[0].phone,undefined);assert.equal(f.v.partiesSnapshot[0].identityNumber,parties[0].identityNumber);
});
test('new source generation checks the persisted legal snapshot before rendering and never overwrites an old source on missing details',async()=>{
 const f=draft();delete f.v.partiesSnapshot[0].identityNumber;const service:any=f.service;service.template=async()=>({});service.context={resolve:async()=>({businessSnapshotHash:'same'})};f.v.businessSnapshotHash='same';await assert.rejects(service.prepare('a','v',{revision:2,idempotencyKey:'missing-identity-print'},{id:'op',role:'OPERATIONS'}),(e:any)=>e.getResponse?.().error.code==='PRINT_PARTIES_REQUIRED');assert.equal(f.v.sourceFileId,'old-pdf');
});
