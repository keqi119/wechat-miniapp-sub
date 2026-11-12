import {hash} from '../common/data';
import {day,periods} from '../usage/rules';
import {ensure} from '../common/errors';
import {freezeSwapPolicy,renderSwapTemplate,type SwapPolicySource} from './policy';
export const SWAP_PRODUCT={id:'SWAP_CREDIT_1',quantity:1,amount:80000,currency:'CNY'} as const;
export const SWAP_TERMS='SWAP_CREDIT_V1';
export const purchaseEnabled=()=>process.env.MVP_V2_ENABLED!=='true'&&process.env.SWAP_CREDIT_PURCHASE_ENABLED==='true';
export function termEnd(order:any,account:any){return new Date(day(periods(day(account.startedOn),order.finalPlanSnapshot.months).at(-1)!.endDate)+'T00:00:00+08:00');}
export function withinTerm(order:any,account:any,now:Date){return order.status==='ACTIVE'&&!account.returnedOn&&now>=new Date(day(account.startedOn)+'T00:00:00+08:00')&&now<termEnd(order,account);}
export async function swapTerms(tx:any,order?:any,source?:SwapPolicySource){const policy=source?source.policy:order?freezeSwapPolicy(order):null,type=policy?'swap-credit-v2':'vehicle-change',doc=await tx.legalDocument.findFirst({where:{type,status:'PUBLISHED',confirmedAt:{not:null},confirmedBy:{not:null}},orderBy:{version:'desc'}});if(!doc)return null;if(policy){ensure(doc.type===type&&doc.status==='PUBLISHED'&&doc.confirmedAt&&doc.confirmedBy,409,'SWAP_POLICY','换车购买模板尚未批准');const content=renderSwapTemplate(doc.content,policy.extraFeeAmount);return{version:'SWAP_CREDIT_V2',documentId:doc.id,documentVersion:doc.version,templateContent:doc.content,templateHash:hash(doc.content),hash:hash(content),content};}return{version:SWAP_TERMS,documentId:doc.id,documentVersion:doc.version,hash:hash(doc.content),content:doc.content};}
