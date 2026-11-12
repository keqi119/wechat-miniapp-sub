import { z } from 'zod';
export type SubjectType='ENTERPRISE'|'INDIVIDUAL';
export type ContractMode='OFFLINE'|'ESIGN';
export type CommandContext={actorId:string;role:string;idempotencyKey:string};
export type VersionedInput={revision:number};
export type GateResult={ready:boolean;blockers:{code:string;label:string;resourceType:string;resourceId:string}[]};
export const moduleIds=['vehicles','customers','partners','insurance','products','orders','contracts'] as const;
export const fenAmount=z.number().int().min(0).max(2147483647);
const common={name:z.string().trim().min(1).max(100),address:z.string().trim().min(1).max(500),contactPhone:z.string().regex(/^1[3-9]\d{9}$/)};
export const subjectInput=z.discriminatedUnion('subjectType',[
 z.object({...common,subjectType:z.literal('ENTERPRISE'),creditCode:z.string().regex(/^[0-9A-Z]{18}$/)}).strict(),
 z.object({...common,subjectType:z.literal('INDIVIDUAL')}).strict()
]);
const rule={basis:z.string().trim().min(1).max(1000),refundRule:z.string().trim().min(1).max(1000),settlementCycle:z.enum(['MONTHLY','CUSTOM'])};
export const revenueRuleInput=z.discriminatedUnion('method',[
 z.object({...rule,method:z.literal('RATE'),rateBps:z.number().int().min(0).max(10000)}).strict(),
 z.object({...rule,method:z.literal('FIXED_MONTHLY'),fixedAmount:fenAmount}).strict(),
 z.object({...rule,method:z.literal('CUSTOM'),terms:z.string().trim().min(1).max(5000)}).strict()
]);
