import {test} from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import {existsSync} from 'node:fs';
import {renderTechnicalPdf} from '../src/technical-acceptance/pdf';
test('technical PDF renders approved markdown without literal markers, one title and page numbers, retaining both signature coordinates',async()=>{
 const calls:string[]=[];const original=PDFDocument.prototype.text;PDFDocument.prototype.text=function(text:any,...args:any[]){calls.push(String(text));return(original as any).call(this,text,...args);};
 try{const r=await renderTechnicalPdf('# 纯电主义电子签署流程验证确认书\n\n**本次不建立租赁或收费。**\n\n## 一 范围\n\n'+('独立验证签署和归档。\n\n'.repeat(45)),'C:/Windows/Fonts/simhei.ttf');assert.equal(calls.filter(t=>t.includes('电子签署流程验证确认书')).length,1);assert.ok(calls.every(t=>!t.includes('**')&&!/^#/.test(t)));assert.ok(calls.some(t=>/^第 1 \/ \d+ 页$/.test(t)));assert.equal(r.slotCoordinates.length,2);assert.equal(r.slotCoordinates[0].pageNumber,r.slotCoordinates[1].pageNumber);for(const slot of r.slotCoordinates)assert.ok(slot.y>0&&slot.y<1000);assert.equal(r.buffer.subarray(0,5).toString(),'%PDF-');}finally{PDFDocument.prototype.text=original;}
});

test('signature block stays together above the footer across font metrics and page-break boundaries',async()=>{
 const productionFont='../../.runtime/delivery-delay-pdf-qa/fonts/NotoSansCJK-Regular.ttc';
 const fonts=['C:/Windows/Fonts/simhei.ttf',...(existsSync(productionFont)?[productionFont]:[])];
 const boxes:{bottom:number;pageHeight:number;page:unknown}[]=[];
 const original=PDFDocument.prototype.rect;
 PDFDocument.prototype.rect=function(x:number,y:number,width:number,height:number){boxes.push({bottom:y+height,pageHeight:this.page.height,page:this.page});return original.call(this,x,y,width,height);};
 try{for(const font of fonts)for(const lines of [0,18,19,20,21,30,50]){
  boxes.length=0;
  const result=await renderTechnicalPdf('# Probe\n'+'内容测试。\n'.repeat(lines),font);
  assert.equal(boxes.length,2);
  assert.equal(boxes[0].page,boxes[1].page,'both signers must remain on the same physical page');
  assert.equal(result.slotCoordinates[0].pageNumber,result.slotCoordinates[1].pageNumber);
  for(const box of boxes)assert.ok(box.bottom<=box.pageHeight-45,`signature box overlaps footer: ${lines} lines, ${font}, bottom ${box.bottom}`);
 }}finally{PDFDocument.prototype.rect=original;}
});
test('technical PDF preserves masked mobile stars while removing only paired bold wrappers',async()=>{
 const calls:string[]=[];const original=PDFDocument.prototype.text;PDFDocument.prototype.text=function(text:any,...args:any[]){calls.push(String(text));return(original as any).call(this,text,...args);};
 try{await renderTechnicalPdf('# 技术验证\n乙方手机：199****0001\n**单独同意**','C:/Windows/Fonts/simhei.ttf');assert.ok(calls.includes('乙方手机：199****0001'));assert.ok(calls.includes('单独同意'));}finally{PDFDocument.prototype.text=original;}
});

test('provider signature centres and measured appearance sizes stay inside the actual drawn boxes',async()=>{
 const boxes:{x:number;y:number;width:number;height:number;pageWidth:number;pageHeight:number}[]=[];
 const original=PDFDocument.prototype.rect;
 PDFDocument.prototype.rect=function(x:number,y:number,width:number,height:number){boxes.push({x,y,width,height,pageWidth:this.page.width,pageHeight:this.page.height});return original.call(this,x,y,width,height);};
 try{
  const result=await renderTechnicalPdf('# 签署位置回归\n\n本文仅验证版式。','C:/Windows/Fonts/simhei.ttf');
  assert.equal(boxes.length,2);
  // Measured /Widget Rect from the first real archived PDF, rounded up.
  const appearances=[{width:100,height:45},{width:124,height:124}];
  result.slotCoordinates.forEach((slot,index)=>{
   const box=boxes[index],appearance=appearances[index];
   const centre={x:slot.x/800*box.pageWidth,y:slot.y/1131*box.pageHeight};
   assert.ok(Math.abs(centre.x-(box.x+box.width/2))<0.01,'provider x must be the drawn box centre, not its left edge');
   assert.ok(Math.abs(centre.y-(box.y+box.height/2))<0.01,'provider y must be the drawn box centre, not its top edge');
   assert.ok(centre.x-appearance.width/2>=box.x+10,'signature must leave horizontal padding');
   assert.ok(centre.y-appearance.height/2>=box.y+10,'signature must leave vertical padding');
   assert.ok(centre.y+appearance.height/2<=box.y+box.height-10);
   assert.ok(box.y+box.height<=box.pageHeight-45,'box must stay above the footer');
  });
  assert.ok(boxes[1].y>=boxes[0].y+boxes[0].height+30,'company label must have its own space');
 }finally{PDFDocument.prototype.rect=original;}
});
