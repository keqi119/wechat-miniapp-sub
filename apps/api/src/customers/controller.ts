import {Body,Controller,Get,Inject,Param,Post,Req,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {Db} from '../common/db';
import {QualificationService} from './qualifications';
import {RiskReviewService} from '../applications/risk-review';
import {OrderQualificationService} from './order-qualification';
import {uploadQualificationFile} from './qualification-documents';
@Controller()
export class CustomerRiskController {
 private readonly qualifications=new QualificationService();
 private readonly risk=new RiskReviewService();
 private readonly orderQualifications=new OrderQualificationService();
 constructor(@Inject(Db) private db:Db){}
 @Get('admin/orders/:id/qualification-continuity') orderQualificationContext(@Param('id')id:string,@Req()r:any){return this.db.serial(tx=>this.orderQualifications.context(tx,r.admin,id));}
 @Post('admin/orders/:id/qualification-continuity') confirmOrderQualification(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.db.serial(tx=>this.orderQualifications.confirm(tx,r.admin,id,body));}
 @Get('admin/customers/:id/qualifications') qualificationsView(@Param('id')id:string,@Req()r:any){return this.db.serial(tx=>this.qualifications.list(tx,r.admin,id));}
 @Post('admin/customers/:id/qualification-files') @UseInterceptors(FileInterceptor('file',{limits:{files:1,fileSize:10*1024*1024,fields:1}})) uploadQualificationFile(@Param('id')id:string,@Body()body:unknown,@UploadedFile()file:Express.Multer.File,@Req()r:any){return uploadQualificationFile(this.db,r.admin,id,body,file);}
 @Post('admin/customers/:id/qualifications') submit(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.db.serial(tx=>this.qualifications.submit(tx,r.admin,id,body));}
 @Post('admin/customers/:id/qualifications/reviews') review(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.db.serial(tx=>this.qualifications.review(tx,r.admin,id,body));}
 @Get('customer/qualifications') customerStatus(@Req()r:any){return this.db.serial(tx=>this.qualifications.status(tx,r.customer.id));}
 @Get('admin/applications/:id/risk-reviews') riskDetail(@Param('id')id:string,@Req()r:any){return this.db.serial(tx=>this.risk.detail(tx,r.admin,id));}
 @Post('admin/applications/:id/risk-reviews') assess(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.db.serial(tx=>this.risk.assess(tx,r.admin,id,body));}
 @Get('admin/customers/:id/applications/:applicationId/risk-status') supportStatus(@Param('id')id:string,@Param('applicationId')applicationId:string,@Req()r:any){return this.db.serial(async tx=>{await this.qualifications.list(tx,r.admin,id);return this.risk.status(tx,applicationId,id);});}
 @Get('customer/applications/:id/risk-review') customerRisk(@Param('id')id:string,@Req()r:any){return this.db.serial(tx=>this.risk.status(tx,id,r.customer.id));}
}
