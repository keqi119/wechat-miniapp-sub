import {Body,Controller,Get,Inject,Param,Post,Query,Req,Res} from '@nestjs/common';
import {streamFile} from '../files/storage';
import {OrderRenewalsService} from './service';
import {renewalId} from './types';

/** Shared paper, finance and cancellation gates apply to every routed renewal action. */
@Controller()
export class OrderRenewalsController{
 @Get('admin/order-renewals/:id/cancellation-v31/files/:fileId') async cancellationV31File(@Param('id')id:string,@Param('fileId')fileId:string,@Req()r:any,@Res()response:any){return streamFile(await this.service.cancellationV31File(id,fileId,r.admin),response);}
 @Get('customer/order-renewals/:id/cancellation-v31/files/:fileId') async customerCancellationV31File(@Param('id')id:string,@Param('fileId')fileId:string,@Req()r:any,@Res()response:any){return streamFile(await this.service.cancellationV31File(id,fileId,undefined,r.customer.id),response);}
 @Get('admin/order-renewals/:id/cancellation-v31') cancellationV31Read(@Param('id')id:string,@Req()r:any){return this.service.cancellationV31(renewalId.parse(id),'read',{},r.admin);}
 @Post('admin/order-renewals/:id/cancellation-v31/:action') cancellationV31Action(@Param('id')id:string,@Param('action')action:string,@Body()body:any,@Req()r:any){return this.service.cancellationV31(renewalId.parse(id),action,body,r.admin);}
 constructor(@Inject(OrderRenewalsService)private readonly service:OrderRenewalsService){}
 @Get('admin/orders/:id/renewal-context') context(@Param('id')id:string,@Query('changeId')changeId:string|undefined,@Req()r:any){return this.service.context(renewalId.parse(id),r.admin,changeId===undefined?undefined:renewalId.parse(changeId));}
 @Get('admin/orders/:id/renewal-goods') goods(@Param('id')id:string,@Query()q:any,@Req()r:any){const {changeId,...query}=q;return this.service.goods(renewalId.parse(id),query,r.admin,changeId===undefined?undefined:renewalId.parse(changeId));}
 @Post('admin/orders/:id/renewals/preview') preview(@Param('id')id:string,@Body()body:any,@Query('changeId')changeId:string|undefined,@Req()r:any){return this.service.preview(renewalId.parse(id),body,r.admin,changeId===undefined?undefined:renewalId.parse(changeId));}
 @Post('admin/orders/:id/renewals') create(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.service.create(renewalId.parse(id),body,r.admin);}
 @Get('admin/order-renewals') adminList(@Query()q:any,@Req()r:any){return this.service.list(q,r.admin);}
 @Get('customer/order-renewals') customerList(@Query()q:any,@Req()r:any){return this.service.list(q,undefined,r.customer.id);}
 @Get('admin/order-renewals/:id') adminDetail(@Param('id')id:string,@Req()r:any){return this.service.detail(renewalId.parse(id),r.admin);}
 @Get('admin/order-renewals/:id/finance-preview') financePreview(@Param('id')id:string,@Req()r:any){return this.service.financePreview(renewalId.parse(id),r.admin);}
 @Post('admin/order-renewals/:id/finance/prepare') prepare(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.service.prepare(renewalId.parse(id),body,r.admin);}
 @Get('admin/order-renewals/:id/schedule-preview') schedulePreview(@Param('id')id:string,@Req()r:any){return this.service.schedulePreview(renewalId.parse(id),r.admin);}
 @Post('admin/order-renewals/:id/schedule') schedule(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.service.schedule(renewalId.parse(id),body,r.admin);}
 @Get('admin/order-renewals/:id/activation-preview') activationPreview(@Param('id')id:string,@Req()r:any){return this.service.activationPreview(renewalId.parse(id),r.admin);}
 @Post('admin/order-renewals/:id/activate') activate(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.service.activate(renewalId.parse(id),body,r.admin);}
 @Get('admin/order-renewals/:id/cancellation-preview') cancellationPreview(@Param('id')id:string,@Req()r:any){return this.service.cancellationPreview(renewalId.parse(id),r.admin);}
 @Post('admin/order-renewals/:id/cancellation/open') openCancellation(@Param('id')id:string,@Body()body:unknown,@Req()r:any){return this.service.openCancellation(renewalId.parse(id),body,r.admin);}
 @Post('admin/order-renewals/:id/cancellation/confirm-agreement') confirmCancellationAgreement(@Param('id')id:string,@Body()body:unknown,@Req()r:any){return this.service.confirmCancellationAgreement(renewalId.parse(id),body,r.admin);}
 @Post('admin/order-renewals/:id/cancellation/verify-signature') verifyCancellationSignature(@Param('id')id:string,@Body()body:unknown,@Req()r:any){return this.service.verifyCancellationSignature(renewalId.parse(id),body,r.admin);}
 @Post('admin/order-renewals/:id/cancellation/refunds') requestCancellationRefund(@Param('id')id:string,@Body()body:unknown,@Req()r:any){return this.service.requestCancellationRefund(renewalId.parse(id),body,r.admin);}
 @Get('admin/order-renewals/:id/cancellation-late-refund-preview') cancellationLateRefundPreview(@Param('id')id:string,@Query('paymentId')paymentId:string,@Req()r:any){return this.service.cancellationLateRefundPreview(renewalId.parse(id),renewalId.parse(paymentId),r.admin);}
 @Get('admin/order-renewals/:id/cancellation-late-payments') cancellationLatePayments(@Param('id')id:string,@Query()query:unknown,@Req()r:any){return this.service.cancellationLatePayments(renewalId.parse(id),query,r.admin);}
 @Post('admin/order-renewals/:id/cancellation/late-refunds') requestCancellationLateRefund(@Param('id')id:string,@Body()body:unknown,@Req()r:any){return this.service.requestCancellationLateRefund(renewalId.parse(id),body,r.admin);}
 @Post('admin/order-renewals/:id/cancel-prepared') cancelPrepared(@Param('id')id:string,@Body()body:unknown,@Req()r:any){return this.service.cancelPrepared(renewalId.parse(id),body,r.admin);}
 @Post('admin/order-renewals/:id/:action') action(@Param('id')id:string,@Param('action')action:string,@Body()body:any,@Req()r:any){return this.service.act(renewalId.parse(id),action,body,r.admin);}
 @Get('customer/order-renewals/:id') customerDetail(@Param('id')id:string,@Req()r:any){return this.service.detail(renewalId.parse(id),undefined,r.customer.id);}
 @Post('customer/order-renewals/:id/:action') customerAction(@Param('id')id:string,@Param('action')action:string,@Body()body:any,@Req()r:any){return this.service.customerAct(renewalId.parse(id),action,body,r.customer.id);}
}
