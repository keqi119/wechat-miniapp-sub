import {nativeSigningConfig} from '../esign/native-signing';
import {Body,Controller,Get,Header,Inject,Post,Req,Res} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {IdentityGateway} from '../common/gateways';
import {mobile,audit} from '../common/data';
import {ensure} from '../common/errors';
import {acceptConsents,consentInput,currentDocuments} from '../auth/consents';
import {token,tokenHash} from '../auth/auth.service';
import {H5_COOKIE,H5_COOKIE_OPTIONS,h5Config} from './config';
const empty=z.object({}).strict();
function safe(customer:any,session:any){return{customer:{id:customer.id,maskedMobile:customer.mobile.slice(0,3)+'****'+customer.mobile.slice(-4)},csrfToken:session.csrfToken,expiresAt:session.expiresAt};}
@Controller()
export class H5AuthController{
 constructor(@Inject(Db)private db:Db,@Inject(IdentityGateway)private identity:IdentityGateway){}
 @Get('public/signing-config')@Header('Cache-Control','no-store')publicConfig(){return nativeSigningConfig();}
 @Get('h5-sign/config')config(){return h5Config();}
 @Get('h5-sign/legal')async legal(){const docs=await currentDocuments(this.db,['terms','privacy']);return{documents:docs.map(({id,type,version,title,content}:any)=>({id,type,version,title,content}))};}
 @Post('h5-sign/auth/sms/request')async sms(@Body()body:any){
  const input=z.object({mobile}).strict().parse(body),customer=await this.db.customer.findUnique({where:{mobile:input.mobile},select:{id:true}});
  if(customer)try{await this.identity.requestSms(input.mobile);}catch(error:any){const code=error.getResponse?.()?.error?.code;const errorCode=['SMS_RATE_LIMITED','SMS_UNAVAILABLE','SMS_SEND_FAILED'].includes(code)?code:'SMS_REQUEST_FAILED';await audit(this.db,customer.id,'H5_SMS_REQUEST_FAILED','customers',customer.id,{errorCode},'CUSTOMER');}
  return{accepted:true};
 }
 @Post('h5-sign/auth/login')async login(@Body()body:any,@Req()request:any,@Res({passthrough:true})response:any){
  const input=z.object({mobile,code:z.string().regex(/^\d{6}$/),consents:consentInput}).strict().parse(body);
  const customer=await this.db.customer.findUnique({where:{mobile:input.mobile}});ensure(customer,401,'LOGIN_UNAVAILABLE','无法登录，请先在小程序完成账号注册并核对验证码');
  for(const d of await currentDocuments(this.db,['terms','privacy']))ensure(input.consents.some(x=>x.documentId===d.id&&x.version===d.version),409,'CONSENT_VERSION','请阅读并同意当前用户协议及隐私政策');
  let result;try{result=await this.identity.verifySms({mobile:input.mobile,code:input.code});}catch(error:any){if(error.getResponse?.()?.error?.code==='SMS_CODE_INVALID')ensure(false,401,'LOGIN_UNAVAILABLE','无法登录，请先在小程序完成账号注册并核对验证码');throw error;}ensure(result.mobile===customer.mobile,401,'LOGIN_UNAVAILABLE','无法登录，请先在小程序完成账号注册并核对验证码');
  const raw=token(),csrfToken=token(),expiresAt=new Date(Date.now()+8*3600000);
  await this.db.serial(async tx=>{await acceptConsents(tx,customer.id,input.consents,['terms','privacy'],'H5_SIGNING_LOGIN');const old=request.cookies?.[H5_COOKIE];if(typeof old==='string')await tx.h5SigningSession.deleteMany({where:{id:tokenHash(old),customerId:customer.id}});await tx.h5SigningSession.create({data:{id:tokenHash(raw),customerId:customer.id,csrfToken,expiresAt}});await audit(tx,customer.id,'H5_SIGNING_LOGIN','customers',customer.id,{},'CUSTOMER');});
  response.cookie(H5_COOKIE,raw,{...H5_COOKIE_OPTIONS,expires:expiresAt});return safe(customer,{csrfToken,expiresAt});
 }
 @Get('h5-sign/auth/me')me(@Req()request:any){return safe(request.h5Customer,request.h5Session);}
 @Post('h5-sign/auth/logout')async logout(@Body()body:any,@Req()request:any,@Res({passthrough:true})response:any){empty.parse(body);await this.db.h5SigningSession.delete({where:{id:request.h5Session.id}});response.clearCookie(H5_COOKIE,H5_COOKIE_OPTIONS);return{success:true};}
}
