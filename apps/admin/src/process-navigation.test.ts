import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processHref,processReturnTarget,recordLocation,listLocation,listLocationState,updateListLocation} from './process-navigation.ts';

test('product editing preserves an exact version target and validates its identifier in related deep links',()=>{
 const origin='#product-warehouse?record=product-a&view=details&status=DRAFT&page=3';
 const target=processHref('#products?record=product-a&view=edit&versionId=version-2',origin);
 assert.equal(new URLSearchParams(target.split('?')[1]).get('versionId'),'version-2');
 assert.equal(processReturnTarget(target),origin);
 const invalid='#products?record=product-a&view=edit&versionId='+encodeURIComponent('../other');
 assert.equal(processHref(invalid,origin),invalid);
 assert.equal(processReturnTarget(invalid+'&returnTo='+encodeURIComponent(origin)),null);
});
test('related records retain the original order and tab across multiple related records',()=>{
 const origin='#orders?record=order-1&view=funds';
 const bill=processHref('#bills?record=bill-1&view=overview',origin);
 assert.equal(processReturnTarget(bill),origin);
 const refund=processHref('#refunds?record=refund-1',bill);
 assert.equal(processReturnTarget(refund),origin);
});
test('list query survives opening and closing a record and keeps related order scope',()=>{
 const list='#bills?orderId=order-1&keyword=October&status=PENDING&page=3';
 assert.equal(listLocation(recordLocation(list,'bill-1','overview')),list);
 assert.deepEqual(listLocationState(list),{keyword:'October',status:'PENDING',page:3});
 const updated=updateListLocation(recordLocation(list,'bill-1'),{keyword:'new',status:'PAID',page:1});
 assert.equal(new URLSearchParams(updated.split('?')[1]).get('record'),'bill-1');
 assert.equal(new URLSearchParams(updated.split('?')[1]).get('orderId'),'order-1');
 assert.deepEqual(listLocationState(updated),{keyword:'new',status:'PAID',page:1});
});
test('malformed list query is bounded and unsupported navigation is never rewritten',()=>{
 for(const page of ['0','-1','2.5','NaN','99999999999'])assert.equal(listLocationState('#orders?page='+page).page,1);
 assert.equal(listLocationState('#orders?keyword='+encodeURIComponent('x'.repeat(300))).keyword.length,200);
 assert.equal(listLocationState('#orders?status='+encodeURIComponent('<script>')).status,'');
 assert.equal(updateListLocation('https://example.com',{keyword:'a',status:'',page:1}),'https://example.com');
 assert.equal(listLocation('#orders?record=o&view=funds&returnTo='+encodeURIComponent('#orders?record=o')),'#orders');
});
test('existing history-only administration lists can still open their own records',()=>{
 for(const name of ['enterprise-seals','seal-authorities','signature-policies'])assert.equal(recordLocation('#'+name,'history-1'),'#'+name+'?record=history-1');
});
test('return targets reject external urls, unsupported routes, and recursively supplied return chains',()=>{
 for(const value of ['https://example.com','#javascript:alert(1)','#unknown?record=a','#orders?record=a&returnTo=%23bills%3Frecord%3Db'])assert.equal(processReturnTarget('#bills?record=b&returnTo='+encodeURIComponent(value)),null);
 assert.equal(processHref('#bills?record=b','#orders'), '#bills?record=b');
});
test('record and tab changes preserve related scope and return origin',()=>{
 const original=processHref('#offline-archives?orderId=order-1','#orders?record=order-1&view=contracts');
 const next=recordLocation(original,'archive-2','details');
 const p=new URLSearchParams(next.split('?')[1]);assert.equal(p.get('orderId'),'order-1');assert.equal(p.get('record'),'archive-2');assert.equal(p.get('view'),'details');assert.equal(processReturnTarget(next),'#orders?record=order-1&view=contracts');
 assert.equal(recordLocation(next,'','overview').includes('record='),false);
});
