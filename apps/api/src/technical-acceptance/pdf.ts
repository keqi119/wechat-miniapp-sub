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
 const title='本文件双方签署区',slots=[{role:'CUSTOMER',label:'乙方本人签署',height:80},{role:'PLATFORM',label:'上海晓浪网络科技有限公司企业签章',height:150}];
 const textOptions={width:doc.page.width-doc.page.margins.left-doc.page.margins.right,lineGap:0};
 const topGap=doc.currentLineHeight(true)*2;
 // Measure with the selected font: Noto CJK and SimHei have different line
 // heights. A fixed allowance can push the second box into the page footer.
 doc.fontSize(12);let blockHeight=doc.heightOfString(title,textOptions)+doc.currentLineHeight(true);
 doc.fontSize(10);for(const slot of slots)blockHeight+=doc.heightOfString(slot.label,textOptions)+10+slot.height+24;
 if(doc.y+topGap+blockHeight>doc.page.height-doc.page.margins.bottom)doc.addPage();else doc.y+=topGap;
 doc.x=doc.page.margins.left;
 doc.fontSize(12).text(title,textOptions).moveDown();
 for(const{role,label,height}of slots){
  doc.fontSize(10).text(label,textOptions);
  const left=80,top=doc.y+10,width=180;
  // Fadada SearchLocation is the image CENTRE in an 800x1131 top-left grid.
  // Width/height describe the reserved PDF area, not unsupported provider scaling.
  slotCoordinates.push({slotId:'TECHNICAL_'+role,pageNumber:page,x:(left+width/2)/doc.page.width*800,y:(top+height/2)/doc.page.height*1131,width:width/doc.page.width*800,height:height/doc.page.height*1131,pdfPageWidth:doc.page.width,pdfPageHeight:doc.page.height,coordinateSource:'PDFKIT_RENDERER',coordinateSystem:'FADADA_800_1131_TOP_LEFT'});
  doc.rect(left,top,width,height).stroke();doc.y=top+height+24;
 }
 const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(range.start+i);const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;doc.fontSize(8).text(`第 ${i+1} / ${range.count} 页`,45,doc.page.height-28,{width:doc.page.width-90,align:'center',lineBreak:false});doc.page.margins.bottom=bottom;}
 doc.end();return{buffer:await done,slotCoordinates};
}
