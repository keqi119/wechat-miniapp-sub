import {ensure} from '../common/errors';

/** A confirmation only covers this exact archive version and generated PDF. */
export async function archivePrintConfirmed(tx:any,archive:any,version:any){
 if(!version.sourceFileId)return false;
 return !!await tx.archiveCommand.findFirst({where:{resourceId:archive.id,action:`CONFIRM_PRINT:${version.id}`,resultSnapshot:{path:['sourceFileId'],equals:version.sourceFileId}},select:{id:true}});
}
export async function requireArchivePrintConfirmed(tx:any,archive:any,version:any){
 ensure(version.sourceFileId,409,'ARCHIVE_SOURCE_REQUIRED','请先按本单交易条件生成合同文件');
 ensure(await archivePrintConfirmed(tx,archive,version),409,'ARCHIVE_PRINT_CONFIRMATION_REQUIRED','请先预览打印文件并确认内容，再上传和提交签字版');
}
