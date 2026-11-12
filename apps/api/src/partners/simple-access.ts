import {ensure} from '../common/errors';
import type {PartnerActor} from './types';

/** Direct registration is a role permission; legacy finance capabilities stay separate. */
export async function requireSimplePartnerOperator(tx:any,actor:PartnerActor){
 const current=await tx.adminUser.findUnique({where:{id:actor.id}});
 ensure(current?.active&&current.role===actor.role&&Number.isInteger(actor.authVersion)&&current.authVersion===actor.authVersion,403,'STAFF_SESSION_CHANGED','人员权限已变化，请重新登录');
 ensure(['ADMIN','OPERATIONS'].includes(current.role),403,'FORBIDDEN','仅管理员及运营可维护合作商');
 return current;
}
