import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScopePrices,scopeMatches,quoteMatches} from '../src/addon-products/policy';
const scopes=[{brand:'蔚来',allModels:false,modelDefinitionIds:['et5']}];
const prices=[{km:1000,amount:100001},{km:1500,amount:140001},{km:2000,amount:180001}];
test('new monthly catalog requires complete decreasing integer-price tiers',()=>{
 assert.doesNotThrow(()=>validateScopePrices('MILEAGE_PACK',[{id:'a',scopes,prices}]));
 for(const invalid of [[],prices.slice(0,2),[{km:1000,amount:1},{km:1500,amount:2},{km:2000,amount:3}],prices.map(p=>({...p,amount:1.1}))]) assert.throws(()=>validateScopePrices('MILEAGE_PACK',[{id:'a',scopes,prices:invalid}]));
});
test('scope is OR clauses with true canonical brand, not cartesian arrays',()=>{
 assert.equal(scopeMatches(scopes,{id:'et5',brand:'蔚来'}),true);
 assert.equal(scopeMatches(scopes,{id:'et5',brand:'乐道'}),false);
 assert.equal(scopeMatches(scopes,{id:'et7',brand:'蔚来'}),false);
 assert.equal(scopeMatches([{brand:'蔚来',allModels:true,modelDefinitionIds:[]}],{id:'et7',brand:'蔚来'}),true);
});
test('overlapping prices fail closed instead of selecting the first',()=>{
 assert.throws(()=>quoteMatches([{id:'a',scopes,prices},{id:'b',scopes,prices}],{id:'et5',brand:'蔚来'}));
 assert.equal(quoteMatches([{id:'a',scopes,prices}],{id:'et5',brand:'蔚来'}).length,3);
});
