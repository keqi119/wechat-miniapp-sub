import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newOrderChangesEnabled,orderChangeScopeEnabled} from '../src/offline-documents/change-mode';
test('new self-service changes are disabled for MVP and frozen offline orders',()=>{
 assert.equal(newOrderChangesEnabled({contractMode:'OFFLINE'},{}),false);
 assert.equal(newOrderChangesEnabled({contractMode:'ESIGN'},{MVP_V2_ENABLED:'true'}),false);
 assert.equal(newOrderChangesEnabled({contractMode:'ESIGN'},{MVP_V2_ENABLED:'false'}),true);
});
test('only implemented OFFLINE scopes open; unknown/general/purchase and legacy MVP remain unchanged',()=>{
 for(const env of [{},{MVP_V2_ENABLED:'true'},{MVP_V2_ENABLED:'false'}]){
  for(const scope of ['DELIVERY_DELAY','VEHICLE_CHANGE'] as const)assert.equal(orderChangeScopeEnabled({contractMode:'OFFLINE'},scope,env),true);
  for(const scope of ['SWAP_CREDIT_PURCHASE','SUBSCRIPTION_EXTENSION','ARBITRARY',undefined])assert.equal(orderChangeScopeEnabled({contractMode:'OFFLINE'},scope as any,env),false);
  assert.equal(newOrderChangesEnabled({contractMode:'OFFLINE'},env),false);
 }
 for(const scope of ['DELIVERY_DELAY','VEHICLE_CHANGE'] as const){assert.equal(orderChangeScopeEnabled({contractMode:'ESIGN'},scope,{MVP_V2_ENABLED:'true'}),false);assert.equal(orderChangeScopeEnabled({contractMode:'ESIGN'},scope,{MVP_V2_ENABLED:'false'}),true);assert.equal(orderChangeScopeEnabled({},scope,{MVP_V2_ENABLED:'false'}),true);assert.equal(orderChangeScopeEnabled({contractMode:'UNKNOWN'},scope,{}),false);}
});
