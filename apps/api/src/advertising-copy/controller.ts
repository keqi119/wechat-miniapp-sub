import {Body,Controller,Get,Header,Inject,Param,Patch,Post,Req} from '@nestjs/common';
import {AdvertisingCopyService} from './service';

@Controller('admin/advertising-copy')
export class AdvertisingCopyAdminController {
 constructor(@Inject(AdvertisingCopyService) private readonly service:AdvertisingCopyService){}
 @Get() detail(@Req() req:any){return this.service.detail(req.admin);}
 @Get('commands/:action/:key') commandReceipt(@Param('action') action:string,@Param('key') key:string,@Req() req:any){return this.service.commandReceipt({action,key},req.admin);}
 @Patch('draft') saveDraft(@Body() input:unknown,@Req() req:any){return this.service.saveDraft(input,req.admin);}
 @Post('publish') publish(@Body() input:unknown,@Req() req:any){return this.service.publish(input,req.admin);}
}
@Controller('public/advertising-copy')
export class AdvertisingCopyPublicController {
 constructor(@Inject(AdvertisingCopyService) private readonly service:AdvertisingCopyService){}
 @Get() @Header('Cache-Control','no-store') detail(){return this.service.publicSnapshot();}
}
