import {refundStaff} from '../billing/refund-execution';
import {recordOnlineEvidenceOpened} from '../operations/online-handover';
import { Controller, Get, Inject, Param, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { Db } from '../common/db';
import { projectRoot } from '../common/config';
import { ensure } from '../common/errors';
import { audit } from '../common/data';
import {requirePartnerCapability} from '../partners/capabilities';
import {financialReadCapability} from '../partners/revenue-types';
import {readableFileName,uploadedFileName} from './filename';
const root = resolve(process.env.UPLOAD_DIR || resolve(projectRoot, 'var/uploads'));
const interceptor = FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
async function cooperationEvidence(tx:any,id:string){
 const legacy=await tx.partnerIdentityBinding.count({where:{evidenceFileIds:{has:id}}})||await tx.partnerVerification.count({where:{evidenceFileIds:{has:id}}})||await tx.partnerVehicleBindingProposal.count({where:{evidenceFileId:id}})||await tx.ownerVehicle.count({where:{evidenceFileId:id}})||await tx.partnerVehicleBindingHistory.count({where:{evidenceFileId:id}});
 if(legacy)return true;
 const evidence=(payload:any):boolean=>!!payload&&typeof payload==='object'&&Object.entries(payload).some(([key,value])=>['subjectEvidenceFileIds','authorizationEvidenceFileIds','evidenceFileIds'].includes(key)&&Array.isArray(value)&&value.includes(id)||typeof value==='object'&&(Array.isArray(value)?value.some(evidence):evidence(value)));
 const [drafts,submissions]=await Promise.all([tx.partnerCooperationDraft.findMany({select:{payload:true}}),tx.partnerCooperationSubmission.findMany({select:{subjectEvidenceFileIds:true,representatives:true,domainVersions:true}})]);
 return drafts.some((row:any)=>evidence(row.payload))||submissions.some(evidence);
}
/** The same retained private bindings govern media reads and publication readiness. */
export async function filePrivacyBoundary(tx:any,id:string){
 ensure(!await tx.electronicFileQuarantine.count({where:{fileId:id}}),403,'ELECTRONIC_QUARANTINE_PRIVATE','隔离签署证据不可通过普通文件入口读取');
 const [financial,archive,source,insurance,cooperation,agreement,asset,renewalEvidence,vehicleDocument,inspection]=await Promise.all([tx.partnerSettlementFile.findUnique({where:{fileId:id}}),tx.archiveFile.count({where:{fileId:id}}),tx.archiveVersion.count({where:{sourceFileId:id}}),tx.insurancePolicyFile.count({where:{fileId:id}}),cooperationEvidence(tx,id),tx.partnerAgreementVersion.count({where:{fileIds:{has:id}}}),tx.assetPrivateFile.findUnique({where:{fileId:id},select:{fileId:true}}),tx.orderRenewalCancellation.count({where:{OR:[{signatureEvidenceFileIds:{has:id}},{mutualAgreementEvidenceFileIds:{has:id}}]}}),tx.vehicleDocumentFile.count({where:{fileId:id}}),tx.vehicleInspectionFile.count({where:{fileId:id}})]);
 const lifecycleEvidence=await tx.renewalCancellationFact.count({where:{payload:{path:['evidence'],array_contains:[{id}]}}});
 return{financial,asset,inspection:!!inspection,vehicleDocument:!!vehicleDocument,versioned:!!(archive||source||insurance||agreement),cooperation,renewalEvidence:!!(renewalEvidence||lifecycleEvidence)};
}
function validMime(buffer: Buffer, mime: string) {
  if (mime === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'application/pdf') return buffer.subarray(0, 5).toString() === '%PDF-';
  return false;
}
@Controller()
export class FilesController {
  constructor(@Inject(Db) private db: Db) {}
  private fileBoundary(id:string){return filePrivacyBoundary(this.db,id);}
  @Post('customer/files') @UseInterceptors(interceptor) customerUpload(@UploadedFile() file: Express.Multer.File, @Req() request: any) { return this.upload(file, request, true); }
  @Post('admin/files') @UseInterceptors(interceptor) adminUpload(@UploadedFile() file: Express.Multer.File, @Req() request: any) { return this.upload(file, request, false); }
  private async upload(file: Express.Multer.File, request: any, customer: boolean) {
    ensure(file && validMime(file.buffer, file.mimetype), 400, 'FILE_TYPE', '仅支持内容有效的PNG/JPEG/PDF文件');
    const purpose = String(request.body.purpose || 'evidence'); ensure(['profile','identity','evidence','refund-bank','contract','vehicle','handover','mileage','service'].includes(purpose), 400, 'FILE_PURPOSE', '附件用途无效'); ensure(!customer || !['vehicle','contract'].includes(purpose), 403, 'FILE_PURPOSE', '该用途仅后台可上传');
    if(!customer&&purpose==='refund-bank')await refundStaff(this.db,request.admin);
    if(!customer&&purpose==='identity'&&!['ADMIN','OPERATIONS'].includes(request.admin.role))await requirePartnerCapability(this.db,request.admin,'partner.cooperation.write');
    ensure(customer || request.admin.role !== 'FINANCE' || ['evidence','refund-bank','identity'].includes(purpose), 403, 'FILE_PURPOSE', '财务仅可上传费用证据或获授的合作核验材料');
    const sha256 = createHash('sha256').update(file.buffer).digest('hex'); const path = resolve(root, sha256.slice(0, 2), sha256); await fs.mkdir(resolve(root, sha256.slice(0, 2)), { recursive: true }); await fs.writeFile(path, file.buffer, { flag: 'w', mode: 0o600 });
    const stored = await this.db.storedFile.create({ data: { name: uploadedFileName(file.originalname), mimeType: file.mimetype, size: file.size, sha256, storagePath: path, purpose, customerId: customer ? request.customer.id : null, adminId: customer ? null : request.admin.id } });
    await audit(this.db, customer ? request.customer.id : request.admin.id, 'UPLOAD', 'files', stored.id, { purpose, size: stored.size, sha256 }, customer ? 'CUSTOMER' : 'ADMIN');
    return { id: stored.id, name: stored.name, url: `/api/${customer ? 'customer' : 'admin'}/files/${stored.id}`, mimeType: stored.mimeType, size: stored.size };
  }
  @Get('customer/files/:id') async customerRead(@Param('id') id: string, @Req() request: any, @Res() response: any) {
    const file = await this.db.storedFile.findUnique({ where: { id } }); ensure(file, 404, 'NOT_FOUND', '附件不存在');ensure(file.purpose!=='electronic-quarantine',403,'ELECTRONIC_QUARANTINE_PRIVATE','隔离签署证据不可通过普通文件入口读取'); ensure(file.purpose!=='vehicle-inspection',403,'VEHICLE_INSPECTION_ROUTE_REQUIRED','请从所属车辆查验资料读取文件'); ensure(file.purpose!=='vehicle-document',403,'VEHICLE_DOCUMENT_ROUTE_REQUIRED','请从所属车辆原件档案读取文件'); ensure(!['asset-baas','asset-depreciation','asset-cost','asset-plate','asset-residual-observation','asset-valuation','asset-work-order','asset-work-order-cost'].includes(file.purpose),403,'ASSET_FILE_ROUTE_REQUIRED','请从所属资产资料读取文件'); ensure(!['offline-archive','offline-source','insurance','partner-settlement'].includes(file.purpose),403,'ARCHIVE_ROUTE_REQUIRED','请从所属合同档案读取当前版本文件');
    ensure(file.purpose!=='owner-authorization',403,'OWNER_LEGAL_H5_REQUIRED','请由当前法人从企业车主中心读取本企业授权文件');
    const boundary=await this.fileBoundary(id);ensure(!boundary.inspection,403,'VEHICLE_INSPECTION_ROUTE_REQUIRED','请从所属车辆查验资料读取文件');ensure(!boundary.vehicleDocument,403,'VEHICLE_DOCUMENT_ROUTE_REQUIRED','请从所属车辆原件档案读取文件');ensure(!boundary.asset,403,'ASSET_FILE_ROUTE_REQUIRED','请从所属资产资料读取文件');ensure(!boundary.financial&&!boundary.versioned&&!boundary.cooperation&&!boundary.renewalEvidence,403,'ARCHIVE_ROUTE_REQUIRED','请从所属业务档案读取文件');
    if(file.purpose==='technical-acceptance')ensure(await this.db.technicalAcceptance.count({where:{customerId:request.customer.id,purgeStartedAt:null,purgedAt:null,OR:[{sourceFileId:id},{signedFileId:id}]}}),404,'NOT_FOUND','验收文件不可读取');
    if (file.customerId !== request.customer.id) {
      const [handovers, contracts, bills] = await Promise.all([this.db.handover.count({ where: { customerId: request.customer.id, status: { not: 'DRAFT' }, OR: [{ fileIds: { has: id } }, { signedFileId: id }] } }), this.db.contract.count({ where: { customerId: request.customer.id, OR: [{ sourceFileId: id }, { signedFileId: id }] } }), this.db.bill.count({where:{customerId:request.customer.id,status:{in:['PENDING','PAID']},evidenceFileIds:{has:id}}})]); ensure(handovers + contracts + bills > 0, 404, 'NOT_FOUND', '附件不存在');
    }
    const onlineBytes=await recordOnlineEvidenceOpened(this.db,file,request.customer.id);
    if(onlineBytes){response.setHeader('Content-Type',file.mimeType);response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Cache-Control','private, no-store');return response.send(onlineBytes);}
    return this.stream(file, response);
  }
  @Get('admin/files/:id') async adminRead(@Param('id') id: string, @Req() request:any, @Res() response: any) { const file = await this.db.storedFile.findUnique({ where: { id } }); ensure(file, 404, 'NOT_FOUND', '附件不存在');if(file.purpose==='refund-bank'){await refundStaff(this.db,request.admin);await audit(this.db,request.admin.id,'REFUND_BANK_FILE_READ','files',id);return this.stream(file,response);}ensure(file.purpose!=='electronic-quarantine',403,'ELECTRONIC_QUARANTINE_PRIVATE','隔离签署证据不可通过普通文件入口读取'); ensure(file.purpose!=='vehicle-inspection',403,'VEHICLE_INSPECTION_ROUTE_REQUIRED','请从所属车辆查验资料读取文件'); ensure(file.purpose!=='vehicle-document',403,'VEHICLE_DOCUMENT_ROUTE_REQUIRED','请从所属车辆原件档案读取文件'); ensure(!['asset-baas','asset-depreciation','asset-cost','asset-plate','asset-residual-observation','asset-valuation','asset-work-order','asset-work-order-cost'].includes(file.purpose),403,'ASSET_FILE_ROUTE_REQUIRED','请从所属资产资料读取文件'); ensure(!['offline-archive','offline-source','insurance','partner-settlement'].includes(file.purpose),403,'ARCHIVE_ROUTE_REQUIRED','请从所属合同档案读取当前版本文件');
    const boundary=await this.fileBoundary(id);ensure(!boundary.inspection,403,'VEHICLE_INSPECTION_ROUTE_REQUIRED','请从所属车辆查验资料读取文件');ensure(!boundary.vehicleDocument,403,'VEHICLE_DOCUMENT_ROUTE_REQUIRED','请从所属车辆原件档案读取文件');ensure(!boundary.asset,403,'ASSET_FILE_ROUTE_REQUIRED','请从所属资产资料读取文件');ensure(!boundary.versioned,403,'ARCHIVE_ROUTE_REQUIRED','请从所属合同档案读取当前版本文件');
    ensure(!boundary.renewalEvidence||['ADMIN','OPERATIONS'].includes(request.admin.role),403,'AMENDMENT_FILE_PERMISSION','续期取消核实材料仅授权运营人员可读');
    if(boundary.financial)await requirePartnerCapability(this.db,request.admin,financialReadCapability(boundary.financial.kind));
    else ensure(file.purpose!=='partner-settlement',403,'ARCHIVE_ROUTE_REQUIRED','请从所属合作财务档案读取文件');
    if(boundary.cooperation)await requirePartnerCapability(this.db,request.admin,'partner.cooperation.read');
    if(!['ADMIN','FINANCE'].includes(request.admin.role))ensure(!await this.db.paymentReconciliation.count({where:{evidenceFileIds:{has:id}}}),403,'FINANCE_FILE_PERMISSION','财务核对材料仅财务及管理员可读'); if(file.purpose==='technical-acceptance')ensure(await this.db.technicalAcceptance.count({where:{purgeStartedAt:null,purgedAt:null,OR:[{sourceFileId:id},{signedFileId:id}]}}),404,'NOT_FOUND','验收文件不可读取'); if(!['ADMIN','OPERATIONS'].includes(request.admin.role)){const qualification=(['identity','profile'].includes(file.purpose)&&!boundary.cooperation)||!!file.customerId||await this.db.customerQualificationVersion.count({where:{OR:[{identityFileIds:{has:id}},{drivingLicenseFileIds:{has:id}}]}});ensure(!qualification,403,'CUSTOMER_FILE_PERMISSION','客户资格原始资料仅授权运营人员可读');const restricted=await this.db.offlineCancellationReview.count({where:{evidenceFileIds:{has:id}}})||['amendment','technical-acceptance','owner-authorization'].includes(file.purpose)||await this.db.contract.count({where:{kind:'AMENDMENT',OR:[{sourceFileId:id},{signedFileId:id}]}})||await this.db.ownerSigningTask.count({where:{OR:[{sourceFileId:id},{signedFileId:id}]}});ensure(!restricted,403,'AMENDMENT_FILE_PERMISSION','补充协议全文仅本人及授权运营人员可读');
      const handoverEvidence=file.purpose==='handover'||!!file.fieldTaskId||await this.db.handover.count({where:{OR:[{fileIds:{has:id}},{responseFileIds:{has:id}},{signedFileId:id}]}})||await this.db.vehicleReceiptEvent.count({where:{evidenceFileIds:{has:id}}});
      ensure(!handoverEvidence,403,'HANDOVER_FILE_PERMISSION','交还车原始材料仅授权运营人员可读');
    } return this.stream(file, response); }
  @Get('public/media/:id') async media(@Param('id') id: string, @Res() response: any) { const file = await this.db.storedFile.findFirst({ where: { id, customerId: null, purpose: 'vehicle', mimeType: { in: ['image/png','image/jpeg'] } } }); ensure(file, 404, 'NOT_FOUND', '图片不存在'); const boundary=await this.fileBoundary(id);ensure(!boundary.inspection&&!boundary.vehicleDocument&&!boundary.asset&&!boundary.financial&&!boundary.versioned&&!boundary.cooperation&&!boundary.renewalEvidence,404,'NOT_FOUND','图片不存在'); const published = await this.db.vehicle.count({ where: { virtualAcceptanceScopeId:null,status: { in: ['PUBLISHED','RESERVED','IN_USE'] }, OR: [{ coverFileId: id }, { mediaFileIds: { has: id } }] } }); ensure(published, 404, 'NOT_FOUND', '图片未发布'); return this.stream(file, response); }
  private stream(file: any, response: any) { ensure(resolve(file.storagePath).startsWith(root + require('node:path').sep), 500, 'STORAGE_PATH', '文件存储异常'); response.setHeader('Content-Type', file.mimeType); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(readableFileName(file.name))}`); return response.sendFile(file.storagePath); }
}
