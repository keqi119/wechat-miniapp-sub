import {z} from 'zod';

export const policyTypes=['COMPULSORY_TRAFFIC','COMMERCIAL','DRIVER_PASSENGER','OTHER'] as const;
const date=z.union([z.date(),z.string().datetime({offset:true}).transform(value=>new Date(value))]);
const unique=(ids:string[])=>new Set(ids).size===ids.length;
const same=(a:string[],b:string[])=>a.length===b.length&&a.every(id=>b.includes(id));
const file=z.object({id:z.string().min(1),name:z.string().min(1),mimeType:z.enum(['application/pdf','image/jpeg','image/png']),size:z.number().int().positive().max(10*1024*1024),sha256:z.string().regex(/^[a-f0-9]{64}$/),vehicleIds:z.array(z.string().min(1)).min(1).refine(unique)}).strict();
export const registrationSnapshot=z.object({schemaVersion:z.literal(1),confirmed:z.literal(true),registeredBy:z.string().min(1),registeredAt:z.string().datetime({offset:true}),policy:z.object({insurer:z.string().min(1),policyNumber:z.string().min(1),policyType:z.enum(policyTypes),insuredParty:z.string().min(1),startAt:z.string().datetime({offset:true}),endAt:z.string().datetime({offset:true})}).strict(),vehicles:z.array(z.object({id:z.string().min(1),vin:z.string().nullable(),plateNumber:z.string().nullable(),title:z.string().min(1)}).strict()).min(1).max(1000),files:z.array(file).min(1).max(20)}).strict();
const registeredVersion=z.object({status:z.literal('REGISTERED'),registeredBy:z.string().min(1),registeredAt:date,effectiveAt:date,policyType:z.enum(policyTypes),insurerSnapshot:z.string().min(1),policyNumberSnapshot:z.string().min(1),insuredParty:z.string().min(1),startAt:date,endAt:date,vehicleIds:z.array(z.string().min(1)).min(1).refine(unique),fileIds:z.array(z.string().min(1)).min(1).max(20).refine(unique),coverageItems:z.array(z.never()).max(0),terms:z.literal(''),requirementVersionIds:z.array(z.never()).max(0),registrationSnapshot});

// A REGISTERED row is evidence of this operator's document registration, not an independent review of clauses.
export function validRegistration(raw:unknown,vehicleId?:string):boolean{
 const p=registeredVersion.safeParse(raw);if(!p.success)return false;
 const v=p.data,s=v.registrationSnapshot,ids=s.vehicles.map(row=>row.id),fileIds=s.files.map(row=>row.id);
 if(!unique(ids)||!unique(fileIds)||!same(v.vehicleIds,ids)||!same(v.fileIds,fileIds)||v.startAt>=v.endAt||v.effectiveAt<v.registeredAt)return false;
 if(v.registeredBy!==s.registeredBy||v.registeredAt.toISOString()!==s.registeredAt||v.policyType!==s.policy.policyType||v.insurerSnapshot!==s.policy.insurer||v.policyNumberSnapshot!==s.policy.policyNumber||v.insuredParty!==s.policy.insuredParty||v.startAt.toISOString()!==s.policy.startAt||v.endAt.toISOString()!==s.policy.endAt)return false;
 if(!v.vehicleIds.every(id=>s.files.some(f=>f.vehicleIds.includes(id)))||s.files.some(f=>!f.vehicleIds.every(id=>v.vehicleIds.includes(id))))return false;
 return vehicleId===undefined||v.vehicleIds.includes(vehicleId)&&s.files.some(f=>f.vehicleIds.includes(vehicleId));
}

export function activatedStatus(status:string){return status==='APPROVED'||status==='REGISTERED';}

export function effectivePolicyVersion<T extends {version:number;status:string;effectiveAt:Date|string}>(rows:T[],at:Date):T|undefined{
 const active=rows.filter(v=>activatedStatus(v.status)&&new Date(v.effectiveAt)<=at);
 // A correction saved through registration also supersedes scheduled legacy approvals.
 // Otherwise a future old endorsement could silently reactivate after today's correction.
 const registration=active.filter(v=>v.status==='REGISTERED').sort((a,b)=>b.version-a.version)[0];
 return active.filter(v=>!registration||v.version>=registration.version).sort((a,b)=>new Date(b.effectiveAt).getTime()-new Date(a.effectiveAt).getTime()||b.version-a.version)[0];
}
