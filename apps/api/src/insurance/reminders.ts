import {z} from 'zod';
import {InsuranceTx,ReminderCandidate} from './types';
import {effectivePolicyVersion,validRegistration} from './registration-facts';
const reminderVersion=z.object({id:z.string(),policyId:z.string(),version:z.number(),status:z.string(),changeKind:z.string(),effectiveAt:z.date(),endAt:z.date(),vehicleIds:z.array(z.string())}).passthrough();
const shanghaiDay=(date:Date)=>Math.floor((date.getTime()+8*3600000)/86400000);
export function reminderCandidates(rawVersions:unknown[],now:Date):ReminderCandidate[]{
 const versions=rawVersions.flatMap(row=>{const p=reminderVersion.safeParse(row);return p.success?[p.data]:[];});
 const policies=new Map<string,typeof versions[number]>();
 for(const id of new Set(versions.map(v=>v.policyId))){const row=effectivePolicyVersion(versions.filter(v=>v.policyId===id),now);if(row)policies.set(id,row);}
 const candidates:ReminderCandidate[]=[];
 for(const row of policies.values())if(row.changeKind!=='CANCELLATION'&&(row.status!=='REGISTERED'||validRegistration(row)))for(const thresholdDays of [30,7,0])if(shanghaiDay(row.endAt)-shanghaiDay(now)<=thresholdDays)for(const vehicleId of row.vehicleIds)candidates.push({vehicleId,policyId:row.policyId,policyVersionId:row.id,thresholdDays,dueAt:new Date(row.endAt.getTime()-thresholdDays*86400000)});
 return candidates;
}
export async function createRenewalReminders(tx:InsuranceTx,now:Date):Promise<number>{
 const versions=await tx.insurancePolicyVersion.findMany({where:{status:{in:['APPROVED','REGISTERED']}}}),candidates=reminderCandidates(versions,now);
 if(!candidates.length)return 0;
 // Durable work items are the notification source. Unique keys survive restarts and avoid duplicate delivery.
 return (await tx.insuranceRenewalReminder.createMany({data:candidates,skipDuplicates:true})).count;
}
export function coverageReviewCandidates(rawVersions:unknown[],vehicleIds:string[],requirementVersionId:string,dueAt:Date){
 const schema=reminderVersion.extend({startAt:z.date(),requirementVersionIds:z.array(z.string())});
 const rows=rawVersions.flatMap(raw=>{const parsed=schema.safeParse(raw);return parsed.success?[parsed.data]:[];}),current=new Map<string,typeof rows[number]>();
 for(const row of rows.filter(v=>v.status==='APPROVED'&&v.effectiveAt<=dueAt).sort((a,b)=>a.effectiveAt.getTime()-b.effectiveAt.getTime()||a.version-b.version))current.set(row.policyId,row);
 return [...current.values()].filter(v=>v.changeKind!=='CANCELLATION'&&v.startAt<=dueAt&&dueAt<v.endAt&&!v.requirementVersionIds.includes(requirementVersionId)).flatMap(v=>v.vehicleIds.filter(id=>vehicleIds.includes(id)).map(vehicleId=>({vehicleId,policyVersionId:v.id,requirementVersionId,dueAt})));
}
export function leaseRenewalCandidates(rawVersions:unknown[],vehicleId:string,leaseEndAt:Date,at:Date):ReminderCandidate[]{
 const schema=reminderVersion.extend({startAt:z.date()}),current=new Map<string,z.infer<typeof schema>>();
 const rows=rawVersions.flatMap(raw=>{const parsed=schema.safeParse(raw);return parsed.success?[parsed.data]:[];});
 for(const id of new Set(rows.map(v=>v.policyId))){const row=effectivePolicyVersion(rows.filter(v=>v.policyId===id),at);if(row)current.set(id,row);}
 return [...current.values()].filter(v=>v.vehicleIds.includes(vehicleId)&&v.changeKind!=='CANCELLATION'&&(v.status!=='REGISTERED'||validRegistration(v,vehicleId))&&v.startAt<=at&&at<v.endAt&&v.endAt<leaseEndAt).map(v=>({vehicleId,policyId:v.policyId,policyVersionId:v.id,thresholdDays:30,dueAt:new Date(v.endAt.getTime()-30*86400000)}));
}
// Called by the delivery/order transaction with its already frozen lease end, not by coverageAt reads.
export async function createLeaseRenewalReminders(tx:InsuranceTx,vehicleId:string,leaseEndAt:Date,at:Date):Promise<number>{
 const policies=await tx.insurancePolicy.findMany({where:{versions:{some:{vehicleIds:{has:vehicleId}}}},include:{versions:true}}),candidates=leaseRenewalCandidates(policies.flatMap(p=>p.versions),vehicleId,leaseEndAt,at);
 return candidates.length?(await tx.insuranceRenewalReminder.createMany({data:candidates,skipDuplicates:true})).count:0;
}
