import {test} from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import {createOwnerContractPdfSigningSlots} from '../src/contract/contract-pdf-render-model';
import {ContractPdfRendererService} from '../src/contract/contract-pdf-renderer.service';
test('owner PDFs render actual lessor roles and reserve company seal centres without platform substitution',async()=>{
 const slots=createOwnerContractPdfSigningSlots('合成车主企业');assert.equal(slots.filter(s=>s.signerRole==='OWNER').length,2);assert.equal(slots.filter(s=>s.signerRole==='PLATFORM').length,0);
 const boxes:any[]=[],texts:string[]=[],rect=PDFDocument.prototype.rect,text=PDFDocument.prototype.text;
 PDFDocument.prototype.rect=function(x,y,width,height){boxes.push({x,y,width,height,page:this.page});return rect.call(this,x,y,width,height);};PDFDocument.prototype.text=function(value:any,...args:any[]){texts.push(String(value));return(text as any).call(this,value,...args);};
 try{const result=await new ContractPdfRendererService().render({agreementKind:'SUBSCRIPTION_STANDARD',contractId:'synthetic-owner',contractNo:'synthetic-owner',orderNo:'synthetic-order',generatedAt:'2026-10-17',templateName:'车主与客户订阅合同',templateVersion:'2',contentTemplate:'甲方：合成车主企业。\n乙方：合成客户。\n'+('本合同不用于真实签署。\n'.repeat(45)),subscriberParty:{subscriberName:'合成客户',subscriberIdNumber:'SYNTHETIC',subscriberContactAddress:'合成地址',subscriberContactPhone:'',subscriberContactName:'合成客户',subscriberEmail:'',subscriberWechat:''},signingStage:'STAGE1_CONTRACT',signingSlots:slots,appendix:{sections:[{title:'实际出租方',rows:[{label:'企业',value:'合成车主企业'}]}]}},{cjkFontPath:'C:/Windows/Fonts/simhei.ttf'});
  assert.equal(result.slotCoordinates.length,4);assert.equal(boxes.length,4);assert.equal(result.slotCoordinates.filter(s=>s.slotId.endsWith('_OWNER')).length,2);assert.ok(!texts.some(t=>t.includes('上海晓浪网络科技有限公司盖章')));
  result.slotCoordinates.forEach((s,i)=>{const box=boxes[i],centreY=s.y/1131*box.page.height;assert.ok(Math.abs(centreY-(box.y+box.height/2))<.02);const halfHeight=s.slotId.endsWith('_OWNER')?62:22.5;assert.ok(centreY-halfHeight>=box.y+10);assert.ok(centreY+halfHeight<=box.y+box.height-10);});
 }finally{PDFDocument.prototype.rect=rect;PDFDocument.prototype.text=text;}
});
