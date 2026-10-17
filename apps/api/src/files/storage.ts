import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {resolve,sep} from 'node:path';
import {projectRoot} from '../common/config';
import {ensure} from '../common/errors';
const root=resolve(process.env.UPLOAD_DIR||resolve(projectRoot,'var/uploads'));
export function validMime(buffer:Buffer,mime:string){
 if(mime==='image/jpeg')return buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff;
 if(mime==='image/png')return buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='application/pdf')return buffer.subarray(0,5).toString()==='%PDF-';
 return false;
}
export async function saveFile(file:Express.Multer.File){
 const sha256=createHash('sha256').update(file.buffer).digest('hex'),storagePath=resolve(root,sha256.slice(0,2),sha256);
 await fs.mkdir(resolve(root,sha256.slice(0,2)),{recursive:true});await fs.writeFile(storagePath,file.buffer,{flag:'w',mode:0o600});
 return{name:file.originalname.replace(/[\r\n\\/]/g,'_').slice(0,200),mimeType:file.mimetype,size:file.size,sha256,storagePath};
}
export function streamFile(file:any,response:any){
 ensure(resolve(file.storagePath).startsWith(root+sep),500,'STORAGE_PATH','文件存储异常');
 response.setHeader('Content-Type',file.mimeType);response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Cache-Control','private, no-store');response.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);return response.sendFile(file.storagePath);
}
