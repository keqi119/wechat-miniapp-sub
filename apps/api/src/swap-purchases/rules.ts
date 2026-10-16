import {hash} from '../common/data';
import {day,periods} from '../usage/rules';
export const SWAP_PRODUCT={id:'SWAP_CREDIT_1',quantity:1,amount:80000,currency:'CNY'} as const;
export const SWAP_TERMS='SWAP_CREDIT_V1';
export const purchaseEnabled=()=>process.env.SWAP_CREDIT_PURCHASE_ENABLED==='true';
export function termEnd(order:any,account:any){return new Date(day(periods(day(account.startedOn),order.finalPlanSnapshot.months).at(-1)!.endDate)+'T00:00:00+08:00');}
export function withinTerm(order:any,account:any,now:Date){return order.status==='ACTIVE'&&!account.returnedOn&&now>=new Date(day(account.startedOn)+'T00:00:00+08:00')&&now<termEnd(order,account);}
export async function swapTerms(tx:any){const doc=await tx.legalDocument.findFirst({where:{type:'vehicle-change',status:'PUBLISHED',confirmedAt:{not:null},confirmedBy:{not:null}},orderBy:{version:'desc'}});return doc?{version:SWAP_TERMS,documentId:doc.id,documentVersion:doc.version,hash:hash(doc.content),content:doc.content}:null;}
