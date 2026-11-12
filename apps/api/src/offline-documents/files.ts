import {createHash} from 'node:crypto';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
export function assertDraft(version:any){ensure(version.status==='DRAFT',409,'ARCHIVE_IMMUTABLE','仅草稿版本可修改');}
export function validateArchiveFile(buffer:Buffer,mimeType:string){
 const valid=Buffer.isBuffer(buffer)&&buffer.length>0&&buffer.length<=10*1024*1024&&((mimeType==='application/pdf'&&buffer.subarray(0,5).toString()==='%PDF-')||(mimeType==='image/jpeg'&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)||(mimeType==='image/png'&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))));
 ensure(valid,400,'ARCHIVE_FILE_INVALID','附件仅支持10MiB以内内容有效的PDF/JPEG/PNG');
 return{mimeType,size:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex')};
}
export function assertFileBinding(version:any,binding:any){ensure(binding.versionId===version.id&&binding.fileId===binding.file?.id,404,'NOT_FOUND','附件不属于本版本');}
export function validateManifest(files:any[]){
 ensure(files.length>0&&files.length<=20,400,'ARCHIVE_FILE_INVALID','附件数量须为1至20');
 const sorted=[...files].sort((a,b)=>a.position-b.position);let size=0;
 const ids=new Set<string>();
 for(let i=0;i<sorted.length;i++){const f=sorted[i];ensure(f.position===i+1&&!ids.has(f.file.id)&&f.file.size>0&&f.file.size<=10*1024*1024&&['application/pdf','image/jpeg','image/png'].includes(f.file.mimeType)&&/^[a-f0-9]{64}$/.test(f.file.sha256),400,'ARCHIVE_FILE_INVALID','附件顺序、类型或大小无效');ids.add(f.file.id);size+=f.file.size;}
 ensure(size<=50*1024*1024,400,'ARCHIVE_FILE_INVALID','附件总大小不得超过50MiB');
 return hash(sorted.map(f=>({fileId:f.file.id,position:f.position,sha256:f.file.sha256,size:f.file.size,mimeType:f.file.mimeType})));
}
