import {realnameInput,recordRealnameConsent} from '../esign/realname-consent';
import {Body,Controller,Get,Inject,Post,Req} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {requireCurrentConsents} from '../auth/consents';
import {ensure} from '../common/errors';
import {CustomerESignOnboardingService} from '../esign/customer-esign-onboarding.service';
import {H5_RETURN,approvedProviderUrl,providerHosts} from './config';
const empty=z.object({}).strict();
@Controller('h5-sign/account')
export class H5AccountController{
 constructor(@Inject(Db)private db:Db,@Inject(CustomerESignOnboardingService)private accounts:CustomerESignOnboardingService){}
 @Get('readiness')readiness(@Req()r:any){return this.accounts.readiness(r.h5Customer.id);}
 @Post('register')async register(@Req()r:any,@Body()b:any){empty.parse(b);await requireCurrentConsents(this.db,r.h5Customer.id,['terms','privacy']);return this.accounts.register(r.h5Customer.id);}
 @Post('verify')async verify(@Req()r:any,@Body()b:any){
  const input=realnameInput.parse(b);
  ensure(providerHosts().length>0,503,'H5_PROVIDER_CONFIG','签约跳转地址尚未配置');
  await recordRealnameConsent(this.db,r.h5Customer.id,input.consent,'H5');
  const result=await this.accounts.verify(r.h5Customer.id,{name:input.name,idCardNo:input.idCardNo},H5_RETURN);return{status:result.status,redirectUrl:approvedProviderUrl(result.url)};
 }
 @Post('refresh')async refresh(@Req()r:any,@Body()b:any){empty.parse(b);await requireCurrentConsents(this.db,r.h5Customer.id,['terms','privacy']);return this.accounts.refresh(r.h5Customer.id);}
}
