import test from 'node:test';
import assert from 'node:assert/strict';
import {legalBody,legalBlocks} from './legal-document-text.ts';
import {navigationFor,routeAllowed,retiredContractRoutes} from './modules/navigation.ts';
test('contract envelope is decoded once and plain approved text remains unchanged',()=>{
 const body='甲方：{{ownerName}}。\n\n第一条 交付\n1.1 使用车辆。\n二 结算\n退款另行确认。';
 assert.equal(legalBody(JSON.stringify({requiredSigners:['OWNER'],body})),body);assert.equal(legalBody(body),body);
 assert.equal(legalBody(JSON.stringify(body)),body);assert.equal(legalBody('{invalid'),'{invalid');
 assert.equal(legalBody('{"body":42}'),'{"body":42}');
 assert.deepEqual(legalBlocks(body).map(b=>b.kind),['paragraph','heading','clause','heading','paragraph']);
 assert.equal(legalBlocks('# 标题\r\n正文\r\n\r\n## 第一节')[2].text,'第一节');
 const table=legalBlocks('| 项目 | 说明 |\n| --- | --- |\n| 期限 | 按合同 |')[0];assert.equal(table.kind,'table');if(table.kind==='table'){assert.deepEqual(table.headers,['项目','说明']);assert.deepEqual(table.rows,[['期限','按合同']]);}
});
test('contract navigation contains current offline services and no retired signing routes',()=>{
 for(const role of ['ADMIN','OPERATIONS']){
  assert.deepEqual(navigationFor(role).find(m=>m.key==='contract-center')?.views.map(v=>v.key),['contract-center','legal-documents','offline-archives','partner-archives']);
  for(const route of retiredContractRoutes)assert.equal(routeAllowed(route,role,['*']),false);
 }
});
