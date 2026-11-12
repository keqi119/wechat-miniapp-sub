import {ensure} from '../common/errors';
export async function requireAddonCustomer(tx:any,customerId:string,sessionId:string|undefined){
 ensure(sessionId,401,'SESSION_EXPIRED','请重新登录');const session=await tx.customerSession.findUnique({where:{id:sessionId}});
 ensure(session?.customerId===customerId&&session.expiresAt>new Date(),401,'SESSION_EXPIRED','登录已过期');
}
