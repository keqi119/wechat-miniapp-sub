import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ensure } from '../common/errors';
import { assertNotAssetFiles } from '../files/asset-files';
import { requireOwnerLegalRepresentative } from './legal-representative';
export async function readInternalEvidence(tx: any, customerId: string, ownerId: string, fileId: string) {
    const { owner } = await requireOwnerLegalRepresentative(tx, customerId, ownerId);
    const profile = owner.contractProfile as any;
    const bound = profile?.authorityEvidenceFileIds?.includes(fileId) || await tx.electronicAutoAuthority.count({ where: { ownerId, basis: { path: ['original', 'fileId'], equals: fileId } } });
    ensure(bound, 404, 'NOT_FOUND', '本企业原始授权凭据不存在');
    await assertNotAssetFiles(tx, [fileId]);
    const file = await tx.storedFile.findUnique({ where: { id: fileId } });
    ensure(file?.adminId && !file.customerId && ['application/pdf', 'image/png', 'image/jpeg'].includes(file.mimeType), 404, 'NOT_FOUND', '原始依据不可用');
    const bytes = await readFile(file.storagePath);
    ensure(bytes.length === file.size && createHash('sha256').update(bytes).digest('hex') === file.sha256, 409, 'FILE_INTEGRITY', '原始文件校验失败');
    return { file, bytes };
}
