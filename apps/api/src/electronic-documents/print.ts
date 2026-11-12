import PDFDocument from 'pdfkit';
import {hash} from '../common/data';
import {ensure} from '../common/errors';
import {NINDA_PLATFORM_LEGAL_ENTITY} from '../common/platform-legal-entity';
import {useCjkFont} from '../contract/pdf-font';
import {assertPartyDetails,partyPrintValue,ArchiveParty} from '../offline-documents/parties';
import {assertElectronicParties,requiredSignerRoles} from './policy';
import type {ElectronicDocumentKind,SignerRole} from './types';
import type {ElectronicPosition} from './provider';
import {buildV31Document,type V31RenderSnapshot} from '../contract-terms/render-model';
import {paragraphs,validateV31Template,v31TemplateType} from '../contract-terms/template-map';
import {renderV31Nodes} from '../contract-terms/pdf-layout';
import {validateVirtualPrintProof,VIRTUAL_PRECEDENCE,VIRTUAL_WRAPPER_VERSION,type VirtualPrintProof} from '../virtual-acceptance/wrapper';
import {VIRTUAL_NOTICE} from '../virtual-acceptance/scope';

export type ElectronicSection={title:string;rows:{label:string;value:string}[]};
export interface ElectronicPrintInput{
 kind:ElectronicDocumentKind;number:string;version:number;businessHash:string;template:any;
 parties:ArchiveParty[];sections:ElectronicSection[];variables:Record<string,string>;usageAppendix?:string;v31Snapshot?:V31RenderSnapshot;virtualAcceptance?:VirtualPrintProof;
}
export function electronicTemplateType(kind:ElectronicDocumentKind){
 requiredSignerRoles(kind);
 if(['DELIVERY_DELAY','VEHICLE_SWAP','RENEWAL'].includes(kind))return'ELECTRONIC_ORDER_AMENDMENT';
 if(['PRE_DELIVERY_CANCELLATION','EARLY_TERMINATION'].includes(kind))return'ELECTRONIC_TERMINATION';
 return`ELECTRONIC_${kind}`;
}
export function approvedElectronicBody(template:any,kind:ElectronicDocumentKind){
 if(template?.type?.startsWith('ELECTRONIC_V31_')){
  ensure(template.type===v31TemplateType(kind)&&template.status==='PUBLISHED'&&template.confirmedBy&&template.confirmedAt&&Number.isInteger(template.version)&&template.version>0,409,'LEGAL_NOT_APPROVED','请先审定并启用对应 V3.1 正文');
  const parsed=validateV31Template(JSON.parse(template.content));ensure(parsed.kind===kind,409,'V31_TEMPLATE_INVALID','模板种类不匹配');return paragraphs(parsed.nodes).map(p=>p.runs.map(r=>r.text).join('')).join('\n');
 }
 ensure(template?.type===electronicTemplateType(kind)&&template.status==='PUBLISHED'&&template.confirmedBy&&template.confirmedAt&&Number.isInteger(template.version)&&template.version>0,409,'LEGAL_NOT_APPROVED','请先审定并启用对应电子协议正文');
 let parsed:any;try{parsed=JSON.parse(template.content);}catch{}
 const roles=requiredSignerRoles(kind);
 ensure(parsed&&typeof parsed.body==='string'&&parsed.body.trim()&&Array.isArray(parsed.requiredSigners)&&parsed.requiredSigners.length===roles.length&&roles.every(r=>parsed.requiredSigners.includes(r)),409,'ELECTRONIC_TEMPLATE_INVALID','电子协议模板与实际签署角色不匹配');
 return parsed.body as string;
}
export function buildElectronicPrintModel(input:ElectronicPrintInput){
 const virtualAcceptance=input.virtualAcceptance?validateVirtualPrintProof(input.virtualAcceptance,input):undefined;
 const roles=requiredSignerRoles(input.kind);assertElectronicParties(input.parties.map(p=>({role:p.role as SignerRole,subjectId:p.partyId})),input.kind);assertPartyDetails(input.parties,roles);
 ensure(input.parties.find(p=>p.role==='PLATFORM')?.name===NINDA_PLATFORM_LEGAL_ENTITY,409,'ELECTRONIC_PLATFORM_MISMATCH','平台协议主体必须为上海宁达信息科技有限公司');
 const byRole=(role:string)=>input.parties.find(p=>p.role===role)!.name!;
 const variables={...input.variables,contractNumber:input.number,customerName:roles.includes('CUSTOMER')?byRole('CUSTOMER'):'',ownerName:byRole('OWNER'),lessorName:byRole('OWNER'),platformName:byRole('PLATFORM')};
 const v31=input.template?.type?.startsWith('ELECTRONIC_V31_')?buildV31Document({kind:input.kind},input.v31Snapshot??{values:{}},input.template):null;
 const body=v31?paragraphs(v31.sections).map(p=>p.runs.map(r=>r.text).join('')).join('\n'):approvedElectronicBody(input.template,input.kind).replace(/\{\{(\w+)\}\}/g,(match,key)=>variables[key as keyof typeof variables]??match);
 const ownerName=input.parties.find(p=>p.role==='OWNER')?.name;
 const checkedText=virtualAcceptance&&ownerName? (body+JSON.stringify(input.sections)).split(ownerName).join(''):body+JSON.stringify(input.sections);
 ensure(!/\{\{|\}\}/.test(body)&&!/晓浪/.test(checkedText),409,'ELECTRONIC_TEMPLATE_INCOMPLETE','电子协议含未填内容或不符的业务主体');
 ensure(input.number&&input.number.length<=100&&Number.isInteger(input.version)&&input.version>0&&/^[a-f0-9]{64}$/.test(input.businessHash),409,'ELECTRONIC_DOCUMENT_INVALID','电子协议编号或冻结版本不完整');
 const labels:Record<string,string>={CUSTOMER:'承租人',OWNER:input.kind.startsWith('COOPERATION')?'合作方':'实际出租方',PLATFORM:'平台服务方'};
 return{...input,virtualAcceptance,body:virtualAcceptance?VIRTUAL_NOTICE+'\n'+VIRTUAL_PRECEDENCE+'\n'+body:body,structuredNodes:v31?.sections,signatureNotes:v31?.signatureNotes,signers:roles.map(role=>{const party=input.parties.find(p=>p.role===role)!;return{...party,role,label:v31?.roleLabels[role]??labels[role],details:partyPrintValue(party)};})};
}
/** Private formal PDF. Identity numbers are render inputs, never an electronic task JSON field. */
export async function renderElectronicDocument(input:ElectronicPrintInput,fontPath=process.env.CONTRACT_CJK_FONT_PATH){
 const model=buildElectronicPrintModel(input);ensure(fontPath,503,'CJK_FONT_REQUIRED','电子协议中文字体未配置');
 const doc=new PDFDocument({size:'A4',margins:{top:48,bottom:48,left:48,right:48},bufferPages:true,info:{Title:model.template.title,Author:NINDA_PLATFORM_LEGAL_ENTITY}}),chunks:Buffer[]=[];
 const ready=new Promise<Buffer>((resolve,reject)=>{doc.on('data',(c:Buffer)=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 useCjkFont(doc,fontPath);const width=doc.page.width-96;let page=0;doc.on('pageAdded',()=>page++);
 for(const fixed of input.v31Snapshot?.fixedTemplates??[]){ensure(hash(fixed.content)===fixed.hash,409,'V31_TEMPLATE_CHANGED','固定正文摘要不一致');doc.file(Buffer.from(fixed.content,'utf8'),{name:`V31-${fixed.id}-v${fixed.version}.json`,description:'获准完整固定三方订阅模板及带入映射'});}
 const heading=(title:string)=>{if(doc.y>doc.page.height-140)doc.addPage();doc.fontSize(12).fillColor('#1f2937').text(title,{width,paragraphGap:8}).moveDown(.2);};
 const prose=(content:string)=>{
  const lines=content.split(/\r?\n/);for(let i=0;i<lines.length;i++){
   const line=lines[i].trim();if(!line){doc.moveDown(.35);continue;}
   const isHeading=/^(?:#{1,6}\s|第[一二三四五六七八九十百0-9]+条|[一二三四五六七八九十]+[、\s])/.test(line),text=line.replace(/^#{1,6}\s+/,''),size=isHeading?12:10;
   doc.fontSize(size);const height=doc.heightOfString(text,{width,lineGap:4}),next=lines.slice(i+1).find(v=>v.trim())||'';
   const reserve=isHeading?height+Math.min(110,doc.fontSize(10).heightOfString(next,{width,lineGap:4}))+15:Math.min(height,doc.page.height-120);
   if(doc.y+reserve>doc.page.height-48)doc.addPage();
   doc.fontSize(size).fillColor('#222222').text(text,{width,lineGap:4,paragraphGap:isHeading?7:5});
  }
 };
 if(model.structuredNodes){
  if(model.virtualAcceptance){
   const boldPath=process.env.CONTRACT_CJK_BOLD_FONT_PATH||fontPath.replace('Regular.ttc','Bold.ttc');
   ensure(boldPath!==fontPath,503,'CJK_BOLD_FONT_REQUIRED','测试说明须配置真实中文粗体');
   doc.registerFont('virtual-wrapper-bold',boldPath,process.env.CONTRACT_CJK_BOLD_FONT_FACE||'NotoSansCJKsc-Bold');
   doc.font('virtual-wrapper-bold').fontSize(16).fillColor('#1f2937').text('虚拟验收测试说明',{width,paragraphGap:12});
   doc.fontSize(12).fillColor('#8b1a1a').text(VIRTUAL_NOTICE,{width,lineGap:4,paragraphGap:12});
   useCjkFont(doc,fontPath);prose(VIRTUAL_PRECEDENCE+'\n测试说明版本：'+VIRTUAL_WRAPPER_VERSION);
   doc.addPage();
  }
  const boldPath=process.env.CONTRACT_CJK_BOLD_FONT_PATH||fontPath.replace('Regular.ttc','Bold.ttc');
  ensure(boldPath!==fontPath,503,'CJK_BOLD_FONT_REQUIRED','V3.1重要条款须配置真实中文粗体');
  renderV31Nodes(doc,model.structuredNodes,{regular:{path:fontPath,face:process.env.CONTRACT_CJK_FONT_FACE||'NotoSansCJKsc-Regular'},bold:{path:boldPath,face:process.env.CONTRACT_CJK_BOLD_FONT_FACE||'NotoSansCJKsc-Bold'}});
 }else{
 doc.fontSize(19).text(model.template.title,{align:'center',width}).moveDown(.6).fontSize(9).fillColor('#555555').text(`协议编号：${model.number}    文件版本：${model.version}`,{width,align:'center'}).moveDown(1);
 heading('当事人信息');for(const signer of model.signers)doc.fontSize(10).fillColor('#222222').text(`${signer.label}：${signer.details}`,{width,lineGap:4,paragraphGap:7});
 for(const section of model.sections){heading(section.title);for(const row of section.rows)doc.fontSize(10).fillColor('#222222').text(`${row.label}：${row.value}`,{width,lineGap:4,paragraphGap:7});}
 heading('协议正文');prose(model.body);
 if(model.usageAppendix){heading('里程使用规则附件');prose(model.usageAppendix);}
 }
 // A dedicated page guarantees three large, non-overlapping, fully visible seal areas.
 doc.addPage();heading('电子签署页');doc.fontSize(9).fillColor('#555555').text('本签署页与前述正文及明细构成完整协议。各方核对全文后，通过本人实名账号签署；企业自动用印须具备有效授权。',{width,lineGap:4}).moveDown(1);
 if(model.signatureNotes)for(const p of paragraphs(model.signatureNotes))prose(p.runs.map(r=>r.text).join(''));
 const positions:Partial<Record<SignerRole,ElectronicPosition[]>>={};
 for(const signer of model.signers){
  const height=signer.subjectType==='ENTERPRISE'?150:90;const y=doc.y;
  if(y+height+48>doc.page.height-48)doc.addPage();
  const top=doc.y;doc.fontSize(10).fillColor('#222222').text(`${signer.label}：${signer.name}`,48,top,{width,lineGap:3});
  const boxY=doc.y+8,boxX=doc.page.width-48-190;
  doc.lineWidth(.5).strokeColor('#cbd5e1').rect(boxX,boxY,190,height).stroke();doc.fontSize(9).fillColor('#777777').text(signer.subjectType==='ENTERPRISE'?'企业电子签章':'本人电子签名',48,boxY+12,{width:width-215});
  positions[signer.role]=[{pagenum:page,x:Math.round((boxX+95)/doc.page.width*800*100)/100,y:Math.round((boxY+height/2)/doc.page.height*1131*100)/100}];doc.y=boxY+height+20;
 }
 const range=doc.bufferedPageRange();ensure(range.count<=100,409,'ELECTRONIC_DOCUMENT_TOO_LONG','电子协议页数过多，请核对明细');
 for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.page.margins.bottom=0;if(model.virtualAcceptance)doc.fontSize(8).fillColor('#8b1a1a').text(VIRTUAL_NOTICE,48,doc.page.height-42,{width,align:'center',lineBreak:false});doc.fontSize(7).fillColor('#777777').text(`${model.number} · 第 ${i+1} / ${range.count} 页 · 版本 ${model.version}`,48,doc.page.height-27,{width,align:'center',lineBreak:false});}
 doc.end();const buffer=await ready;ensure(buffer.length<=20*1024*1024,409,'ELECTRONIC_DOCUMENT_TOO_LARGE','电子协议超过渠道文件大小限制');return{buffer,positions,pageCount:range.count};
}
