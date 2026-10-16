import {test} from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import {renderTechnicalPdf} from '../src/technical-acceptance/pdf';
test('technical PDF renders approved markdown without literal markers, one title and page numbers, retaining both signature coordinates',async()=>{
 const calls:string[]=[];const original=PDFDocument.prototype.text;PDFDocument.prototype.text=function(text:any,...args:any[]){calls.push(String(text));return(original as any).call(this,text,...args);};
 try{const r=await renderTechnicalPdf('# 纯电主义电子签署流程验证确认书\n\n**本次不建立租赁或收费。**\n\n## 一 范围\n\n'+('独立验证签署和归档。\n\n'.repeat(45)),'C:/Windows/Fonts/simhei.ttf');assert.equal(calls.filter(t=>t.includes('电子签署流程验证确认书')).length,1);assert.ok(calls.every(t=>!t.includes('**')&&!/^#/.test(t)));assert.ok(calls.some(t=>/^第 1 \/ \d+ 页$/.test(t)));assert.equal(r.slotCoordinates.length,2);assert.equal(r.slotCoordinates[0].pageNumber,r.slotCoordinates[1].pageNumber);for(const slot of r.slotCoordinates)assert.ok(slot.y>0&&slot.y<1000);assert.equal(r.buffer.subarray(0,5).toString(),'%PDF-');}finally{PDFDocument.prototype.text=original;}
});
test('technical PDF preserves masked mobile stars while removing only paired bold wrappers',async()=>{
 const calls:string[]=[];const original=PDFDocument.prototype.text;PDFDocument.prototype.text=function(text:any,...args:any[]){calls.push(String(text));return(original as any).call(this,text,...args);};
 try{await renderTechnicalPdf('# 技术验证\n乙方手机：199****0001\n**单独同意**','C:/Windows/Fonts/simhei.ttf');assert.ok(calls.includes('乙方手机：199****0001'));assert.ok(calls.includes('单独同意'));}finally{PDFDocument.prototype.text=original;}
});
