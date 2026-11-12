import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadElectronicArchiveProof } from '../electronic-documents/archive';
import { requireElectronicCooperationProof } from '../electronic-documents/cooperation';
import { ensure } from '../common/errors';
/** Only verified independently bound archives enter the viewing portal. Never drafts. */
export async function sharedElectronicCooperationFile(tx: any, ownerId: string, version: any) {
    ensure(version.ownerId === ownerId, 404, 'NOT_FOUND', '协议不存在');
    const proof = await requireElectronicCooperationProof(tx, version);
    const file = await tx.storedFile.findUniqueOrThrow({ where: { id: proof.finalFile.id } });
    const bytes = await readFile(file.storagePath);
    ensure(bytes.length === file.size && createHash('sha256').update(bytes).digest('hex') === proof.finalFile.sha256, 409, 'FILE_INTEGRITY', '归档文件校验失败');
    return file;
}
export async function sharedElectronicOrderArchive(tx: any, order: any, ownerId: string, contract: any) {
    if (contract?.executionMode !== 'ELECTRONIC')
        return null;
    const task = await tx.electronicSigningTask.findFirst({ where: { orderId: order.id, contractId: contract.id } });
    if (!task || task.ownerId !== ownerId || task.customerId !== order.customerId)
        return null;
    const proof = await loadElectronicArchiveProof(tx, task.archiveVersionId);
    if (!proof || proof.taskId !== task.id)
        return null;
    const version = await tx.archiveVersion.findUnique({ where: { id: task.archiveVersionId }, include: { archive: true } });
    if (version.archive.ownerId !== ownerId || version.archive.orderId !== order.id)
        return null;
    return { id: version.archiveId, kind: version.archive.kind, currentApprovedVersionId: version.id, versions: [{ id: version.id, version: version.version, status: version.status, contractNumber: version.contractNumber, signedOn: proof.archivedAt.slice(0, 10) }], canRead: true };
}
