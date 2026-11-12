import {Body,Controller,Get,Inject,Param,Post,Query,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {PricingReferenceService} from './service';
import {pricingTransaction} from './command';
@Controller('admin/pricing-reference')
export class PricingReferenceController {
 private readonly service=new PricingReferenceService();
 constructor(@Inject(Db) private readonly db:Db){}
 @Get('scenarios') scenarios(@Req() r:any,@Query() q:any){return this.db.serial(tx=>this.service.listParameters(tx,r.admin,'SCENARIO',q));}
 @Get('curves') curves(@Req() r:any,@Query() q:any){return this.db.serial(tx=>this.service.listParameters(tx,r.admin,'CURVE',q));}
 @Get('reviews') reviews(@Req() r:any,@Query() q:any){return this.db.serial(tx=>this.service.listParameters(tx,r.admin,'REVIEW',q));}
 @Post('scenarios') scenario(@Req() r:any,@Body() b:any){return pricingTransaction(this.db,tx=>this.service.writeParameter(tx,r.admin,'SCENARIO',b));}
 @Post('curves') curve(@Req() r:any,@Body() b:any){return pricingTransaction(this.db,tx=>this.service.writeParameter(tx,r.admin,'CURVE',b));}
 @Post('reviews') review(@Req() r:any,@Body() b:any){return pricingTransaction(this.db,tx=>this.service.writeParameter(tx,r.admin,'REVIEW',b));}
 @Post('preview') preview(@Req() r:any,@Body() b:any){return this.db.serial(tx=>this.service.preview(tx,r.admin,b));}
 @Get('runs') runs(@Req() r:any,@Query() q:any){return this.db.serial(tx=>this.service.runs(tx,r.admin,q));}
 @Get('runs/:id') run(@Req() r:any,@Param('id') id:string){return this.db.serial(tx=>this.service.run(tx,r.admin,id));}
 @Post('runs') create(@Req() r:any,@Body() b:any){return pricingTransaction(this.db,tx=>this.service.createRun(tx,r.admin,b));}
 @Post('runs/:id/groups/:groupKey/drafts') adopt(@Req() r:any,@Param('id') id:string,@Param('groupKey') group:string,@Body() b:any){return pricingTransaction(this.db,tx=>this.service.adopt(tx,r.admin,id,group,b));}
}
