import test from 'node:test';
import assert from 'node:assert/strict';
import {baasDraftPayload,baasActions,baasRegistrationMissingLabels,baasFinancialMissingFields,type BaasContract} from './asset-model.ts';
import {sameBaasName,readBaasPayerOptions} from './baas-business-model.ts';
const row={id:'b',vehicleId:'v',revision:4,status:'DRAFT',provider:'武汉蔚能',effectiveFrom:'2026-10-08',effectiveTo:null,billingCycle:'MONTHLY',rentalAmount:72800,paymentDayOfMonth:8,batteryPackage:null,serverDate:'2026-11-05',files:[{id:'pdf',mimeType:'application/pdf',state:'ACTIVE'}],registrationReadiness:{ready:true,checks:[],missingFields:[],signedPdfFiles:[{id:'pdf',name:'签署合同.pdf',sha256:'a'.repeat(64)}]},financialMissingFields:[]} as unknown as BaasContract;
test('activation uses precise business readiness and signed PDF, without battery as a requirement',()=>{
 assert.deepEqual(baasActions(row),['activate','archive']);assert.deepEqual(baasRegistrationMissingLabels(row),[]);assert.deepEqual(baasFinancialMissingFields(row),[]);
 assert.deepEqual(baasActions({...row,files:[{id:'pdf',mimeType:'image/jpeg',state:'ACTIVE'} as any]}),['archive']);assert.deepEqual(baasActions({...row,registrationReadiness:undefined}),['archive']);
 const incomplete={...row,registrationReadiness:{ready:false,checks:[{key:'PAYER',label:'代付合作商',passed:false,message:'请选择代付合作商'}],missingFields:['payerOwnerId'],signedPdfFiles:[]}} as BaasContract;
 assert.deepEqual(baasRegistrationMissingLabels(incomplete),['代付合作商']);assert.deepEqual(baasActions(incomplete),['archive']);
});
test('payer metadata uses real record ids and does not rewrite unchanged existing association',()=>{
 const current={...row,payerOwnerId:'original-owner',status:'ARCHIVED'} as BaasContract;
 assert.equal(baasDraftPayload({payerOwnerId:'target-owner',changeReason:'确认代付'},current).payerOwnerId,'target-owner');assert.equal('payerOwnerId' in baasDraftPayload({payerOwnerId:'original-owner',changeReason:'补齐日期'},current),false);
 assert.equal(baasDraftPayload({payerOwnerId:'',changeReason:'明确取消'},current).payerOwnerId,null);assert.throws(()=>baasDraftPayload({payerOwnerId:'不是记录编号',changeReason:'无效'},current));
});
test('registered-owner comparison normalizes NFKC and whitespace without replacing different people',()=>{
 assert.equal(sameBaasName('Ａ公司\u3000上海','A公司上海'),true);assert.equal(sameBaasName('甲 公司','乙公司'),false);assert.equal(sameBaasName('',''),false);
});
test('payer options read every page and retain record id/name, rejecting inconsistent directory',async()=>{
 const calls:string[]=[];const all=Array.from({length:101},(_,i)=>({id:'owner-'+i,name:'合作商-'+i}));const rows=await readBaasPayerOptions(async path=>{calls.push(path);const q=new URLSearchParams(path.split('?')[1]),page=Number(q.get('page')),size=Number(q.get('pageSize'));return{items:all.slice((page-1)*size,page*size),total:all.length,page,pageSize:size};});assert.equal(calls.length,2);assert.equal(rows.at(-1)?.id,'owner-100');
 await assert.rejects(readBaasPayerOptions(async()=>({items:[{id:'same',name:'甲'},{id:'same',name:'乙'}],total:2,page:1,pageSize:100})));
});

test('optional grace period can be left empty without introducing a registration requirement',()=>{assert.equal(baasDraftPayload({graceDays:'',changeReason:'选填留空'},{...row,status:'ARCHIVED'}).graceDays,0);});
