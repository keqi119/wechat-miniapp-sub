import {requireSimplePartnerOperator} from '../partners/simple-access';
import {ensure} from '../common/errors';
import {resolveV31Sources,freezeV31Sources} from './sources';
import type {PartnerActor} from '../partners/types';
export async function readV31Readiness(tx:any,actor:PartnerActor,ownerId:string,cooperationVersionId:string){
 await requireSimplePartnerOperator(tx,actor);
 const version=await tx.partnerAgreementVersion.findUnique({where:{id:cooperationVersionId}});
 ensure(version?.ownerId===ownerId,404,'NOT_FOUND','合作版本不存在');
 const agreement=await tx.partnerAgreement.findUnique({where:{id:version.agreementId}});
 const result=await resolveV31Sources(tx,{kind:version.electronicTerms?.kind||'COOPERATION',resourceId:version.id,revision:agreement.revision,businessHash:version.contentHash});
 return{ready:result.missing.length===0,...result,hash:freezeV31Sources(result.snapshot).hash};
}
