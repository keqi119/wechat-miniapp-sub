import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildElectronicPrintModel} from '../src/electronic-documents/print';
test('candidate blocker reproduced: unchanged V31 guard rejects the explicitly selected test lessor in actual body',()=>{
 const content=readFileSync('../../docs/legal/versions/ninda/v31-initial-20261108/01.json','utf8'),parsed=JSON.parse(content);
 const values=Object.fromEntries(parsed.markers.filter((m:any)=>m.category!=='SIGNATURE').map((m:any)=>[m.binding,m.binding==='parties.details'?'实际测试出租方：上海晓浪网络科技有限公司':'已确认合成测试资料']));
 const input:any={kind:'SUBSCRIPTION',number:'SYNTHETIC-INITIAL',version:1,businessHash:'a'.repeat(64),template:{type:'ELECTRONIC_V31_SUBSCRIPTION',version:1,status:'PUBLISHED',confirmedBy:'synthetic-local',confirmedAt:new Date(),title:'仅本地合成',content},parties:[{role:'CUSTOMER',partyId:'synthetic-c',subjectType:'INDIVIDUAL',name:'合成客户',identityNumber:'110101199001011234',phone:'13800000000'},{role:'OWNER',partyId:'synthetic-o',subjectType:'ENTERPRISE',name:'上海晓浪网络科技有限公司',creditCode:'913100001234567890'},{role:'PLATFORM',partyId:'synthetic-p',subjectType:'ENTERPRISE',name:'上海宁达信息科技有限公司',creditCode:'913100009876543210'}],sections:[],variables:{},v31Snapshot:{values}};
 assert.throws(()=>buildElectronicPrintModel(input),(e:any)=>e.getResponse?.().error?.code==='ELECTRONIC_TEMPLATE_INCOMPLETE');
 // Control: same exact approved bytes and synthetic source values with ordinary lessor render.
 input.parties[1].name='合成出租企业';input.v31Snapshot.values['parties.details']='实际出租方：合成出租企业';assert.ok(buildElectronicPrintModel(input).structuredNodes);
});
