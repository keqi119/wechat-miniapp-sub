import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {updatePartyDetails} from '../src/offline-documents/parties';
import {ArchiveService} from '../src/offline-documents/archive.service';
import {FilesController} from '../src/files/files';
import {fileReadStore} from './file-store-fixture';
import {projectRoot} from '../src/common/config';
const person={role:'OWNER',partyId:'owner',name:'合成人员',subjectType:'INDIVIDUAL',identityNumber:'110101199001010011',phone:'13800000000'};
const enterprise={role:'PLATFORM',partyId:'platform',name:'合成企业',subjectType:'ENTERPRISE',creditCode:'91310000TEST000001'};
test('supplements reject replacing any frozen nonempty personal or enterprise field, while identical repost and missing fields are allowed',()=>{
 for(const [party,field,value] of [[person,'identityNumber','110101199001010022'],[person,'phone','13900000000'],[enterprise,'creditCode','91310000TEST000002']] as const){const change={role:party.role,partyId:party.partyId,[field]:value};assert.throws(()=>updatePartyDetails([party],{parties:[change]}),(e:any)=>e.getResponse?.().error.code==='ARCHIVE_PARTY_FIELD_FROZEN');}
 assert.deepEqual(updatePartyDetails([person,enterprise],{parties:[person,enterprise]}),[person,enterprise]);const blank={...person,identityNumber:undefined};assert.equal(updatePartyDetails([blank],{parties:[{role:'OWNER',partyId:'owner',identityNumber:person.identityNumber}]} )[0].identityNumber,person.identityNumber);
});
function fixture(){const file={id:'signed',purpose:'offline-archive',name:'合成合同.pdf',mimeType:'application/pdf',storagePath:resolve(process.env.UPLOAD_DIR||resolve(projectRoot,'var/uploads'),'synthetic-private-contract')},v:any={id:'v',status:'ARCHIVED',partiesSnapshot:[person,enterprise],sourceFileId:'source',files:[{versionId:'v',fileId:'signed',position:1,file}]},a:any={id:'a',kind:'OWNER_COOPERATION',ownerId:'owner',versions:[v]};const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},storedFile:{findUnique:async()=>({...file,id:'source',purpose:'offline-source'})},archiveCommand:{findFirst:async()=>null}};const service:any=new ArchiveService(tx,{} as any);service.loaded=async()=>a;service.authorized=async()=>undefined;return{service,a,v};}
test('cooperation read capability grants summary only: support and finance cannot read personal source or signed originals',async()=>{
 for(const role of ['SUPPORT','FINANCE'])for(const id of ['source','signed']){const f=fixture();let streamed=false;await assert.rejects(f.service.readFile('a','v',id,{id:'reader',role,partnerCapabilities:['partner.cooperation.read']},{set(){},sendFile(){streamed=true;}}),(e:any)=>e.getResponse?.().error.code==='ARCHIVE_FILE_PERMISSION');assert.equal(streamed,false);}
 const f=fixture(),dto=await f.service.detail('a',{id:'reader',role:'SUPPORT',partnerCapabilities:['partner.cooperation.read']});assert.equal(dto.versions[0].sourceFileId,null);assert.deepEqual(dto.versions[0].files,[]);assert.equal(dto.versions[0].partiesSnapshot[0].identityNumber,undefined);assert.equal(f.v.sourceFileId,'source');
});
test('authorized operations and the owning archived party retain files; foreign owner cannot acquire file access',async()=>{
 for(const actor of [{id:'staff',role:'ADMIN',partnerCapabilities:['partner.cooperation.read']},{id:'owner-user',role:'OWNER',ownerId:'owner'}]){const f=fixture();let streamed=false;await f.service.readFile('a','v','signed',actor,{set(){},sendFile(){streamed=true;}});assert.equal(streamed,true);}
 await assert.rejects(fixture().service.readFile('a','v','signed',{id:'foreign',role:'OWNER',ownerId:'other'},{set(){},sendFile(){throw Error('must not stream');}}));
});
test('generic admin and customer routes cannot bypass archive bindings even with a legacy generic purpose',async()=>{
 for(const purpose of ['offline-source','offline-archive','evidence'])for(const kind of ['source','signed'])for(const route of ['admin','customer']){const file={id:'private',purpose,customerId:'customer'},db=fileReadStore({storedFile:{findUnique:async()=>file},archiveFile:{count:async()=>kind==='signed'?1:0},archiveVersion:{count:async()=>kind==='source'?1:0}}),service=new FilesController(db as any);let streamed=false;const req={admin:{id:'support',role:'SUPPORT',partnerCapabilities:['partner.cooperation.read']},customer:{id:'customer'}};await assert.rejects(route==='admin'?service.adminRead('private',req,{sendFile(){streamed=true;}}):service.customerRead('private',req,{sendFile(){streamed=true;}}),(e:any)=>e.getResponse?.().error.code==='ARCHIVE_ROUTE_REQUIRED');assert.equal(streamed,false);}
});
