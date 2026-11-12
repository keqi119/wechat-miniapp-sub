import {z} from 'zod';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {getPartnerCapabilities,requirePartnerCapability,type PartnerCapability} from './capabilities';
import {archiveCommand} from '../offline-documents/command';
import type {PartnerActor} from './types';
export type RevenueActor=PartnerActor;
const id=z.string().trim().min(1).max(128),description=z.string().trim().min(1).max(2000);
export const amount=z.number().int().min(-2147483647).max(2147483647);
const positive=amount.refine(n=>n>0);
export const commandFields={revision:z.number().int().nonnegative(),idempotencyKey:z.string().min(8).max(128)};
export function businessDayStart(value:string|Date){const date=typeof value==='string'?value:value.toISOString().slice(0,10);z.iso.date().parse(date);return new Date(`${date}T00:00:00+08:00`);}
export const evidenceIds=z.array(id).min(1).max(20).refine(a=>new Set(a).size===a.length);
export const revenueTermsInput=z.object({cooperationVersionId:id,vehicleIds:z.array(id).min(1).max(500).refine(a=>new Set(a).size===a.length),validFrom:z.iso.date(),validUntil:z.iso.date(),method:z.enum(['RATE','FIXED_MONTHLY','CUSTOM']),rateBps:z.number().int().min(0).max(10000).nullable(),fixedMonthlyAmount:positive.nullable(),customAgreement:description.nullable(),basis:description,deductions:description,refundRule:description,cycle:description,expenseResponsibility:description}).strict().refine(v=>v.validUntil>=v.validFrom,'有效期无效').refine(v=>v.method==='RATE'?v.rateBps!==null&&v.fixedMonthlyAmount===null&&v.customAgreement===null:v.method==='FIXED_MONTHLY'?v.rateBps===null&&v.fixedMonthlyAmount!==null&&v.customAgreement===null:v.rateBps===null&&v.fixedMonthlyAmount===null&&v.customAgreement!==null,'分润方式与字段不一致');
export const revenueDraftTermsInput=z.object({cooperationVersionId:id.nullish(),vehicleIds:z.array(id).max(500).refine(a=>new Set(a).size===a.length).nullish(),validFrom:z.iso.date().nullish(),validUntil:z.iso.date().nullish(),method:z.enum(['RATE','FIXED_MONTHLY','CUSTOM']).nullish(),rateBps:z.number().int().min(0).max(10000).nullish(),fixedMonthlyAmount:positive.nullish(),customAgreement:description.nullish(),basis:description.nullish(),deductions:description.nullish(),refundRule:description.nullish(),cycle:description.nullish(),expenseResponsibility:description.nullish()}).strict().refine(v=>!v.validFrom||!v.validUntil||v.validUntil>=v.validFrom,'有效期无效');
export const ruleInput=z.object({terms:revenueDraftTermsInput,evidenceFileIds:z.array(id).max(20).refine(a=>new Set(a).size===a.length),...commandFields}).strict();
export function revenueRuleMissingFields(version:{terms:unknown;evidenceFileIds:string[]}){const parsed=revenueTermsInput.safeParse(version.terms),missing=parsed.success?[]:parsed.error.issues.map(issue=>({code:`RULE_${String(issue.path[0]||'TERMS').toUpperCase()}_REQUIRED`,section:'RULE',message:issue.path[0]?`请补齐或确认分润约定 ${String(issue.path[0])}`:'请确认分润方式与有效期'}));if(!version.evidenceFileIds.length)missing.push({code:'RULE_EVIDENCE_REQUIRED',section:'RULE',message:'请上传真实分润约定依据'});return missing;}
export const reviewInput=z.object({...commandFields,decision:z.enum(['APPROVE','REJECT']),reason:description}).strict();
export const commandInput=z.object(commandFields).strict();
export const accountInput=z.object({accountName:z.string().trim().min(2).max(200),bankName:z.string().trim().min(2).max(200),accountNumber:z.string().regex(/^\d{8,32}$/),evidenceFileIds:evidenceIds}).strict();
export const accountCommandInput=accountInput.extend(commandFields).strict();
export const lineInput=z.object({category:z.enum(['REVENUE','REFUND_ADJUSTMENT','FEE','ADJUSTMENT']),orderId:id.optional(),sourceType:z.enum(['PAYMENT','REFUND']).optional(),sourceId:id.optional(),sourceShareAmount:amount.refine(n=>n>=0),payableAmount:amount,ruleVersionId:id.optional(),originalSettlementLineId:id.optional(),explanation:description,evidenceFileIds:evidenceIds}).strict().superRefine((v,c)=>{let valid=true;if(v.category==='REVENUE')valid=!!v.orderId&&v.sourceType==='PAYMENT'&&!!v.sourceId&&v.sourceShareAmount>0&&v.payableAmount>=0&&!!v.ruleVersionId&&!v.originalSettlementLineId;else if(v.category==='REFUND_ADJUSTMENT')valid=!!v.orderId&&v.sourceType==='REFUND'&&!!v.sourceId&&v.sourceShareAmount>0&&v.payableAmount<=0&&!!v.ruleVersionId&&!!v.originalSettlementLineId;else valid=!v.sourceId&&!v.sourceType&&v.sourceShareAmount===0&&!v.originalSettlementLineId;if(!valid)c.addIssue({code:'custom',message:'结算行类别、来源及正负金额不一致'});});
export const settlementInput=z.object({periodStart:z.iso.date(),periodEnd:z.iso.date(),accountVersionId:id,lines:z.array(lineInput).min(1).max(200),payableAmount:amount,explanation:description,...commandFields}).strict().refine(v=>v.periodEnd>v.periodStart,'账期使用起日含、止日不含');
export const paymentInput=z.object({amount:positive,paidOn:z.iso.date(),reference:z.string().trim().min(1).max(200),evidenceFileIds:evidenceIds,...commandFields}).strict();
export function maskedAccount<T extends {accountNumber:string}>(value:T){return{...value,accountNumber:'*'.repeat(Math.max(0,value.accountNumber.length-4))+value.accountNumber.slice(-4)};}
export function assertIndependent(actorId:string,createdBy:string,files:Array<{adminId?:string|null}>){ensure(actorId!==createdBy&&!files.some(f=>f.adminId===actorId),409,'SETTLEMENT_SELF_REVIEW','编制人或依据上传人不能复核本人材料');}
export function assertSettlementTotal(lines:Array<{payableAmount:number}>,expected:number){const total=lines.reduce((sum,line)=>sum+BigInt(line.payableAmount),0n);ensure(total===BigInt(expected),409,'SETTLEMENT_TOTAL_MISMATCH','应付金额必须等于人工填写的明细合计');}
export function assertSourceShare(source:{billType:string;amount:number;used:number},share:number){ensure(!['DEPOSIT','DEPOSIT_ADJUSTMENT'].includes(source.billType)&&!source.billType.toUpperCase().includes('DEPOSIT'),409,'DEPOSIT_NOT_REVENUE','押金不能作为分润来源');ensure(Number.isInteger(share)&&share>0&&source.used+share<=source.amount,409,'SETTLEMENT_SOURCE_EXCEEDED','来源份额已使用或超出可追溯余额');}
export function assertOriginalRefundCapacity(original:{sourceShareAmount:number;payableAmount:number},prior:{share:number;payable:number},share:number,payable:number){ensure(prior.share+share<=original.sourceShareAmount&&prior.payable+Math.abs(payable)<=original.payableAmount,409,'SETTLEMENT_SOURCE_EXCEEDED','退款调整超出原结算可追溯份额或原应付金额');}
export function assertPaymentRecord(payable:number,actual:number,files:string[]){ensure(payable>0&&actual===payable&&files.length>0,409,'SETTLEMENT_PAYMENT_INVALID','仅可登记整单正数应付，且须有线下付款凭证');}
export function assertAccountFrozen(account:any,id:string,contentHash:string){ensure(account&&account.id===id&&account.status==='APPROVED'&&account.contentHash===contentHash,409,'SETTLEMENT_ACCOUNT_CHANGED','收款对象已失效或变更，请退回复核后重新编制结算单');}
export async function requireFinance(tx:any,actor:RevenueActor,write=true){return requirePartnerCapability(tx,actor,write?'partner.settlements.write':'partner.settlements.read');}
export async function requireRuleOperator(tx:any,actor:RevenueActor,write=true){return requirePartnerCapability(tx,actor,write?'partner.rules.write':'partner.rules.read');}
export async function lockFinanceOwner(tx:any,ownerId:string){await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id = ${ownerId} FOR UPDATE`;const owner=await tx.vehicleOwner.findUnique({where:{id:ownerId}});ensure(owner,404,'NOT_FOUND','合作商不存在');return owner;}
export function financeActionCapability(action:string):PartnerCapability{
 if(action.startsWith('rule.create:')||action.startsWith('rule.submit:'))return 'partner.rules.write';
 if(action.startsWith('rule.review:'))return 'partner.rules.review';
 if(action==='account.submit')return 'partner.accounts.write';
 if(action.startsWith('account.review:'))return 'partner.accounts.review';
 if(action.startsWith('settlement.payment.record:'))return 'partner.payments.record';
 if(action.startsWith('settlement.payment.reconcile:'))return 'partner.payments.review';
 if(action==='settlement.create'||action.startsWith('settlement.submit:')||action.startsWith('settlement.feedback.'))return 'partner.settlements.write';
 if(action.startsWith('settlement.review:'))return 'partner.settlements.review';
 const upload:Record<string,PartnerCapability>={RULE:'partner.rules.write',ACCOUNT:'partner.accounts.write',SETTLEMENT:'partner.settlements.write',PAYMENT:'partner.payments.record'};
 if(action.startsWith('file.upload:')&&upload[action.slice(12)])return upload[action.slice(12)];
 ensure(false,403,'FORBIDDEN','未知合作财务动作');
}
export function financialReadCapability(kind:string):PartnerCapability{const keys:Record<string,PartnerCapability>={RULE:'partner.rules.read',ACCOUNT:'partner.accounts.read',SETTLEMENT:'partner.settlements.read',PAYMENT:'partner.payments.read'};ensure(keys[kind],403,'FORBIDDEN','未知合作材料类别');return keys[kind];}
export function redactFinanceResult(value:any,staff:any,payment=false):any{
 const capabilities=getPartnerCapabilities(staff);
 if(Array.isArray(value))return value.map(row=>redactFinanceResult(row,staff,payment));
 if(value===null||typeof value!=='object'||value instanceof Date)return value;
 const result:any={};for(const [key,field] of Object.entries(value)){
  if(key==='payments'&&!capabilities.includes('partner.payments.read')){result.payments=[];continue;}
  if(payment&&!capabilities.includes('partner.payments.read')&&['reference','evidenceFileIds'].includes(key))continue;
  if(key==='accountHash'&&!capabilities.includes('partner.accounts.read'))continue;
  result[key]=key==='accountNumber'&&!capabilities.includes('partner.accounts.read')&&typeof field==='string'?maskedAccount({accountNumber:field}).accountNumber:redactFinanceResult(field,staff,payment);
 }return result;
}
export async function financeCommand(tx:any,actor:RevenueActor,ownerId:string,action:string,input:{idempotencyKey:string},operation:()=>Promise<any>,_rule=false){const staff=await requirePartnerCapability(tx,actor,financeActionCapability(action));await lockFinanceOwner(tx,ownerId);const result=await archiveCommand(tx,actor,`partner-finance:${ownerId}`,action,input,operation);return redactFinanceResult(result,staff,action.startsWith('settlement.payment.'));}
export async function financialFiles(tx:any,ownerId:string,ids:string[],kind='SETTLEMENT'){ensure(ids.length>0&&new Set(ids).size===ids.length,409,'SETTLEMENT_EVIDENCE_REQUIRED','请提供结算依据');const files=await tx.storedFile.findMany({where:{id:{in:ids}}}),bindings=await tx.partnerSettlementFile.findMany({where:{ownerId,fileId:{in:ids},kind}});ensure(files.length===ids.length&&bindings.length===ids.length&&bindings.every((b:any)=>b.ownerId===ownerId&&b.kind===kind&&ids.includes(b.fileId))&&files.every((f:any)=>f.adminId&&f.purpose==='partner-settlement'&&/^[a-f0-9]{64}$/.test(f.sha256)),409,'SETTLEMENT_EVIDENCE_REQUIRED','结算依据缺失、用途不符或不属于本合作商');return files;}
export function changedRevision(record:any,revision:number){ensure(record.revision===revision,409,'REVISION_CONFLICT','资料已变化，请刷新后重试');}
export const accountHash=(account:{accountName:string;bankName:string;accountNumber:string})=>hash({accountName:account.accountName,bankName:account.bankName,accountNumber:account.accountNumber});
