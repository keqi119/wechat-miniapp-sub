import {Body,Controller,Get,Inject,Param,Post,Req,Res} from '@nestjs/common';
import {readExitEvidence} from './exit-evidence';
import {readEvidenceBytes} from '../operations/online-handover';
import {Db} from '../common/db';
import {TerminationService} from './termination';
@Controller()
export class TerminationController{
 private service:TerminationService;
 constructor(@Inject(Db)private readonly db:Db){this.service=new TerminationService(db);}
 @Get('admin/terminations/:id/files/:fileId') async file(@Param('id')id:string,@Param('fileId')fileId:string,@Req()r:any,@Res()res:any){const file=await this.db.serial(tx=>readExitEvidence(tx,'termination',id,fileId,r.admin));const bytes=await readEvidenceBytes(file);res.setHeader('Content-Type',file.mimeType);res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');return res.send(bytes);}
 @Get('admin/orders/:id/termination') read(@Param('id')id:string,@Req()r:any){return this.service.read(id,r.admin);}
 @Post('admin/orders/:id/termination') propose(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.propose(id,b,r.admin);}
 @Post('admin/orders/:id/unilateral-termination') unilateral(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.propose(id,b,r.admin,true);}
 @Post('admin/terminations/:id/review') review(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.review(id,b,r.admin);}
 @Post('admin/terminations/:id/resolve-partial-swap') resolvePartial(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.resolvePartial(id,b,r.admin);}
 @Post('admin/orders/:id/occupancy-claims') claimOccupancy(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.claimOccupancy(id,b,r.admin);}
 @Post('admin/terminations/occupancy-claims/:id/review') reviewOccupancy(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.reviewOccupancy(id,b,r.admin);}
 @Get('customer/orders/:id/termination') customer(@Param('id')id:string,@Req()r:any){return this.service.read(id,undefined,r.customer.id);}
 @Post('customer/orders/:id/exit-amounts/respond') amounts(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.respondAmounts(id,b,r.customer.id);}
 @Post('customer/terminations/:id/confirm') confirm(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.confirm(id,b,r.customer.id);}
}
