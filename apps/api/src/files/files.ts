import { Controller, Get, Inject, Param, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { Db } from '../common/db';
import { projectRoot } from '../common/config';
import { ensure } from '../common/errors';
import { audit } from '../common/data';
const root = resolve(process.env.UPLOAD_DIR || resolve(projectRoot, 'var/uploads'));
const interceptor = FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
function validMime(buffer: Buffer, mime: string) {
  if (mime === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'application/pdf') return buffer.subarray(0, 5).toString() === '%PDF-';
  return false;
}
@Controller()
export class FilesController {
  constructor(@Inject(Db) private db: Db) {}
  @Post('customer/files') @UseInterceptors(interceptor) customerUpload(@UploadedFile() file: Express.Multer.File, @Req() request: any) { return this.upload(file, request, true); }
  @Post('admin/files') @UseInterceptors(interceptor) adminUpload(@UploadedFile() file: Express.Multer.File, @Req() request: any) { return this.upload(file, request, false); }
  private async upload(file: Express.Multer.File, request: any, customer: boolean) {
    ensure(file && validMime(file.buffer, file.mimetype), 400, 'FILE_TYPE', '仅支持内容有效的PNG/JPEG/PDF文件');
    const purpose = String(request.body.purpose || 'evidence'); ensure(['profile','identity','evidence','contract','vehicle','handover','mileage','service'].includes(purpose), 400, 'FILE_PURPOSE', '附件用途无效'); ensure(!customer || !['vehicle','contract'].includes(purpose), 403, 'FILE_PURPOSE', '该用途仅后台可上传');
    ensure(customer || request.admin.role !== 'FINANCE' || purpose === 'evidence', 403, 'FILE_PURPOSE', '财务仅可上传费用证据');
    const sha256 = createHash('sha256').update(file.buffer).digest('hex'); const path = resolve(root, sha256.slice(0, 2), sha256); await fs.mkdir(resolve(root, sha256.slice(0, 2)), { recursive: true }); await fs.writeFile(path, file.buffer, { flag: 'w', mode: 0o600 });
    const stored = await this.db.storedFile.create({ data: { name: file.originalname.replace(/[\r\n\\/]/g, '_').slice(0, 200), mimeType: file.mimetype, size: file.size, sha256, storagePath: path, purpose, customerId: customer ? request.customer.id : null, adminId: customer ? null : request.admin.id } });
    await audit(this.db, customer ? request.customer.id : request.admin.id, 'UPLOAD', 'files', stored.id, { purpose, size: stored.size, sha256 }, customer ? 'CUSTOMER' : 'ADMIN');
    return { id: stored.id, name: stored.name, url: `/api/${customer ? 'customer' : 'admin'}/files/${stored.id}`, mimeType: stored.mimeType, size: stored.size };
  }
  @Get('customer/files/:id') async customerRead(@Param('id') id: string, @Req() request: any, @Res() response: any) {
    const file = await this.db.storedFile.findUnique({ where: { id } }); ensure(file, 404, 'NOT_FOUND', '附件不存在');
    if (file.customerId !== request.customer.id) {
      const [handovers, contracts, bills] = await Promise.all([this.db.handover.count({ where: { customerId: request.customer.id, status: { not: 'DRAFT' }, OR: [{ fileIds: { has: id } }, { signedFileId: id }] } }), this.db.contract.count({ where: { customerId: request.customer.id, OR: [{ sourceFileId: id }, { signedFileId: id }] } }), this.db.bill.count({where:{customerId:request.customer.id,status:{in:['PENDING','PAID']},evidenceFileIds:{has:id}}})]); ensure(handovers + contracts + bills > 0, 404, 'NOT_FOUND', '附件不存在');
    }
    return this.stream(file, response);
  }
  @Get('admin/files/:id') async adminRead(@Param('id') id: string, @Res() response: any) { const file = await this.db.storedFile.findUnique({ where: { id } }); ensure(file, 404, 'NOT_FOUND', '附件不存在'); return this.stream(file, response); }
  @Get('public/media/:id') async media(@Param('id') id: string, @Res() response: any) { const file = await this.db.storedFile.findFirst({ where: { id, customerId: null, purpose: 'vehicle', mimeType: { in: ['image/png','image/jpeg'] } } }); ensure(file, 404, 'NOT_FOUND', '图片不存在'); const published = await this.db.vehicle.count({ where: { status: { in: ['PUBLISHED','RESERVED','IN_USE'] }, OR: [{ coverFileId: id }, { mediaFileIds: { has: id } }] } }); ensure(published, 404, 'NOT_FOUND', '图片未发布'); return this.stream(file, response); }
  private stream(file: any, response: any) { ensure(resolve(file.storagePath).startsWith(root + require('node:path').sep), 500, 'STORAGE_PATH', '文件存储异常'); response.setHeader('Content-Type', file.mimeType); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`); return response.sendFile(file.storagePath); }
}
