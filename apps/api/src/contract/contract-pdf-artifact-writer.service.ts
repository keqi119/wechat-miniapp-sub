import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { resolve, sep } from 'node:path';
import PDFDocument from 'pdfkit';
import { Db } from '../common/db';
import { projectRoot } from '../common/config';
import { ensure } from '../common/errors';
import { fen } from '../common/data';
import { ContractPdfRendererService } from './contract-pdf-renderer.service';
import { createStage1ContractPdfSigningSlots } from './contract-pdf-render-model';
import { assertApprovedText, decryptIdentity } from '../esign/fadada/fadada-safety';
import { approvedTemplate, commercialSnapshot, resolveSubscriptionTemplate, resolveHandoverTemplate } from './contract-template';
import type { FadadaSettings } from '../esign/esign.settings';
export type SignatureKind = 'SUBSCRIPTION' | 'HANDOVER';
export class ContractPdfArtifactWriterService {
  private root = resolve(process.env.UPLOAD_DIR || resolve(projectRoot, 'var/uploads'));
  constructor(private db: Db, private renderer = new ContractPdfRendererService()) {}
  async readVerified(fileId: string, expectedHash: string): Promise<Buffer> {
    const file = await this.db.storedFile.findUnique({ where: { id: fileId } });
    ensure(file && file.mimeType === 'application/pdf' && file.sha256 === expectedHash && resolve(file.storagePath).startsWith(this.root+sep),409,'ARTIFACT_HASH_MISMATCH','签署文档元数据不匹配');
    const bytes = await fs.readFile(file.storagePath);
    ensure(bytes.subarray(0,5).toString()==='%PDF-' && bytes.length === file.size && createHash('sha256').update(bytes).digest('hex')===expectedHash,409,'ARTIFACT_HASH_MISMATCH','签署文档已变化或无法核验');
    return bytes;
  }
  async persistPdf(buffer: Buffer, input: { customerId: string; name: string; purpose: string }) {
    ensure(buffer.subarray(0,5).toString()==='%PDF-' && buffer.length > 50 && buffer.length <= 20*1024*1024,400,'ARTIFACT_PDF_REQUIRED','必须提供有效且不超过20MB的PDF');
    const sha256=createHash('sha256').update(buffer).digest('hex');
    const storagePath=resolve(this.root,sha256.slice(0,2),sha256);
    await fs.mkdir(resolve(this.root,sha256.slice(0,2)),{ recursive:true });
    try { await fs.writeFile(storagePath,buffer,{ flag:'wx', mode:0o600 }); }
    catch(error:any) { if(error.code!=='EEXIST')throw error;ensure((await fs.readFile(storagePath)).equals(buffer),409,'ARTIFACT_HASH_MISMATCH','归档路径已有不同内容'); }
    return this.db.storedFile.create({ data: { ...input, name: input.name.replace(/[\\/\r\n]/g,'_').slice(0,200), mimeType:'application/pdf', size:buffer.length, sha256, storagePath } });
  }
  async resource(kind: SignatureKind, resourceId: string) {
    const result = kind==='SUBSCRIPTION' ? await this.db.contract.findUnique({ where:{id:resourceId}, include:{order:{include:{customer:true,vehicle:true}}} }) : await this.db.handover.findUnique({ where:{id:resourceId}, include:{order:{include:{customer:true,vehicle:true}}} });
    ensure(result,404,'NOT_FOUND','签署业务记录不存在');
    return result as any;
  }
  async prepare(kind: SignatureKind, resourceId: string, settings: FadadaSettings) {
    const resource = await this.resource(kind,resourceId);
    ensure(!resource.providerTaskId && (kind==='SUBSCRIPTION' ? resource.status==='DRAFT' : resource.status==='CUSTOMER_CONFIRMED' && resource.signatureStatus==='DRAFT'),409,'ARTIFACT_PROTECTED','签署已发起或业务状态不可重新生成文档');
    const account = await this.db.eSignAccount.findUnique({where:{customerId:resource.customerId}});
    ensure(account?.identityCiphertext,409,'REALNAME_REQUIRED','请先完成实名资料核验');
    const identity=decryptIdentity(account.identityCiphertext,resource.customerId,settings.identityEncryptionKey);
    const legal = kind==='SUBSCRIPTION' && resource.documentId ? await this.db.legalDocument.findUnique({where:{id:resource.documentId}}) : await this.db.legalDocument.findFirst({where:{type:kind==='SUBSCRIPTION'?'subscription':'handover',status:'PUBLISHED'},orderBy:{version:'desc'}});
    approvedTemplate(legal);
    ensure(legal!.type===(kind==='SUBSCRIPTION'?'subscription':'handover'),409,'LEGAL_TYPE_MISMATCH','正式文案类型与签署业务不一致');
    const evidence=kind==='HANDOVER'?await this.db.storedFile.findMany({where:{id:{in:resource.fileIds}}}):[];
    const files=kind==='HANDOVER'?resource.fileIds.map((id:string)=>evidence.find(file=>file.id===id)).filter(Boolean):[];
    ensure(kind!=='HANDOVER'||files.length===resource.fileIds.length,409,'EVIDENCE_MISSING','交接附件缺失');
    const mainContract=kind==='HANDOVER'?await this.db.contract.findFirst({where:{orderId:resource.orderId,customerId:resource.customerId,status:'SIGNED'},orderBy:{createdAt:'desc'}}):null;
    const body=kind==='SUBSCRIPTION'?resolveSubscriptionTemplate(legal!.content,resource,identity,legal!.version):resolveHandoverTemplate(legal!.content,resource,identity,mainContract?.id||'',files);
    assertApprovedText({...legal,content:body});
    if(kind==='SUBSCRIPTION')ensure(!resource.body || resource.body===legal!.content || resource.body===body,409,'DOCUMENT_BODY_MISMATCH','合同正文与审定版本不一致');
    const snapshot=resource.order.finalPlanSnapshot as Record<string,unknown>;
    const commercial=kind==='SUBSCRIPTION'?commercialSnapshot(snapshot):null;
    const appendix=[{label:'月度订阅费',value:fen(snapshot.monthlyFeeAmount as number)},{label:'押金',value:fen(snapshot.depositAmount as number)},{label:'订阅期限',value:String(snapshot.months)+'个月'},{label:'每月里程额度',value:String(snapshot.mileagePerMonthKm)+'公里'},{label:'超里程单价',value:fen(snapshot.excessMileagePriceAmount as number)+'/公里'},{label:'能源说明',value:String(snapshot.energyDescription)},{label:'权益',value:Array.isArray(snapshot.benefits)?snapshot.benefits.join('；'):''},{label:'使用条件',value:String(snapshot.conditions)},{label:'起租日期',value:String(snapshot.startDate).slice(0,10)},{label:'首期付款日',value:String(snapshot.firstDueDate).slice(0,10)},{label:'最终方案摘要',value:String(snapshot.commercialHash)}];
    let rendered: {buffer:Buffer;slotCoordinates:any[]};
    if(kind==='SUBSCRIPTION') rendered=await this.renderer.render({contractId:resource.id,contractNo:resource.id,orderNo:resource.orderId,generatedAt:resource.createdAt.toISOString(),contentTemplate:body,templateName:legal!.title,templateVersion:String(legal!.version),signingStage:'STAGE1_CONTRACT',signingSlots:createStage1ContractPdfSigningSlots(),subscriberParty:{subscriberName:identity.name,subscriberIdNumber:identity.idCardNo,subscriberContactPhone:resource.order.customer.mobile,subscriberContactAddress:commercial!.terms.customerAddress,subscriberContactName:identity.name,subscriberEmail:'',subscriberWechat:''},appendix:{sections:[{title:'服务提供方',rows:[{label:'主体',value:'上海晓浪网络科技有限公司'}]},{title:'最终订阅方案',rows:appendix}]}},{cjkFontPath:settings.cjkFontPath});
    else rendered=await this.renderHandover(resource,{...legal,content:body},identity,settings.cjkFontPath);
    const file=await this.persistPdf(rendered.buffer,{customerId:resource.customerId,name:`${resource.id}-source.pdf`,purpose:'contract'});
    if(kind==='SUBSCRIPTION') await this.db.serial(async tx=>{const current=await tx.contract.findUniqueOrThrow({where:{id:resource.id}});ensure(!current.providerTaskId&&current.status==='DRAFT'&&current.documentHash===resource.documentHash,409,'DOCUMENT_MISMATCH','准备期间合同已变化');await tx.contract.update({where:{id:resource.id},data:{sourceFileId:file.id,documentId:legal!.id,templateVersion:legal!.version,body}});});
    return { resource, file, slotCoordinates: rendered.slotCoordinates, documentHash:kind==='SUBSCRIPTION'?resource.documentHash:resource.manifestHash };
  }
  private async renderHandover(resource:any,legal:any,identity:any,font?:string) {
    ensure(font,503,'CJK_FONT_REQUIRED','正式交接单中文字体未配置');
    const doc=new PDFDocument({size:'A4',margin:45,bufferPages:true});
    const chunks:Buffer[]=[];let page=0;const coordinates:any[]=[];
    const done=new Promise<Buffer>((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
    doc.on('pageAdded',()=>{page+=1;});doc.font(font);
    doc.fontSize(18).text('车辆交接确认单',{align:'center'}).moveDown();doc.fontSize(10).text(`文案版本 ${legal.version}\n交接编号 ${resource.id}\n订单编号 ${resource.orderId}\n服务方 上海晓浪网络科技有限公司\n客户 ${identity.name}\n证件 ${identity.idCardNo}\n证据清单摘要 ${resource.manifestHash}\n客户事实确认时间 ${resource.confirmedAt?.toISOString()||''}\n现场累计里程 ${resource.readingKm} km`).moveDown();doc.text(legal.content,{lineGap:4}).moveDown();
    doc.fontSize(12).text('交接清单与证据');doc.fontSize(10).text(JSON.stringify(resource.checklist,null,2));
    const files=await this.db.storedFile.findMany({where:{id:{in:resource.fileIds}}});ensure(files.length===resource.fileIds.length,409,'EVIDENCE_MISSING','交接附件缺失');
    for(const file of files){ensure(resolve(file.storagePath).startsWith(this.root+sep),409,'STORAGE_PATH','交接附件路径无效');const bytes=await fs.readFile(file.storagePath);ensure(createHash('sha256').update(bytes).digest('hex')===file.sha256,409,'EVIDENCE_HASH','交接附件已变化');doc.addPage();doc.fontSize(10).text(`证据 ${file.name}\n文件编号 ${file.id}\nSHA-256 ${file.sha256}`).moveDown();if(['image/jpeg','image/png'].includes(file.mimeType))doc.image(bytes,{fit:[490,620],align:'center'});}
    doc.addPage();doc.fontSize(12).text('独立交接签署区').moveDown();
    for(const [slotId,label] of [['STAGE2_HANDOVER_CUSTOMER','客户签署'],['STAGE2_HANDOVER_PLATFORM','上海晓浪网络科技有限公司盖章']]){doc.fontSize(11).text(label);const y=doc.y+20;coordinates.push({slotId,pageNumber:page,x:80/doc.page.width*800,y:y/doc.page.height*1131,coordinateSource:'PDFKIT_RENDERER',coordinateSystem:'FADADA_800_1131_TOP_LEFT'});doc.rect(80,y,180,65).stroke();doc.y=y+100;}
    doc.end();return {buffer:await done,slotCoordinates:coordinates};
  }
}
