import test from 'node:test';
import assert from 'node:assert/strict';
import {resources,actionAllowed,resourceActionWritable} from './resources.ts';
test('draft templates expose a single confirmed enable action to platform operators',()=>{
 const resource=resources.find(r=>r.key==='legal-documents')!,action=resource.actions?.find(a=>a.path==='activate');assert.ok(action);
 assert.ok(action.fields?.some(f=>f.key==='confirmed'&&f.type==='attestation'));
 assert.equal(actionAllowed(resource.key,action,{id:'t',status:'DRAFT'}),true);assert.equal(actionAllowed(resource.key,action,{id:'t',status:'PUBLISHED'}),false);assert.equal(actionAllowed(resource.key,action,{id:'t',status:'RETIRED'}),false);
 assert.equal(resourceActionWritable(resource,action,['legal-documents.write'],'OPERATIONS'),true);assert.equal(resourceActionWritable(resource,action,['legal-documents.write'],'FINANCE'),false);
});
