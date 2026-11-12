import {portalMobileHash} from '../partners/portal-access';
import {validPortalGrants} from '../partners/portal-session';
import {hash} from '../common/data';
import {tokenHash} from '../auth/auth.service';
import { ownerLegalLoginEligibility, ownerMobileHash } from './legal-representative';
import { requireElectronicOwnerSession } from './electronic-access';
import { ensure } from '../common/errors';
import {virtualActorScope} from '../virtual-acceptance/actors';
export async function legalLoginScopes(tx: any, mobile: string, invitationToken?: string) {
    const customer=await tx.customer.findUnique({where:{mobile}}),scope=customer?await virtualActorScope(tx,customer.id,{current:false}):null;
    ensure(process.env.NEW_ORDER_CONTRACT_MODE === 'ELECTRONIC'||scope&&scope.customerId!==customer.id, 403, 'LEGAL_ENTRY_DISABLED', '电子签署入口尚未开放');
    const eligible = await ownerLegalLoginEligibility(tx, mobile, invitationToken);
    return (eligible?.choices ?? []).map(choice => ({ ownerId: choice.ownerId, legalRevision: choice.revision, legalMobileHash: ownerMobileHash(mobile) }));
}
export async function legalSessionView(tx: any, session: any) {
    const customer = await requireElectronicOwnerSession(tx, session);
    const grants=await validPortalGrants(tx,await tx.partnerPortalAccess.findMany({where:{mobileHash:portalMobileHash(customer.mobile),status:'ENABLED'}}));
    return { mode: 'ELECTRONIC_LEGAL', readonlyAvailable:grants.length>0, sessionBinding:hash({purpose:'owner-return',id:session.id}),csrfToken: session.csrfToken, expiresAt: session.expiresAt, viewer: { maskedMobile: customer.mobile.slice(0, 3) + '****' + customer.mobile.slice(-4) }, owners: session.identitySnapshot.owners };
}

export function loginScopeDigest(scopes:unknown[],purpose?:'ELECTRONIC_LEGAL'|'ENTERPRISE_CENTER',invitationToken?:string,mode?:string){
 return hash(purpose?{purpose,...(purpose==='ENTERPRISE_CENTER'?{mode}:{}),invitation:invitationToken?tokenHash(invitationToken):null,scopes}:scopes);
}
