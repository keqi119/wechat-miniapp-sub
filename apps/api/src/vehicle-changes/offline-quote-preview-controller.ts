import {Body,Controller,Get,Inject,Param,Post,Query,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {USAGE_CLOCK} from '../usage/rules';
import {OrderChangesService} from '../order-changes/service';
import {requireCurrentStaff} from '../auth/staff-session';
import {ensure} from '../common/errors';
import {listOfflineSwapTargets,offlineSwapPreviewId,readOfflineSwapQuotePreview,strictElectronicSwapQuoteInput,strictOfflineSwapQuoteInput} from './offline-quote-preview';

/** Independent paths do not collide with the existing :id/:action controller.
 * POST previews retain normal admin write RBAC, origin and CSRF; they only read. */
@Controller(['admin/order-changes/:id/offline','admin/order-changes/:id/electronic'])
export class OfflineSwapQuotePreviewController{
 constructor(@Inject(Db)private readonly db:Db,@Inject(OrderChangesService)private readonly changes:OrderChangesService,@Inject(USAGE_CLOCK)private readonly clock:()=>Date){}
 @Get('targets') targets(@Param('id')id:string,@Query()query:any,@Req()request:any){return this.db.serial(tx=>listOfflineSwapTargets(tx,offlineSwapPreviewId.parse(id),query,request.admin,this.clock()));}
 @Post('quote-preview') preview(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return this.db.serial(tx=>readOfflineSwapQuotePreview(tx,offlineSwapPreviewId.parse(id),body,request.admin,this.clock()));}
 @Post('quotes') async quote(@Param('id')id:string,@Body()body:unknown,@Req()request:any){
  await requireCurrentStaff(this.db as any,request.admin,'order-changes',true);ensure(['ADMIN','OPERATIONS'].includes(request.admin.role),403,'FORBIDDEN','仅当前运营可编制报价');
  id=offlineSwapPreviewId.parse(id);const change=await this.db.orderChange.findUnique({where:{id}});ensure(change,404,'NOT_FOUND','换车草案不存在');ensure(change.kind==='VEHICLE_CHANGE',409,'CHANGE_KIND','仅换车草案使用自动报价入口');
  const order=await this.db.order.findUnique({where:{id:change.orderId}});ensure(['OFFLINE','ELECTRONIC'].includes(order?.contractMode??''),409,'SWAP_STATE','仅线下换车使用自动报价入口');
  return this.changes.act(id,'quotes',(order?.contractMode==='ELECTRONIC'?strictElectronicSwapQuoteInput:strictOfflineSwapQuoteInput).parse(body),request.admin);
 }
}

