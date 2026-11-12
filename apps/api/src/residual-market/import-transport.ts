import {json,type RequestHandler} from 'express';
import {HttpException} from '@nestjs/common';

const paths=new Set(['/api/admin/residual-imports','/api/admin/residual-imports/preview']);

/** CSV itself remains bounded to 2 MiB by the domain parser. A JSON string can
 * encode one UTF-8 byte as six ASCII characters; allow that envelope only on
 * these two routes. All other endpoints keep Nest's existing body limits. */
export function residualImportJson():RequestHandler{
 const parse=json({limit:13*1024*1024});
 return(req,res,next)=>{
  if(req.method!=='POST'||!paths.has(req.path))return next();
  parse(req,res,(error?:any)=>{
   if(error?.type==='entity.too.large')return next(new HttpException({error:{code:'CSV_REQUEST_SIZE_LIMIT',message:'导入请求超过传输上限，CSV文件最多2MiB'}},413));
   if(error?.type==='entity.parse.failed')return next(new HttpException({error:{code:'CSV_REQUEST_INVALID',message:'导入请求不是有效JSON'}},400));
   next(error);
  });
 };
}
