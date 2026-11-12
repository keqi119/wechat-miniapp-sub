import {test} from 'node:test';
import assert from 'node:assert/strict';
import {customerSourceAccess,customerSourcePayload} from './customer-source-model.ts';
import {listLocationState,updateListLocation,recordLocation,listLocation} from './process-navigation.ts';

test('source uses its own version, a required reason and explicit clearing',()=>{
 assert.deepEqual(customerSourcePayload({sourceChannel:'  老客户推荐 ',reason:'客户确认',clearSource:false},3),{sourceChannel:'老客户推荐',sourceRevision:3,reason:'客户确认'});
 assert.equal(customerSourcePayload({sourceChannel:'',reason:'客户要求清除',clearSource:true},4).sourceChannel,null);
 for(const values of [{sourceChannel:'',reason:'有理由'},{sourceChannel:'字'.repeat(65),reason:'有理由'},{sourceChannel:'bad\0text',reason:'有理由'},{sourceChannel:'有效',reason:''},{sourceChannel:'有效',reason:'bad\0text'}])assert.throws(()=>customerSourcePayload(values,1));
 assert.throws(()=>customerSourcePayload({sourceChannel:'有效',reason:'原因'},-1));
});
test('source permission needs current operational role and server permission',()=>{
 assert.deepEqual(customerSourceAccess('OPERATIONS',['customers.read','customers.write']),{read:true,write:true});
 assert.deepEqual(customerSourceAccess('ADMIN',['customers.read']),{read:true,write:false});
 for(const role of ['FINANCE','SUPPORT','FIELD',undefined])assert.deepEqual(customerSourceAccess(role,['*']),{read:false,write:false});
});
test('source filter survives customer detail navigation and cannot affect another resource',()=>{
 const hash='#customers?keyword=王&sourceChannel='+encodeURIComponent('老客户')+'&page=3',state=listLocationState(hash);
 assert.deepEqual(state,{keyword:'王',status:'',page:3,sourceChannel:'老客户'});assert.equal(listLocationState(listLocation(recordLocation(hash,'customer-1'))).sourceChannel,'老客户');
 const changed=updateListLocation(hash,{...state,sourceChannel:'  员工推荐  ',page:1});assert.equal(listLocationState(changed).sourceChannel,'员工推荐');assert.equal(listLocationState(changed).page,1);
 assert.equal(new URLSearchParams(updateListLocation(changed,{...state,sourceChannel:'',page:1}).split('?')[1]).has('sourceChannel'),false);
 assert.equal(listLocationState('#orders?sourceChannel='+encodeURIComponent('内部')).sourceChannel,undefined);
 assert.equal(listLocationState('#customers?sourceChannel='+encodeURIComponent('bad\0text')).sourceChannel,undefined);
});
