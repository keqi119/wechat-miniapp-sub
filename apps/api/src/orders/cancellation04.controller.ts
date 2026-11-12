import {Body,Controller,Get,Inject,Param,Post,Req,Res} from '@nestjs/common';
import {readExitEvidence} from './exit-evidence';
import {readEvidenceBytes} from '../operations/online-handover';
import {Db} from '../common/db';
import {Cancellation04Service} from './cancellation04';
@Controller()
export class Cancellation04Controller{
 private service:Cancellation04Service;
 constructor(@Inject(Db)private readonly db:Db){this.service=new Cancellation04Service(db);}
 @Get('admin/cancellations04/:id/files/:fileId') async file(@Param('id')id:string,@Param('fileId')fileId:string,@Req()r:any,@Res()res:any){const file=await this.db.serial(tx=>readExitEvidence(tx,'cancellation04',id,fileId,r.admin));const bytes=await readEvidenceBytes(file);res.setHeader('Content-Type',file.mimeType);res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');return res.send(bytes);}
 @Get('admin/orders/:id/cancellation04') read(@Param('id')id:string,@Req()r:any){return this.service.read(id,r.admin);}
 @Post('admin/orders/:id/cancellation04') propose(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.propose(id,b,r.admin);}
 @Post('admin/cancellations04/:id/review') review(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.review(id,b,r.admin);}
 @Get('customer/orders/:id/cancellation04') customer(@Param('id')id:string,@Req()r:any){return this.service.read(id,undefined,r.customer.id);}
 @Post('customer/cancellations04/:id/confirm') confirm(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.confirm(id,b,r.customer.id);}
}
