import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowed,permissions} from '../src/auth/role-policy';

const assetResources=['vehicle-assets','baas-contracts','depreciation-policies','asset-cost-plans','asset-costs','license-plates'];
test('asset operations and financial posting have distinct role grants',()=>{
 const grants:Record<string,Record<string,string>>={
  ADMIN:Object.fromEntries(assetResources.map(resource=>[resource,'rw'])),
  OPERATIONS:{'vehicle-assets':'rw','baas-contracts':'rw','asset-cost-plans':'rw','license-plates':'rw'},
  FINANCE:{'vehicle-assets':'r','baas-contracts':'r','depreciation-policies':'rw','asset-cost-plans':'rw','asset-costs':'rw'},
  SUPPORT:{},FIELD:{},UNKNOWN:{},
 };
 for(const [role,resources] of Object.entries(grants))for(const resource of assetResources){
  for(const [write,action,letter] of [[false,'read','r'],[true,'write','w']] as const){
   const expected=resources[resource]?.includes(letter)??false;
   assert.equal(allowed(role,resource,write),expected,`${role} ${resource}.${action}`);
   assert.equal(permissions(role).includes(`${resource}.${action}`),expected,`session permission ${role} ${resource}.${action}`);
  }
 }
});
