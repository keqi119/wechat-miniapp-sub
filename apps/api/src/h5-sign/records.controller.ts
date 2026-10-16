import {Body,Controller,Get,Inject,Param,Post,Req,Res} from '@nestjs/common';
import {z} from 'zod';
import {H5RecordsService} from './records.service';
const kind=z.enum(['SUBSCRIPTION','HANDOVER','AMENDMENT']);
const action=z.object({revision:z.number().int().nonnegative().optional()}).strict();
@Controller('h5-sign')
export class H5RecordsController{
 constructor(@Inject(H5RecordsService)private records:H5RecordsService){}
 @Get('records')list(@Req()r:any){return this.records.list(r.h5Customer.id);}
 @Get('records/:kind/:id')detail(@Param('kind')k:string,@Param('id')id:string,@Req()r:any){return this.records.view(kind.parse(k),id,r.h5Customer.id);}
 @Post('records/:kind/:id/sign')sign(@Param('kind')k:string,@Param('id')id:string,@Req()r:any,@Body()body:any){return this.records.action(kind.parse(k),id,r.h5Customer,action.parse(body),false);}
 @Post('records/:kind/:id/sync')sync(@Param('kind')k:string,@Param('id')id:string,@Req()r:any,@Body()body:any){return this.records.action(kind.parse(k),id,r.h5Customer,action.parse(body),true);}
 @Get('files/:id')async file(@Param('id')id:string,@Req()r:any,@Res()response:any){const{file,bytes}=await this.records.file(id,r.h5Customer.id);response.type('application/pdf');response.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);return response.send(bytes);}
}
