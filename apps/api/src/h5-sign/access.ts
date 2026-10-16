import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {tokenHash} from '../auth/auth.service';
import {H5_COOKIE,h5Enabled,h5Origin} from './config';
const publicGet=['/h5-sign/config','/h5-sign/legal'];
const publicPost=['/h5-sign/auth/sms/request','/h5-sign/auth/login'];
export async function h5Access(db:Db,request:any,response:any,path:string){
 response.setHeader('Cache-Control','no-store');response.setHeader('Referrer-Policy','no-referrer');response.setHeader('X-Content-Type-Options','nosniff');
 if(request.method==='GET'&&publicGet.includes(path))return true;
 ensure(h5Enabled(),503,'H5_SIGNING_DISABLED','独立签约入口暂未开放');
 if(!['GET','HEAD','OPTIONS'].includes(request.method))h5Origin(request);
 if(request.method==='POST'&&publicPost.includes(path))return true;
 const raw=request.cookies?.[H5_COOKIE];ensure(typeof raw==='string'&&/^[a-f0-9]{64}$/.test(raw),401,'UNAUTHENTICATED','请登录签约中心');
 const session=await db.h5SigningSession.findUnique({where:{id:tokenHash(raw)},include:{customer:true}});ensure(session&&session.expiresAt>new Date(),401,'SESSION_EXPIRED','签约登录已过期');
 if(!['GET','HEAD','OPTIONS'].includes(request.method))ensure(request.headers['x-csrf-token']===session.csrfToken,403,'CSRF_DENIED','请求校验失败');
 request.h5Customer=session.customer;request.h5Session=session;return true;
}
