import test from 'node:test';
import assert from 'node:assert/strict';
import {roleDetail,routeAllowed} from './modules/navigation.ts';
test('finance and support recognize electronic mode and contract navigation without private terms',()=>{
 for(const role of ['FINANCE','SUPPORT']){const safe=roleDetail('orders',{id:'order',contractMode:'ELECTRONIC',identityCiphertext:'secret',finalPlanSnapshot:{commercialTerms:{secret:true}}},role);assert.equal(safe.contractMode,'ELECTRONIC');assert.equal(safe.identityCiphertext,undefined);assert.equal((safe.finalPlanSnapshot as any)?.commercialTerms,undefined);assert.equal(routeAllowed('contract-center',role,['electronic-documents.read']),true);assert.equal(routeAllowed('contract-center',role,[]),false);}
});
