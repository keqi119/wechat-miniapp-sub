import type {CancellationPrintContext} from './renewal-cancellation-context';
import {renderRenewalCancellationBody} from '../order-renewals/cancellation-paper';
import PDFDocument from 'pdfkit';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {useCjkFont} from '../contract/pdf-font';
import {TerminationContext,validateTerminationForPrint,terminationPrintSections} from './termination';
import {ArchiveParty as Party,assertPartyDetails,partyPrintValue} from './parties';
export type AmendmentPrintContext={changeId:string;kind:string;quoteId:string;quoteRevision:number;contractId:string;originalContractId:string;originalContractNumber:string;originalArchiveVersionId:string;commercialHash:string;body:string;bodyHash:string;templateId:string;templateVersion:number;templateHash:string;rows:{label:string;value:string}[]};
type PrintInput={archive:{id:string;kind:string};version:{version:number;businessSnapshotHash:string;contractNumber?:string|null};template:{id:string;version:number;title:string;content:string};context:{requiredSigners:string[];partiesSnapshot:Party[];scopeSnapshot:unknown;businessSnapshot?:unknown;terminationContext?:TerminationContext;amendmentContext?:AmendmentPrintContext;cancellationContext?:CancellationPrintContext}};
type Row={label:string;value:string};
type Section={title:string;rows:Row[]};
const record=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const val=(v:unknown)=>typeof v==='string'||typeof v==='number'?String(v):'';
const cash=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)?`${(v/100).toFixed(2)} 元`:'';
const roles:Record<string,string>={CUSTOMER:'承租人',OWNER:'出租方',PLATFORM:'平台服务方'};
const terms:Record<string,string>={vehicleIdentification:'车辆标识',permittedUse:'车辆用途',conditionDisclosure:'车况披露',customerAddress:'承租人地址',mileageCarryRule:'里程结转',excessMileageCalculation:'超里程计算',usageCosts:'用车费用',insuranceDetails:'保险约定',maintenanceRule:'保养安排',serviceCoverage:'服务范围',handoverArrangement:'交还车安排',earlyTerminationRule:'提前终止',depositRefundRule:'押金退回',otherFees:'其他费用'};
export function buildOfflinePrintModel(input:PrintInput){
 const {archive,version,template,context}=input,b=record(context.businessSnapshot),scope=record(context.scopeSnapshot),commercial=record(b.commercialTerms),product=record(b.productSnapshot);
 const signers=context.requiredSigners.map(role=>{const p=context.partiesSnapshot.find(p=>p.role===role),name=p?.name?.trim();ensure(p?.partyId&&name,409,'PRINT_PARTIES_REQUIRED','请先核对已冻结的签署主体姓名或名称');if(p.subjectType)assertPartyDetails([p],[role]);return{role,label:roles[role]||role,name,details:partyPrintValue(p)};});
 if(archive.kind==='RENEWAL_CANCELLATION'){
  const c=context.cancellationContext,d=scope.document;
  ensure(c&&c.sourceHash===version.businessSnapshotHash&&d?.templateId===template.id&&d.templateVersion===template.version&&d.templateHash===hash(template.content)&&d.bodyHash===hash(d.content)&&d.content===renderRenewalCancellationBody(template.content,c.paper),409,'RENEWAL_CANCELLATION_PAPER_SOURCE','取消打印正文、模板或冻结来源不一致');
  return{title:template.title,number:version.contractNumber||archive.id,version:version.version,templateVersion:template.version,snapshotHash:version.businessSnapshotHash,sections:[{title:'签署主体',rows:signers.map(p=>({label:p.label,value:p.details}))},{title:'本次取消依据',rows:[{label:'原纸质合同编号',value:c.paper.original.contractNumber},{label:'续期报价标识（非合同编号）',value:c.paper.identity.quoteId},{label:'续期开始日',value:c.paper.renewal.startDate},{label:'取消原因',value:c.paper.reason}]}],body:d.content,usageAppendix:'',signers};
 }
 if(archive.kind==='ORDER_AMENDMENT'){
  const a=context.amendmentContext;
  ensure(a&&typeof a.originalContractNumber==='string'&&a.originalContractNumber.trim()&&!a.originalContractNumber.includes('\0')&&a.quoteId===scope.quoteId&&a.commercialHash===version.businessSnapshotHash&&a.templateId===template.id&&a.templateVersion===template.version&&a.templateHash===hash(template.content)&&typeof a.body==='string'&&a.body.trim()&&!/\{\{|\}\}/.test(a.body)&&a.bodyHash===hash(a.body)&&Array.isArray(a.rows)&&a.rows.every(row=>typeof row.label==='string'&&typeof row.value==='string'),409,'AMENDMENT_DOCUMENT_MISMATCH','补充协议的确认正文、模板或报价版本不一致');
  return{title:template.title,number:version.contractNumber||archive.id,version:version.version,templateVersion:template.version,snapshotHash:version.businessSnapshotHash,sections:[{title:'签署主体',rows:signers.map(p=>({label:p.label,value:p.details}))},{title:'本次变更依据',rows:[{label:'原合同编号',value:a.originalContractNumber},{label:'原合同资料版本',value:a.originalArchiveVersionId},{label:'补充协议编号',value:version.contractNumber||archive.id},{label:'报价版本',value:`${a.quoteId} · 第 ${a.quoteRevision} 版`},...a.rows]}],body:a.body,usageAppendix:'',signers};
 }
 const party=(role:string)=>context.partiesSnapshot.find(p=>p.role===role)?.name||'';
 const variables:Record<string,string>={customerName:party('CUSTOMER'),ownerName:party('OWNER'),lessorName:party('OWNER'),platformName:party('PLATFORM'),platformLegalEntityName:party('PLATFORM'),contractNumber:version.contractNumber||archive.id,monthlyFee:cash(b.monthlyFeeAmount),deposit:cash(b.depositAmount),termMonths:val(b.months),startDate:val(b.startDate).slice(0,10),vehicleIdentification:val(commercial.vehicleIdentification)};
 const termination=archive.kind==='TERMINATION'?validateTerminationForPrint(scope.terminationDetails,context.terminationContext!):null;
 if(termination){Object.assign(variables,{originalContractName:context.terminationContext!.originalContract!.name,originalContractNumber:context.terminationContext!.originalContract!.number,terminationReason:termination.reason,terminationEffectiveAt:new Date(termination.effectiveAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})});}
 let body=template.content;try{const parsed=JSON.parse(body);if(parsed&&typeof parsed.body==='string')body=parsed.body;}catch{}
 body=body.replace(/\{\{(\w+)\}\}/g,(match,key)=>variables[key]||match);ensure(body.trim()&&!/\{\{|\}\}/.test(body),409,'PRINT_TEMPLATE_INCOMPLETE','审定模板中仍有未填充内容，请核对模板和订单资料');
 const sections:Section[]=[{title:'签署主体',rows:signers.map(p=>({label:p.label,value:p.details}))}];
 if(termination)return{title:template.title,number:version.contractNumber||archive.id,version:version.version,templateVersion:template.version,snapshotHash:version.businessSnapshotHash,sections:[...sections,...terminationPrintSections(termination,context.terminationContext!)],body,usageAppendix:'',signers};
 const add=(title:string,rows:Row[])=>{const usable=rows.filter(r=>r.value);if(usable.length)sections.push({title,rows:usable});};
 add('订阅方案',[{label:'租期',value:b.months?`${b.months} 个月`:''},{label:'约定起租日期',value:val(b.startDate).slice(0,10)},{label:'月费',value:cash(b.monthlyFeeAmount)},{label:'押金',value:cash(b.depositAmount)},{label:'首期付款日',value:val(b.firstDueDate).slice(0,10)},{label:'每月里程',value:b.mileagePerMonthKm?`${b.mileagePerMonthKm} 公里`:''},{label:'超里程单价',value:cash(b.excessMileagePriceAmount)},{label:'能源说明',value:val(b.energyDescription)},{label:'适用条件',value:val(b.conditions)}]);
 add('车辆与服务约定',Object.entries(terms).map(([key,label])=>({label,value:val(commercial[key])})));
 add('合作范围',[{label:'车辆档案编号',value:Array.isArray(scope.vehicleIds)?scope.vehicleIds.join('、'):''},{label:'有效期',value:scope.validFrom&&scope.validUntil?`${scope.validFrom} 至 ${scope.validUntil}`:''}]);
 add('交接事实',[{label:'实际交接时间',value:b.actualAt?new Date(b.actualAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):''},{label:'里程读数',value:typeof b.readingKm==='number'?`${b.readingKm} 公里`:''},...(Array.isArray(b.checklist)?b.checklist.map((r:any)=>({label:val(r.label),value:val(r.value)})):[])]);
 const benefits=Array.isArray(product.benefits)?product.benefits:[];
 add('约定权益附件',benefits.map((item:any)=>({label:val(item.name),value:[val(item.description),item.kind==='COUNT'?`整单额度：${item.totalQuantity} ${item.unit}`:'说明型服务',item.provider?`提供方：${item.provider}`:'',item.conditions?`条件：${item.conditions}`:''].filter(Boolean).join('；')})));
 return{title:template.title,number:version.contractNumber||archive.id,version:version.version,templateVersion:template.version,snapshotHash:version.businessSnapshotHash,sections,body,usageAppendix:val(record(b.usagePolicy).content),signers};
}
export async function renderOfflineDocument(input:PrintInput,fontPath=process.env.CONTRACT_CJK_FONT_PATH):Promise<Buffer>{
 ensure(fontPath,503,'ARCHIVE_PRINT_FONT_REQUIRED','线下打印需配置中文字体');const model=buildOfflinePrintModel(input);
 const doc=new PDFDocument({size:'A4',margins:{top:46,bottom:46,left:48,right:48},bufferPages:true,info:{Title:model.title,Author:model.signers.find(p=>p.role==='PLATFORM')?.name||''}}),chunks:Buffer[]=[];
 const complete=new Promise<Buffer>((resolve,reject)=>{doc.on('data',(chunk:Buffer)=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 useCjkFont(doc,fontPath);const width=doc.page.width-96;
 const heading=(title:string)=>{if(doc.y>doc.page.height-120)doc.addPage();doc.moveDown(.8).fontSize(13).fillColor('#231815').text(title,{width}).moveDown(.35);};
 doc.fillColor('#231815').fontSize(20).text(model.title,{align:'center',width}).moveDown(.6).fontSize(9).fillColor('#666666').text(`合同编号：${model.number}    打印版本：${model.version}    模板版本：${model.templateVersion}`,{align:'center',width}).moveDown(.8);
 for(const section of model.sections){heading(section.title);for(const row of section.rows){doc.fontSize(10).fillColor('#231815').text(`${row.label}：${row.value}`,{width,lineGap:4,paragraphGap:5});}}
 heading('合同正文');doc.fontSize(10).text(model.body,{width,lineGap:5,paragraphGap:6});
 if(model.usageAppendix){heading('里程与退订规则附件');doc.fontSize(10).text(model.usageAppendix,{width,lineGap:5});}
 if(doc.y>doc.page.height-300)doc.addPage();heading('线下签署');doc.fontSize(9).text('请各签署方核对正文及附件后，在相应位置签字或盖章并填写日期。',{width}).moveDown();
 for(const signer of model.signers){if(doc.y>doc.page.height-140)doc.addPage();const y=doc.y;doc.lineWidth(.6).strokeColor('#cccccc').rect(48,y,width,78).stroke();doc.fontSize(10).fillColor('#231815').text(`${signer.label}：${signer.name}`,60,y+10,{width:width-24}).text('签字 / 盖章：',60,y+35,{width:width-24}).text('签署日期：________ 年 ____ 月 ____ 日',60,y+58,{width:width-24});doc.y=y+90;}
 const range=doc.bufferedPageRange();for(let i=range.start;i<range.start+range.count;i++){doc.switchToPage(i);const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;doc.fontSize(7).fillColor('#777777').text(`第 ${i+1} / ${range.count} 页  |  资料版本 ${model.version}  |  ${model.snapshotHash.slice(0,24)}`,48,doc.page.height-29,{width,align:'center',lineBreak:false});doc.page.margins.bottom=bottom;}
 doc.end();return complete;
}
