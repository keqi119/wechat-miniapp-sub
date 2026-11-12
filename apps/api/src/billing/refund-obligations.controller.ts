import {Controller,Get,Post,Param,Body,Req,Inject,Query,Res} from '@nestjs/common';
import {readEvidenceBytes} from '../operations/online-handover';
import {Db} from '../common/db';
import {RefundObligationsService} from './refund-obligations';
@Controller()
export class RefundObligationsController{
 private service:RefundObligationsService;constructor(@Inject(Db)db:Db){this.service=new RefundObligationsService(db);}
 @Get('admin/orders/:id/refund-amount-evidence/:claimId/files/:fileId') async evidence(@Param('id')id:string,@Param('claimId')claimId:string,@Param('fileId')fileId:string,@Req()r:any,@Res()res:any){const file=await this.service.evidenceFile(id,claimId,fileId,r.admin),bytes=await readEvidenceBytes(file);res.setHeader('Content-Type',file.mimeType);res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');return res.send(bytes);}
 @Get('admin/refunds/obligations') all(@Query()q:any,@Req()r:any){return this.service.list(q,r.admin);}
 @Get('admin/refunds/working-calendar') calendar(@Req()r:any){return this.service.calendar(r.admin);}
 @Get('admin/refunds/orders/:id/obligations') list(@Param('id')id:string,@Req()r:any){return this.service.read(id,r.admin);}
 @Get('admin/refunds/orders/:id/obligations/:obligationId') detail(@Param('id')id:string,@Param('obligationId')oid:string,@Req()r:any){return this.service.detail(id,oid,r.admin);}
 @Post('admin/refunds/orders/:id/obligations') materialize(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.materialize(id,b,r.admin);}
 @Get('customer/orders/:id/refund-obligations') customer(@Param('id')id:string,@Req()r:any){return this.service.read(id,undefined,r.customer.id);}
 @Post('customer/orders/:id/refund-amounts/confirm') confirm(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.confirm(id,b,r.customer.id);}
 @Post('admin/orders/:id/refund-amount-evidence') claim(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.claim(id,b,r.admin);}
 @Post('admin/orders/:id/refund-amount-evidence/:claimId/review') review(@Param('id')id:string,@Param('claimId')cid:string,@Body()b:any,@Req()r:any){return this.service.review(id,cid,b,r.admin);}
}
