import type { Prisma } from '@prisma/client';
import { ensure } from '../common/errors';
import { allowed } from './role-policy';
import type { StaffActor } from './staff.types';

export async function requireCurrentStaff(tx:Prisma.TransactionClient,actor:StaffActor,resource:string,write=true) {
  const current=await tx.adminUser.findUnique({where:{id:actor.id}});
  ensure(current?.active&&current.role===actor.role&&(actor.authVersion===undefined||current.authVersion===actor.authVersion),403,'STAFF_SESSION_CHANGED','人员权限已变化，请重新登录');
  ensure(allowed(current.role,resource,write),403,'FORBIDDEN','当前角色无权执行此操作');
  return current;
}
