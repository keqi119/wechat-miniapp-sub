import test from 'node:test';import assert from 'node:assert/strict';
import {LegalClient,technicalAuthoritySwitch} from './legal-client.ts';
import {OwnerClient} from './client.ts';
test('fix1 explicit technical enable/pause uses current revision and its own route, never the business toggle',async()=>{
 const requests:{path:string;body:Record<string,unknown>;csrf:string|null}[]=[];
 const api=new LegalClient(async(path,init)=>{requests.push({path:String(path),body:JSON.parse(String(init?.body)),csrf:new Headers(init?.headers).get('X-CSRF-Token')});return new Response(JSON.stringify({enabled:true}),{headers:{'Content-Type':'application/json'}});});api.setCsrf('synthetic-current-session');
 const record={id:'technical',revision:7,scopeHash:'a'.repeat(64),status:'AUTHORIZED',enabled:false};
 const enable=technicalAuthoritySwitch('company',record);await api.request(enable.path,enable.body);
 const pause=technicalAuthoritySwitch('company',{...record,enabled:true,revision:8});await api.request(pause.path,pause.body);
 assert.deepEqual(requests.map(r=>r.path),['/owner/api/owners/company/authorities/technical/switch','/owner/api/owners/company/authorities/technical/switch']);
 assert.deepEqual(requests.map(r=>r.body),[{enabled:true,revision:7,scopeHash:record.scopeHash},{enabled:false,revision:8,scopeHash:record.scopeHash}]);
 assert.ok(requests.every(r=>r.csrf==='synthetic-current-session'&&!r.path.includes('electronic-documents')));
 const readonly=new OwnerClient(async()=>{throw Error('readonly must not dispatch a switch');});await assert.rejects(readonly.request(enable.path,enable.body));
});
