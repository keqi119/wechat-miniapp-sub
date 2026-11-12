import {ensure} from '../common/errors';
import {ArchiveActor} from './schemas';
import {requirePartnerReadAccess} from '../partners/portal-session';
import {lessorIdentityHash} from '../owner-signing/lessor';
export function ownerOrderSharingValid(order:any,ownerId:string){
 const snapshot=order?.finalPlanSnapshot,lessor=snapshot?.lessorSnapshot,consent=snapshot?.ownerDataConsent;
 return !!lessor&&!!consent&&lessor.ownerId===ownerId&&consent.ownerId===ownerId&&consent.customerId===order.customerId&&!!consent.acceptedAt&&Number.isFinite(new Date(consent.acceptedAt).getTime())&&consent.lessorHash===lessorIdentityHash(lessor)&&!!lessor.sharingNotice?.contentHash&&consent.notice?.contentHash===lessor.sharingNotice.contentHash;
}
export async function sharedOwnerOrderIds(tx:any,ownerId:string){
 const orders=await tx.order.findMany({where:{AND:[{finalPlanSnapshot:{path:['lessorSnapshot','ownerId'],equals:ownerId}},{finalPlanSnapshot:{path:['ownerDataConsent','ownerId'],equals:ownerId}}]},select:{id:true,customerId:true,finalPlanSnapshot:true}});
 return orders.filter((order:any)=>ownerOrderSharingValid(order,ownerId)).map((order:any)=>order.id);
}
export async function requireArchivePartnerIdentity(tx:any,actor:ArchiveActor,ownerId:string){
 ensure(actor.ownerId===ownerId,404,'NOT_FOUND','档案不存在');
 const session=(actor as any).partnerSession;
 ensure(session&&session.mode==='PARTNER_READONLY'&&session.id===actor.id&&!actor.customerId,401,'PARTNER_SESSION_REQUIRED','请通过合作商中心登录后读取档案');
 return requirePartnerReadAccess(tx,session,ownerId);
}
