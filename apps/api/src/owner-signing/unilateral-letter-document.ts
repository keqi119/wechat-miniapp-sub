import PDFDocument from 'pdfkit';
import {hash} from '../common/data';
import {ensure} from '../common/errors';
import {useCjkFont} from '../contract/pdf-font';

export const NINDA_AUTHORIZATION_GRANTEE='上海宁达信息科技有限公司';

export interface UnilateralLetterSnapshot {
 authorityId:string;
 ownerId:string;
 ownerName:string;
 creditCode:string;
 ownerAddress:string;
 legalName:string;
 grantee:string;
 validFrom:string;
 validUntil:string;
 documentKinds:string[];
 templateId:string;
 templateVersion:number;
 templateHash:string;
 templateContent:string;
}

const tokens=['authorityId','ownerName','creditCode','ownerAddress','legalName','validFrom','validUntil'] as const;
const invalid=(condition:unknown,message:string)=>ensure(condition,409,'OWNER_LETTER_DOCUMENT_INVALID',message);

function literal(value:unknown,label:string,max=500):string {
 invalid(typeof value==='string'&&value.length>0&&value.length<=max&&value===value.trim()&&!/[\u0000-\u001f\u007f-\u009f\u2028\u2029{}]/u.test(value),`${label}缺失或包含不可用于授权书的字符`);
 return value as string;
}

function dated(value:string):Date {
 invalid(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value),'授权期间须包含明确时区');
 const date=new Date(value);
 invalid(Number.isFinite(date.getTime()),'授权期间无效');
 const calendar=new Date(`${value.slice(0,10)}T00:00:00.000Z`);
 invalid(Number.isFinite(calendar.getTime())&&calendar.toISOString().slice(0,10)===value.slice(0,10)&&Number(value.slice(11,13))<24,'授权期间包含不存在的日期或时间');
 return date;
}

function beijing(date:Date):string {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
 return `${values.year}年${values.month}月${values.day}日 ${values.hour}:${values.minute}:${values.second}（北京时间）`;
}

/** Resolve only the approved template and frozen business inputs; the API app identity is never a grantee. */
export function resolveUnilateralLetter(snapshot:UnilateralLetterSnapshot):{body:string;bodyHash:string} {
 invalid(snapshot&&typeof snapshot==='object','授权书快照缺失');
 literal(snapshot.ownerId,'企业编号',128);literal(snapshot.templateId,'模板编号',128);
 invalid(Number.isInteger(snapshot.templateVersion)&&snapshot.templateVersion>0,'模板版本无效');
 invalid(typeof snapshot.templateContent==='string'&&snapshot.templateContent.length>0&&snapshot.templateContent.length<=100000,'授权书正文缺失或过长');
 invalid(snapshot.templateHash===hash(snapshot.templateContent),'授权书模板摘要不一致');
 invalid(snapshot.grantee===NINDA_AUTHORIZATION_GRANTEE,'授权书被授权人必须为上海宁达信息科技有限公司');
 invalid(Array.isArray(snapshot.documentKinds)&&snapshot.documentKinds.length===1&&snapshot.documentKinds[0]==='SUBSCRIPTION_WITH_FEES','本授权书仅支持订阅主合同及同份PDF费用附件');
 const from=dated(snapshot.validFrom),until=dated(snapshot.validUntil);
 invalid(from<until,'授权截止时间须晚于开始时间');
 const values:Record<(typeof tokens)[number],string>={
  authorityId:literal(snapshot.authorityId,'授权编号',128),ownerName:literal(snapshot.ownerName,'授权企业名称',200),
  creditCode:literal(snapshot.creditCode,'统一社会信用代码',64),ownerAddress:literal(snapshot.ownerAddress,'企业住所'),
  legalName:literal(snapshot.legalName,'法定代表人姓名',100),validFrom:beijing(from),validUntil:beijing(until),
 };
 const recipients=snapshot.templateContent.split(/\r?\n/).map(line=>line.trim().replace(/\*\*/g,'')).filter(line=>/^被授权人[：:]/u.test(line));
 invalid(recipients.length===1&&recipients[0]===`被授权人：${NINDA_AUTHORIZATION_GRANTEE}`,'授权书须载明唯一且固定的宁达被授权人');
 for(const token of tokens)invalid(snapshot.templateContent.includes(`{{${token}}}`),`授权书缺少必填字段：${token}`);
 const body=snapshot.templateContent.replace(/\{\{([^{}]+)\}\}/g,(_match,name:string)=>{
  invalid(tokens.includes(name as (typeof tokens)[number]),'授权书包含未允许的替换字段');
  return values[name as (typeof tokens)[number]];
 });
 invalid(!/[{}]/u.test(body),'授权书包含未解析的替换字段');
 return{body,bodyHash:hash(body)};
}

/** A single owner stamp on a dedicated final page. Coordinates use Fadada's zero-based 800x1131 centre grid. */
export async function renderUnilateralLetter(snapshot:UnilateralLetterSnapshot,font:string):Promise<{buffer:Buffer;body:string;bodyHash:string;slotCoordinates:Array<{pagenum:number;x:number;y:number}>}> {
 const resolved=resolveUnilateralLetter(snapshot);
 ensure(font,503,'CJK_FONT_REQUIRED','授权书中文字体未配置');
 const doc=new PDFDocument({size:'A4',margin:45,bufferPages:true});
 const chunks:Buffer[]=[];
 const done=new Promise<Buffer>((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 useCjkFont(doc,font);
 let page=0;doc.on('pageAdded',()=>page++);
 const lines=resolved.body.split(/\r?\n/),titleIndex=lines.findIndex(line=>/^# /.test(line));
 doc.fontSize(17).text(titleIndex>=0?lines[titleIndex].replace(/^# /,''):'企业车主单方用印授权书',{align:'center'}).moveDown();
 for(let index=0;index<lines.length;index++){
  if(index===titleIndex)continue;
  const line=lines[index];
  if(!line.trim()){doc.moveDown(0.35);continue;}
  const heading=/^#{1,6}\s+/.test(line),bold=/\*\*[^*]+\*\*/.test(line),plain=line.replace(/^#{1,6}\s+/,'').replace(/(?<!\*)\*\*([^*]+)\*\*(?!\*)/g,'$1');
  if(heading&&doc.y>doc.page.height-145)doc.addPage();
  doc.fontSize(heading?12:10).lineWidth(0.15).text(plain,{lineGap:4,stroke:heading||bold,fill:true}).lineWidth(1);
 }
 doc.addPage();
 doc.fontSize(16).text('授权人签署页',{align:'center'}).moveDown();
 doc.fontSize(10).text(`授权编号：${snapshot.authorityId}`,{lineGap:4});
 doc.text(`授权人：${snapshot.ownerName}`,{lineGap:4});
 doc.text(`被授权人：${NINDA_AUTHORIZATION_GRANTEE}`,{lineGap:4});
 doc.moveDown().text('本页为前述企业车主单方用印授权书的组成部分。由本企业法定代表人本人核对完整文件后，以本企业身份完成电子签署。签署时间以电子签署记录为准。',{lineGap:4});
 doc.moveDown().text('正文摘要（SHA-256）：',{lineGap:4});
 doc.fontSize(8).text(resolved.bodyHash,{lineGap:4}).moveDown(2);
 doc.fontSize(11).text(`${snapshot.ownerName}（企业电子签章）`,{lineGap:4});
 const left=80,top=doc.y+15,width=180,height=180;
 invalid(top+height<=doc.page.height-60,'授权书签章区域超出页面');
 doc.rect(left,top,width,height).stroke();
 const slotCoordinates=[{pagenum:page,x:(left+width/2)/doc.page.width*800,y:(top+height/2)/doc.page.height*1131}];
 const range=doc.bufferedPageRange();
 for(let index=0;index<range.count;index++){
  doc.switchToPage(range.start+index);const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;
  doc.fontSize(8).text(`第 ${index+1} / ${range.count} 页`,45,doc.page.height-28,{width:doc.page.width-90,align:'center',lineBreak:false});
  doc.page.margins.bottom=bottom;
 }
 doc.end();
 return{buffer:await done,...resolved,slotCoordinates};
}
