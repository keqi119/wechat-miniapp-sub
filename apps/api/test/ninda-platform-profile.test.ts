import {test} from 'node:test';
import assert from 'node:assert/strict';
import {platformLegalEntity} from '../src/common/platform-legal-entity';
test('new local offline documents default to the approved Ninda platform entity',()=>{
 assert.equal(platformLegalEntity({NODE_ENV:'test'}),'上海宁达信息科技有限公司');
});
test('production still requires an explicit legal entity and never copies a development default',()=>{
 assert.throws(()=>platformLegalEntity({NODE_ENV:'production'}),(e:any)=>e.getResponse?.().error?.code==='PLATFORM_LEGAL_ENTITY_INVALID');
});
