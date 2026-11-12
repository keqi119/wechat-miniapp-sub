import {ensure} from '../common/errors';
import type {V31Node,V31Paragraph} from './template-map';
export interface V31Fonts{regular:{path:string;face?:string};bold:{path:string;face?:string};}
/** PDFKit layout shared by production and review samples. Every cell is measured before placement. */
export function renderV31Nodes(doc:PDFKit.PDFDocument,nodes:V31Node[],fonts:V31Fonts){
 const x=48,width=doc.page.width-96,bottom=()=>doc.page.height-48;
 const font=(bold:boolean)=>{const f=bold?fonts.bold:fonts.regular;return f.face?doc.font(f.path,f.face):doc.font(f.path);};
 const text=(p:V31Paragraph)=>p.runs.map(r=>r.text).join('');
 const height=(p:V31Paragraph,w:number)=>{font(p.runs.some(r=>r.bold));return doc.fontSize(10).heightOfString(text(p),{width:w,lineGap:3});};
 function draw(p:V31Paragraph,left:number,top:number,w:number){
  doc.x=left;doc.y=top;
  p.runs.forEach((r,i)=>{font(r.bold);doc.fontSize(10).fillColor('#111111').text(r.text,{width:w,lineGap:3,continued:i<p.runs.length-1,underline:r.underline,align:p.alignment==='both'?'justify':p.alignment});});
 }
 for(const [index,n] of nodes.entries()){
  if(n.type==='paragraph'){
   if(!text(n).trim())continue;
   const h=height(n,width),heading=/^(第[一二三四五六七八九十百零\d]+条\s|附件[一二三四五六七八九十\d：:]|获准使用的)/.test(text(n).trim());
   const next=nodes.slice(index+1).find(v=>v.type==='table'||text(v).trim());
   const nextHeight=next?.type==='paragraph'?Math.min(height(next,width),90):60;
   const reserve=/^(签署栏|独立授权签署栏)$/.test(text(n).trim())?150:heading?h+nextHeight+12:h;
   if(doc.y+reserve>bottom()&&h<bottom()-48)doc.addPage();
   draw(n,x,doc.y,width);doc.x=x;doc.moveDown(.45);
  }else{
   for(const row of n.rows){
    const total=n.widths.reduce((a,b)=>a+b,0);let grid=0;
    const cells=row.map(cell=>{const w=n.widths.slice(grid,grid+cell.span).reduce((a,b)=>a+b,0)/total*width;grid+=cell.span;return{...cell,w};});
    // Split long rows into paragraph-sized bands. Each band repeats the table grid and never clips.
    const remaining=cells.map(c=>c.paragraphs.flatMap(p=>{
     if(height(p,c.w-12)<bottom()-70)return[p];
     const output:V31Paragraph[]=[];let runs:V31Paragraph['runs']=[];
     for(const r of p.runs)for(const chunk of r.text.split(/(?<=\n)/)){const next=[...runs,{...r,text:chunk}];if(runs.length&&height({...p,runs:next},c.w-12)>500){output.push({...p,runs});runs=[];}runs.push({...r,text:chunk});}
     if(runs.length)output.push({...p,runs});return output;
    }));
    while(remaining.some(parts=>parts.length)){
     const band=cells.map((c,i)=>remaining[i].shift()),h=Math.max(20,...band.map((p,i)=>p?height(p,cells[i].w-12)+12:20));
     ensure(h<bottom()-48,409,'V31_TABLE_CELL_TOO_LONG','表格单元过长，请按事实条目拆分');
     if(doc.y+h>bottom())doc.addPage();const top=doc.y;let left=x;
     for(const [i,c] of cells.entries()){doc.lineWidth(.5).strokeColor('#777777').rect(left,top,c.w,h).stroke();if(band[i])draw(band[i]!,left+6,top+6,c.w-12);left+=c.w;}
     doc.x=x;doc.y=top+h;
    }
   }
   doc.moveDown(.6);
  }
 }
}
