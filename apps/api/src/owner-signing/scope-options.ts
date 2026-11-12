import {newOrderContractMode} from '../offline-documents/mode';
import {hash} from '../common/data';
import {ownerAuthorizationDelegate,ownerAuthorizationScopeVersion} from './rules';
import {ownerAuthorizationMethod} from './authorization-method';
import {currentPlatformScope} from './platform-authorization-evidence';
import {PLATFORM_SIGNING_GRANTEE,platformAutoDocumentKinds} from './platform-scope';

export async function ownerAuthorizationOptions(db:any,ownerId:string){
 const scopeVersion=ownerAuthorizationScopeVersion(),authorizationMethod=ownerAuthorizationMethod(),unilateral=authorizationMethod==='UNILATERAL_LETTER';
 if(scopeVersion===3)return{scopeVersion,authorizationMethod,scope:await currentPlatformScope(db,ownerId),grantee:PLATFORM_SIGNING_GRANTEE,documentKinds:platformAutoDocumentKinds,authorizationNotice:null};
 const template=await db.legalDocument.findFirst({where:{type:newOrderContractMode()==='ELECTRONIC'?'ELECTRONIC_V31_SUBSCRIPTION':'owner-rental-contract',status:'PUBLISHED',confirmedAt:{not:null},confirmedBy:{not:null}},orderBy:{version:'desc'}});
 const view=template?{id:template.id,version:template.version,hash:hash(template.content),title:template.title}:null;
 if(scopeVersion===1){const vehicles=await db.ownerVehicle.findMany({where:{ownerId,status:'APPROVED'},select:{vehicleId:true,vehicle:{select:{title:true}}}});return{vehicles,template:view};}
 const notice=await db.legalDocument.findFirst({where:{type:'owner-auto-sign',status:'PUBLISHED',version:{gte:unilateral?3:2},confirmedAt:{not:null},confirmedBy:{not:null}},orderBy:{version:'desc'}});
 const letter=unilateral?await db.legalDocument.findFirst({where:{type:'owner-authorization-letter',status:'PUBLISHED',confirmedAt:{not:null},confirmedBy:{not:null}},orderBy:{version:'desc'}}):null;
 return{scopeVersion:2 as const,authorizationMethod,...(unilateral?{authorizationLetterTemplate:letter?{id:letter.id,version:letter.version,hash:hash(letter.content),title:letter.title}:null}:{}),delegates:[ownerAuthorizationDelegate()],documentKinds:view?[{id:'SUBSCRIPTION_WITH_FEES' as const,label:'汽车订阅主合同及费用附件',template:view}]:[],authorizationNotice:notice?{id:notice.id,version:notice.version,hash:hash(notice.content)}:null};
}
