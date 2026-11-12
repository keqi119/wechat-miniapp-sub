import test from 'node:test';
import assert from 'node:assert/strict';
import {addonDraft,addonPayload,publicationProblems,scopeSummary,addonCanWrite,addonDisplayVersion} from './addon-products-model.ts';

test('blank add-on drafts stay empty and new versions preserve each real amount and grouped OR scope',()=>{
 assert.deepEqual(addonPayload('MILEAGE_PACK',addonDraft()).scopePrices,[]);
 const source={id:'v',version:1,revision:2,status:'PUBLISHED',name:'真实包',scopePrices:[{id:'g',scopes:[{brand:'蔚来',allModels:false,modelDefinitionIds:['et5','et7']},{brand:'小鹏',allModels:true,modelDefinitionIds:[]}],prices:[{km:1000,amount:80123},{km:1500,amount:100456},{km:2000,amount:120789}]}]} as any;
 const draft=addonDraft(source);assert.deepEqual(addonPayload('MILEAGE_PACK',draft),{kind:'MILEAGE_PACK',name:'真实包',scopePrices:source.scopePrices});
 assert.match(scopeSummary(source.scopePrices[0].scopes,[{id:'et5',brand:'蔚来',name:'ET5'},{id:'et7',brand:'蔚来',name:'ET7'}]),/蔚来.*ET5.*ET7.*或.*小鹏.*全系/);
 draft.groups[0].amounts['1500']='';assert.deepEqual((addonPayload('MILEAGE_PACK',draft).scopePrices as any[])[0].prices,[{km:1000,amount:80123},{km:2000,amount:120789}]);
});
test('publication checks complete three-tier integer prices with strict per-km decrease and refuses guessed defaults',()=>{
 assert.ok(publicationProblems('MILEAGE_PACK',{scopePrices:[]}).length);
 const group={id:'g',scopes:[{brand:'蔚来',allModels:true,modelDefinitionIds:[]}],prices:[{km:1000,amount:100000},{km:1500,amount:150000},{km:2000,amount:180000}]};
 assert.match(publicationProblems('MILEAGE_PACK',{scopePrices:[group]}).join(' '),/单公里/);
 group.prices[1].amount=140000;assert.deepEqual(publicationProblems('MILEAGE_PACK',{scopePrices:[group]}),[]);
 group.prices[2].amount=180000.5;assert.ok(publicationProblems('MILEAGE_PACK',{scopePrices:[group]}).length);
});
test('swap price is exactly one credit and support finance field cannot gain pricing writes through wildcard',()=>{
 const draft=addonDraft();draft.name='目标车型换车';draft.groups=[{id:'g',scopes:[{brand:'蔚来',allModels:true,modelDefinitionIds:[]}],amounts:{'1':'199.90'}}];
 assert.deepEqual(addonPayload('SWAP_CREDIT',draft),{kind:'SWAP_CREDIT',name:'目标车型换车',scopePrices:[{id:'g',scopes:[{brand:'蔚来',allModels:true,modelDefinitionIds:[]}],prices:[{quantity:1,amount:19990}]}]});
 for(const role of ['SUPPORT','FINANCE','FIELD'])assert.equal(addonCanWrite({role,permissions:['*']}),false);
 assert.equal(addonCanWrite({role:'OPERATIONS',permissions:['addon-products.read','addon-products.write']}),true);
});
test('a draft price cannot masquerade as the active sale version in the list',()=>{
 const published={id:'sale',status:'PUBLISHED',version:1,scopePrices:[{prices:[{km:1000,amount:80123}]}]},draft={id:'draft',status:'DRAFT',version:2,scopePrices:[{prices:[{km:1000,amount:99999}]}]};
 assert.equal(addonDisplayVersion({versions:[draft,published]} as any)?.id,'sale');assert.equal(addonDisplayVersion({versions:[draft]} as any)?.id,'draft');
});
