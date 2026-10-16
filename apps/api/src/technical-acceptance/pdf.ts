import PDFDocument from 'pdfkit';
import {useCjkFont} from '../contract/pdf-font';
import {ensure} from '../common/errors';
export async function renderTechnicalPdf(body:string,font?:string){
 ensure(font,503,'CJK_FONT_REQUIRED','验收文档中文字体未配置');
 const doc=new PDFDocument({size:'A4',margin:45,bufferPages:true});let page=0;const chunks:Buffer[]=[],slotCoordinates:any[]=[];
 const done=new Promise<Buffer>((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 doc.on('pageAdded',()=>page++);useCjkFont(doc,font);
 const lines=body.split(/\r?\n/),first=lines.findIndex(line=>/^# /.test(line));
 doc.fontSize(17).text(first>=0?lines[first].replace(/^# /,''):'电子签署流程验证确认书',{align:'center'}).moveDown();
 for(let i=0;i<lines.length;i++){if(i===first)continue;const line=lines[i];if(!line.trim()){doc.moveDown(0.35);continue;}const heading=/^#{1,6}\s+/.test(line),bold=/\*\*[^*]+\*\*/.test(line),plain=line.replace(/^#{1,6}\s+/,'').replace(/(?<!\*)\*\*([^*]+)\*\*(?!\*)/g,'$1');
 if(heading&&doc.y>doc.page.height-140)doc.addPage();doc.fontSize(heading?12:bold?10.5:10);doc.lineWidth(0.15);doc.text(plain,{lineGap:4,stroke:heading||bold,fill:true});doc.lineWidth(1);
 }
 if(doc.y>doc.page.height-290)doc.addPage();else doc.moveDown(2);
 doc.fontSize(12).text('本文件双方签署区').moveDown();
 for(const[role,label]of[['CUSTOMER','乙方本人签署'],['PLATFORM','上海晓浪网络科技有限公司企业签章']]){doc.fontSize(10).text(label);const y=doc.y+10;slotCoordinates.push({slotId:'TECHNICAL_'+role,pageNumber:page,x:80/doc.page.width*800,y:y/doc.page.height*1131,coordinateSource:'PDFKIT_RENDERER',coordinateSystem:'FADADA_800_1131_TOP_LEFT'});doc.rect(80,y,180,65).stroke();doc.y=y+85;}
 const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(range.start+i);const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;doc.fontSize(8).text(`第 ${i+1} / ${range.count} 页`,45,doc.page.height-28,{width:doc.page.width-90,align:'center',lineBreak:false});doc.page.margins.bottom=bottom;}
 doc.end();return{buffer:await done,slotCoordinates};
}
