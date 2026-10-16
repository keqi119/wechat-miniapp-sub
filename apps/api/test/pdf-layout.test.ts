import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import PDFDocument from 'pdfkit';
import {ContractPdfRendererService} from '../src/contract/contract-pdf-renderer.service';
import {createStage1ContractPdfSigningSlots} from '../src/contract/contract-pdf-render-model';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';
const font=[process.env.FADADA_CJK_FONT_PATH,'C:/Windows/Fonts/simhei.ttf','/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttf'].find(path=>path&&existsSync(path));
async function draw(lines:number){
 const texts:{text:string;page:number}[]=[];let page=0,attached=false;
 const original=PDFDocument.prototype.text;
 PDFDocument.prototype.text=function(text:any,...args:any[]){if(!attached){attached=true;this.on('pageAdded',()=>{page++;});}texts.push({text:String(text),page});return(original as any).call(this,text,...args);};
 try{const result=await new ContractPdfRendererService().render({agreementKind:'DELIVERY_DELAY_AMENDMENT',contractId:'synthetic',contractNo:'synthetic',orderNo:'synthetic-order',generatedAt:'2026-10-16',templateName:'延期交车补充协议',templateVersion:'1',contentTemplate:Array.from({length:lines},(_,i)=>`第${i+1}条：双方已确认本期服务金额及真实交付安排。`).join('\n'),subscriberParty:{subscriberName:'合成样张客户',subscriberIdNumber:'SYNTHETIC-ONLY',subscriberContactAddress:'合成地址',subscriberContactPhone:'',subscriberContactName:'合成样张客户',subscriberEmail:'',subscriberWechat:''},signingStage:'STAGE1_CONTRACT',signingSlots:createStage1ContractPdfSigningSlots(),appendix:{sections:[{title:'双方已确认安排',rows:[{label:'金额',value:'人民币1.00元'}]}]}}as any,{cjkFontPath:font});return{...result,texts};}finally{PDFDocument.prototype.text=original;}
}
test('delay PDF identifies its own agreement and omits placement debugging text',{skip:!font},async()=>{
 const result=await draw(12);assert.equal(result.texts[0].text,'延期交车补充协议');assert.equal(result.texts.some(x=>x.text.includes('Offset intent')),false);
});
test('each signing section title and both physical slots stay on the same page near page boundaries',{skip:!font},async()=>{
 for(const lines of [12,18,24,30,36,42]){const result=await draw(lines);for(const [title,prefix]of [['合同正文签署区','STAGE1_BODY_'],['附件1签署区','STAGE1_ATTACHMENT1_']]){const heading=result.texts.find(x=>x.text===title)!;assert.ok(heading);const slots=result.slotCoordinates.filter(x=>x.slotId.startsWith(prefix));assert.equal(slots.length,2);for(const slot of slots){assert.equal(slot.pageNumber,heading.page,`${lines} lines: ${title} must accompany ${slot.slotId}`);assert.ok(slot.y>0&&slot.y<1131);}}}
});
test('handover uses the same deployable CJK face and preserves two rendered signature coordinates',{skip:!font},async()=>{
 const writer=new ContractPdfArtifactWriterService({storedFile:{findMany:async()=>[]}}as any);
 const result=await(writer as any).renderHandover({id:'synthetic-handover',orderId:'synthetic-order',manifestHash:'a'.repeat(64),confirmedAt:new Date('2026-10-16T00:00:00Z'),readingKm:12000,checklist:{actualTimeAndPlace:'合成核验地点'},fileIds:[]},{version:1,content:'合成交接记录，金额¥1.00。'},{name:'合成客户',idCardNo:'SYNTHETIC-ONLY'},font);
 assert.equal(result.buffer.subarray(0,5).toString(),'%PDF-');assert.equal(result.slotCoordinates.length,2);assert.equal(result.slotCoordinates[0].pageNumber,result.slotCoordinates[1].pageNumber);
});
