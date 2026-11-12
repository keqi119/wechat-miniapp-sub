import {test} from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import {buildElectronicPrintModel,renderElectronicDocument} from '../src/electronic-documents/print';

const input=()=>({kind:'SUBSCRIPTION' as const,number:'ND-SYNTHETIC-ONLY',version:1,businessHash:'a'.repeat(64),
 template:{id:'approved',type:'ELECTRONIC_SUBSCRIPTION',version:1,title:'汽车订阅三方合同',status:'PUBLISHED',confirmedBy:'synthetic-approver',confirmedAt:new Date(),content:JSON.stringify({requiredSigners:['CUSTOMER','OWNER','PLATFORM'],body:'甲方{{ownerName}}；乙方{{customerName}}；丙方{{platformName}}。各方电子签署，本样张仅供测试。'})},
 parties:[{role:'CUSTOMER',partyId:'c',name:'合成客户',subjectType:'INDIVIDUAL',identityNumber:'110101199001010000',phone:'13800000001'},{role:'OWNER',partyId:'o',name:'合成车辆公司',subjectType:'ENTERPRISE',creditCode:'913100009876543210'},{role:'PLATFORM',partyId:'p',name:'上海宁达信息科技有限公司',subjectType:'ENTERPRISE',creditCode:'913100001234567890'}],
 sections:[{title:'已确认方案',rows:[{label:'月费',value:'1.00 元'},{label:'押金',value:'1.00 元'}]}],variables:{},usageAppendix:''});

test('electronic formal source requires approved text, exact parties and complete legal identity fields',()=>{
 const f=input(),model=buildElectronicPrintModel(f);assert.equal(model.signers.length,3);assert.ok(model.body.includes('上海宁达'));assert.ok(!model.body.includes('{{'));
 assert.throws(()=>buildElectronicPrintModel({...f,template:{...f.template,status:'DRAFT'}}));
 assert.throws(()=>buildElectronicPrintModel({...f,template:{...f.template,confirmedBy:null}}));
 assert.throws(()=>buildElectronicPrintModel({...f,parties:f.parties.slice(0,2)}));
 assert.throws(()=>buildElectronicPrintModel({...f,parties:f.parties.map(p=>p.role==='CUSTOMER'?{...p,identityNumber:''}:p)}));
 assert.throws(()=>buildElectronicPrintModel({...f,parties:f.parties.map(p=>p.role==='PLATFORM'?{...p,name:'上海晓浪网络科技有限公司'}:p)}));
 assert.throws(()=>buildElectronicPrintModel({...f,template:{...f.template,content:JSON.stringify({requiredSigners:['CUSTOMER','OWNER','PLATFORM'],body:'{{unresolved}}'})}}));
 assert.throws(()=>buildElectronicPrintModel({...f,kind:'HANDOVER' as any}));
});

test('long Chinese electronic PDF keeps each actual signer seal box on one page and returns its real centre',async()=>{
 const f=input();f.sections[0].rows.push({label:'明细',value:'本数据为合成测试，不用于真实签署。\n'.repeat(110)});
 const boxes:any[]=[];const original=PDFDocument.prototype.rect;
 PDFDocument.prototype.rect=function(x,y,w,h){boxes.push({x,y,w,h,width:this.page.width,height:this.page.height});return original.call(this,x,y,w,h);};
 try{const result=await renderElectronicDocument(f,'C:/Windows/Fonts/simhei.ttf');assert.equal(result.buffer.subarray(0,5).toString(),'%PDF-');assert.equal(boxes.length,3);
  for(const [i,role] of ['CUSTOMER','OWNER','PLATFORM'].entries()){const slot=result.positions[role as 'CUSTOMER']![0],box=boxes[i];assert.ok(slot.pagenum>=2);assert.ok(box.y+box.h<box.height-48);assert.ok(Math.abs(slot.x/800*box.width-box.x-box.w/2)<.02);assert.ok(Math.abs(slot.y/1131*box.height-box.y-box.h/2)<.02);}
 }finally{PDFDocument.prototype.rect=original;}
});
