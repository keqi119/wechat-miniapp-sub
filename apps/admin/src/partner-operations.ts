export type PartnerUser={role?:string;permissions?:string[];partnerCapabilities?:string[]};
export const partnerCapabilityGroups=[
 {label:'合作资料与档案',prefix:'cooperation',actions:['read','write','review']},
 {label:'手机号查看授权',prefix:'portal',actions:['read','write','review','disable']},
 {label:'分润规则',prefix:'rules',actions:['read','write','review']},
 {label:'收款账户',prefix:'accounts',actions:['read','write','review']},
 {label:'对账结算',prefix:'settlements',actions:['read','write','review']},
 {label:'线下实付',prefix:'payments',actions:['read','record','review']},
].map(g=>({...g,capabilities:g.actions.map(action=>`partner.${g.prefix}.${action}`)}));
export function hasPartnerCapability(user:PartnerUser|undefined,key:string){return user?.role!=='FIELD'&&((user?.role==='ADMIN'&&(key.startsWith('partner.cooperation.')||key.startsWith('partner.portal.')))||!!user?.partnerCapabilities?.includes(key));}
export function ruleDraftBody(ownerId:string,values:Record<string,unknown>){
 const{evidenceFileIds=[],...raw}=values;const terms=Object.fromEntries(Object.entries(raw).map(([key,value])=>[key,value===''?null:value]));
 return{ownerId,evidenceFileIds,terms:{...terms,rateBps:terms.method==='RATE'?terms.rateBps??null:null,fixedMonthlyAmount:terms.method==='FIXED_MONTHLY'?terms.fixedMonthlyAmount??null:null,customAgreement:terms.method==='CUSTOM'?terms.customAgreement??null:null}};
}
export type FrozenDomain={domain:'SUBJECT'|'VEHICLE'|'ARCHIVE'|'RULE';resourceId:string;revision:number;[key:string]:unknown};
export type Submission={id:string;revision:number;hash:string;domainVersions:FrozenDomain[]};
export function cooperationReviewBody(submission:Submission,values:Record<string,unknown>,reviews:Record<string,unknown>[]){
 if(reviews.length!==submission.domainVersions.length||reviews.some(r=>!r))throw new Error('请逐项核对本批次全部真实材料');
 return{submissionId:submission.id,submissionHash:submission.hash,decision:values.decision,reason:values.reason,domainReviews:submission.domainVersions.map((domain,index)=>({domain:domain.domain,resourceId:domain.resourceId,revision:domain.revision,review:reviews[index]}))};
}
