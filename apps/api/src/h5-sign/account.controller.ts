import {Body,Controller,Get,Inject,Post,Req} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {requireCurrentConsents,currentDocuments} from '../auth/consents';
import {ensure} from '../common/errors';
import {audit,hash} from '../common/data';
import {CustomerESignOnboardingService} from '../esign/customer-esign-onboarding.service';
import {H5_RETURN,approvedProviderUrl,providerHosts} from './config';
const empty=z.object({}).strict();
@Controller('h5-sign/account')
export class H5AccountController{
 constructor(@Inject(Db)private db:Db,@Inject(CustomerESignOnboardingService)private accounts:CustomerESignOnboardingService){}
 @Get('readiness')readiness(@Req()r:any){return this.accounts.readiness(r.h5Customer.id);}
 @Post('register')async register(@Req()r:any,@Body()b:any){empty.parse(b);await requireCurrentConsents(this.db,r.h5Customer.id,['terms','privacy']);return this.accounts.register(r.h5Customer.id);}
 @Post('verify')async verify(@Req()r:any,@Body()b:any){
  const input=z.object({name:z.string().trim().min(2).max(50),idCardNo:z.string().regex(/^\d{17}[\dXx]$/),consent:z.object({accepted:z.literal(true),documentId:z.string().min(1),version:z.number().int().positive()}).strict()}).strict().parse(b);
  ensure(providerHosts().length>0,503,'H5_PROVIDER_CONFIG','签约跳转地址尚未配置');
  await this.db.serial(async tx=>{await requireCurrentConsents(tx,r.h5Customer.id,['terms','privacy']);const[doc]=await currentDocuments(tx,['privacy']);ensure(input.consent.documentId===doc.id&&input.consent.version===doc.version,409,'CONSENT_VERSION','请单独阅读并同意当前隐私政策中的实名信息处理');await audit(tx,r.h5Customer.id,'ESIGN_REALNAME_CONSENT','customers',r.h5Customer.id,{documentId:doc.id,version:doc.version,hash:hash(doc.content)},'CUSTOMER');});
  const result=await this.accounts.verify(r.h5Customer.id,{name:input.name,idCardNo:input.idCardNo},H5_RETURN);return{status:result.status,redirectUrl:approvedProviderUrl(result.url)};
 }
 @Post('refresh')async refresh(@Req()r:any,@Body()b:any){empty.parse(b);await requireCurrentConsents(this.db,r.h5Customer.id,['terms','privacy']);return this.accounts.refresh(r.h5Customer.id);}
}
