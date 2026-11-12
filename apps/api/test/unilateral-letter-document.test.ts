import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import PDFDocument from 'pdfkit';
import {renderUnilateralLetter,resolveUnilateralLetter,UnilateralLetterSnapshot} from '../src/owner-signing/unilateral-letter-document';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const template=`# 企业车主单方用印授权书

授权编号：{{authorityId}}
授权人：{{ownerName}}
统一社会信用代码：{{creditCode}}
住所：{{ownerAddress}}
法定代表人：{{legalName}}
被授权人：上海宁达信息科技有限公司
授权期间：{{validFrom}}起至{{validUntil}}止。
授权种类：汽车订阅主合同及同份 PDF 的费用附件。

本企业在上述范围内授予办理权限。`;
function snapshot(patch:Partial<UnilateralLetterSnapshot>={}):UnilateralLetterSnapshot{return{
 authorityId:'authority-synthetic-001',ownerId:'owner-synthetic-001',ownerName:'上海晓浪网络科技有限公司',creditCode:'91310000TEST000001',ownerAddress:'上海市合成测试路1号',legalName:'合成法人',
 grantee:'上海宁达信息科技有限公司',validFrom:'2026-10-21T16:00:00.000Z',validUntil:'2027-10-21T15:59:59.000Z',documentKinds:['SUBSCRIPTION_WITH_FEES'],templateId:'template-synthetic-001',templateVersion:1,templateHash:digest(template),templateContent:template,...patch,
};}
function withTemplate(value:string){return snapshot({templateContent:value,templateHash:digest(value)});}

test('fixed Ningda grantee and original Xiaolang owner survive rendering with explicit Beijing period',()=>{
 const result=resolveUnilateralLetter(snapshot());
 assert.match(result.body,/授权人：上海晓浪网络科技有限公司/);
 assert.match(result.body,/被授权人：上海宁达信息科技有限公司/);
 assert.ok(result.body.includes('2026年10月22日 00:00:00（北京时间）'));
 assert.ok(result.body.includes('2027年10月21日 23:59:59（北京时间）'));
 assert.ok(!result.body.includes('{{'));
 assert.equal(result.bodyHash,digest(result.body));
});

test('wrong recipient cannot be supplied through snapshot or approved-looking template',()=>{
 assert.throws(()=>resolveUnilateralLetter(snapshot({grantee:'上海晓浪网络科技有限公司'})));
 assert.throws(()=>resolveUnilateralLetter(withTemplate(template.replace('被授权人：上海宁达信息科技有限公司','被授权人：上海晓浪网络科技有限公司'))));
 assert.throws(()=>resolveUnilateralLetter(withTemplate(template+'\n被授权人：上海晓浪网络科技有限公司')));
 assert.throws(()=>resolveUnilateralLetter(withTemplate(template.replace('被授权人：上海宁达信息科技有限公司','被授权人：{{grantee}}'))));
});

test('snapshot template hash and version are checked before a document can be resolved',()=>{
 assert.throws(()=>resolveUnilateralLetter(snapshot({templateContent:template+'\n追加未经确认的授权。'})));
 assert.throws(()=>resolveUnilateralLetter(snapshot({templateVersion:0})));
 assert.throws(()=>resolveUnilateralLetter(snapshot({templateId:''})));
});

test('unknown, incomplete, missing, or nested template tokens cannot reach signed text',()=>{
 for(const value of [template+'\n{{customer_id}}',template+'\n{{ownerName}',template+'\n{ownerName}}',template.replace('{{legalName}}',''),template.replace('{{ownerName}}','{{ ownerName }}')]){
  assert.throws(()=>resolveUnilateralLetter(withTemplate(value)));
 }
 assert.throws(()=>resolveUnilateralLetter(snapshot({ownerName:'企业{{legalName}}'})));
 assert.throws(()=>resolveUnilateralLetter(snapshot({ownerAddress:'上海\n被授权人：其他企业'})));
});

test('letter refuses unsupported scope or ambiguous and reversed periods',()=>{
 for(const documentKinds of [[],['AMENDMENT'],['SUBSCRIPTION_WITH_FEES','AMENDMENT'],['SUBSCRIPTION_WITH_FEES','SUBSCRIPTION_WITH_FEES']])assert.throws(()=>resolveUnilateralLetter(snapshot({documentKinds})));
 for(const validFrom of ['2026-10-21T16:00:00','not-a-date','2028-10-21T16:00:00Z','2026-02-30T16:00:00Z','2026-10-21T24:00:00Z'])assert.throws(()=>resolveUnilateralLetter(snapshot({validFrom})));
 assert.throws(()=>resolveUnilateralLetter(snapshot({validUntil:'2026-10-21T16:00:00.000Z'})));
});

test('one owner-only stamp box stays on a separate final signing page and uses the actual centre',async()=>{
 const fonts=['C:/Windows/Fonts/simhei.ttf','../../.runtime/delivery-delay-pdf-qa/fonts/NotoSansCJK-Regular.ttc'].filter(existsSync);
 assert.ok(fonts.length,'CJK font fixture is required');
 const originalText=PDFDocument.prototype.text,originalRect=PDFDocument.prototype.rect;
 const texts:{text:string;page:unknown}[]=[],boxes:{x:number;y:number;width:number;height:number;page:unknown;pageWidth:number;pageHeight:number}[]=[];
 PDFDocument.prototype.text=function(value:any,...args:any[]){texts.push({text:String(value),page:this.page});return(originalText as any).call(this,value,...args);};
 PDFDocument.prototype.rect=function(x:number,y:number,width:number,height:number){boxes.push({x,y,width,height,page:this.page,pageWidth:this.page.width,pageHeight:this.page.height});return originalRect.call(this,x,y,width,height);};
 try{for(const font of fonts)for(const repetitions of [0,40]){
  texts.length=0;boxes.length=0;
  const result=await renderUnilateralLetter(withTemplate(template+'\n\n'+('合成测试：本段用于验证正文跨页后签章位置。\n'.repeat(repetitions))),font);
  assert.equal(result.buffer.subarray(0,5).toString(),'%PDF-');
  assert.equal(result.slotCoordinates.length,1);assert.equal(boxes.length,1);
  const slot=result.slotCoordinates[0],box=boxes[0];
  assert.ok(slot.pagenum>=1);
  assert.ok(texts.some(t=>t.page===box.page&&t.text==='授权人签署页'));
  assert.ok(texts.some(t=>t.page===box.page&&t.text==='上海晓浪网络科技有限公司（企业电子签章）'));
  assert.ok(!texts.some(t=>t.text.includes('宁达信息科技有限公司（企业电子签章）')));
  assert.ok(texts.some(t=>t.text==='第 1 / '+(slot.pagenum+1)+' 页'));
  assert.ok(Math.abs(slot.x/800*box.pageWidth-(box.x+box.width/2))<0.01);
  assert.ok(Math.abs(slot.y/1131*box.pageHeight-(box.y+box.height/2))<0.01);
  assert.ok(box.width>=144&&box.height>=144);
  assert.ok(box.y+box.height<box.pageHeight-45);
  assert.ok(!texts.some(t=>/^#{1,6}\s/.test(t.text)||t.text.includes('{{')));
 }}finally{PDFDocument.prototype.text=originalText;PDFDocument.prototype.rect=originalRect;}
});

test('missing Chinese font does not silently produce an unreadable contract',async()=>{
 await assert.rejects(()=>renderUnilateralLetter(snapshot(),''));
});
