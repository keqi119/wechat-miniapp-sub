import {z} from 'zod';
import {audit,hash} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {archiveCommand} from '../offline-documents/command';
import type {StaffActor} from '../auth/staff.types';
import {validateV31Template,v31TemplateType} from '../contract-terms/template-map';

export const legalContentHash=(document:any)=>hash({type:document.type,version:document.version,title:document.title,content:document.content});
const inputSchema=z.object({confirmed:z.literal(true),expectedVersion:z.number().int().positive(),expectedContentHash:z.string().regex(/^[a-f0-9]{64}$/),idempotencyKey:z.string().min(8).max(128)}).strict();
const variables=new Set(['customerName','ownerName','lessorName','platformName','platformLegalEntityName','contractNumber','monthlyFee','deposit','termMonths','startDate','vehicleIdentification']);
const terminationVariables=new Set(['originalContractName','originalContractNumber','terminationReason','terminationEffectiveAt']);
// A single published amendment template serves delay, swap and renewal. Only
// their common frozen fields can be enabled; historical renderers keep their old tokens.
const amendmentVariables=new Set(['contractNo','orderNo','applicationId','originalContractNo','originalArchiveVersionId','originalArchiveHash','priorTermsVersionId','priorTermsHash','changeId','quoteRevision','commercialHash','customerName','customerPartyId','customerMobile','customerAddress','lessorName','lessorPartyId','lessorCreditCode','lessorAddress','lessorPhone','platformName','platformPartyId','changeFacts','periodSchedule','financialSchedule']);
const renewalCancellationVariables=new Set(['customerName','ownerName','platformName','originalContractNumber','cancellationReason','cancellationFacts','refundPolicy']);
const usageVariables=new Set(['baseAllowanceKm','excessPriceYuan','excessPriceAmount']);
const swapVariables=new Set(['extraFeeYuan','extraFeeAmount']);
export async function activateLegalTemplate(tx:any,id:string,raw:unknown,actor:StaffActor){
 const input=inputSchema.parse(raw),staff=await requireCurrentStaff(tx,actor,'legal-documents');
 ensure(['ADMIN','OPERATIONS'].includes(staff.role),403,'FORBIDDEN','仅有权限的平台运营可启用模板');
 const initial=await tx.legalDocument.findUnique({where:{id}});ensure(initial,404,'NOT_FOUND','模板不存在');
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`legal-template:${initial.type}`}))`;
 await tx.$queryRaw`SELECT id FROM "LegalDocument" WHERE id = ${id} FOR UPDATE`;
 return archiveCommand(tx,actor,`legal-document:${id}`,'ACTIVATE_TEMPLATE',input,async()=>{
  const document=await tx.legalDocument.findUnique({where:{id}});
  ensure(document?.status==='DRAFT',409,'STATE_CONFLICT','仅可启用草稿，新内容请另建版本');
  ensure(document.version===input.expectedVersion&&legalContentHash(document)===input.expectedContentHash,409,'REVISION_CONFLICT','模板正文或版本已变化，请重新核对');
  // Configurable benefit renderers consume raw content; OFFLINE renderers accept a body envelope.
  const v31=document.type.startsWith('ELECTRONIC_V31_');
  if(v31){const parsed=validateV31Template(JSON.parse(document.content));ensure(document.type===v31TemplateType(parsed.kind),409,'V31_TEMPLATE_INVALID','正文类型不匹配');}
  let body=v31?'已核验完整结构化正文及带入映射':document.content;if(!v31&&!['usage-policy-v2','swap-credit-v2'].includes(document.type))try{const parsed=JSON.parse(body);if(typeof parsed?.body==='string')body=parsed.body;}catch{}
  ensure(body?.trim()&&!/待补齐|待填写/.test(body),409,'LEGAL_PLACEHOLDERS','请先完成模板正文');
  const tokens=[...body.matchAll(/\{\{([^{}]+)\}\}/g)].map(match=>match[1]);
  const supported=document.type==='OFFLINE_ORDER_AMENDMENT'?amendmentVariables:document.type==='OFFLINE_RENEWAL_CANCELLATION'?renewalCancellationVariables:document.type==='usage-policy-v2'?usageVariables:document.type==='swap-credit-v2'?swapVariables:null;
  ensure(supported?tokens.every(token=>supported.has(token)):document.type.startsWith('OFFLINE_')?tokens.every(token=>variables.has(token)||document.type==='OFFLINE_TERMINATION'&&terminationVariables.has(token)):tokens.length===0,409,'LEGAL_PLACEHOLDERS','模板含不支持的字段，请核对正文');
  const required=document.type==='OFFLINE_ORDER_AMENDMENT'?['changeFacts','periodSchedule','financialSchedule']:document.type==='OFFLINE_RENEWAL_CANCELLATION'?['cancellationFacts','refundPolicy']:document.type==='usage-policy-v2'?['baseAllowanceKm','excessPriceYuan']:document.type==='swap-credit-v2'?['extraFeeYuan']:[];
  ensure(required.every(token=>tokens.includes(token)),409,'LEGAL_PLACEHOLDERS','模板须完整保留本类协议必需的事项、金额及规则字段');
  ensure(!body.replace(/\{\{[^{}]+\}\}/g,'').match(/\{\{|\}\}/),409,'LEGAL_PLACEHOLDERS','模板变量格式不完整');
  const now=new Date();await tx.legalDocument.updateMany({where:{type:document.type,status:'PUBLISHED'},data:{status:'RETIRED'}});
  const saved=await tx.legalDocument.update({where:{id},data:{status:'PUBLISHED',confirmedBy:actor.id,confirmedAt:now,publishedAt:now}});
  await audit(tx,actor.id,'ACTIVATE_TEMPLATE','legal-documents',id,{version:document.version,contentHash:input.expectedContentHash});
  return{...saved,contentHash:legalContentHash(saved)};
 });
}
