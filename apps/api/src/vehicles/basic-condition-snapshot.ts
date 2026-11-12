import {z} from 'zod';
import {canonicalHash} from '../customers/types';
const facts=z.object({schemaVersion:z.literal(1),vehicleId:z.string().min(1),sourceRevision:z.number().int().positive(),assessedBy:z.string().min(1),assessedAt:z.string().datetime({offset:true}),fireDamage:z.boolean(),floodDamage:z.boolean(),structuralDamage:z.boolean()}).strict();
const snapshot=facts.extend({sourceHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export function freezeBasicCondition(row:any){const value=facts.parse({schemaVersion:1,vehicleId:row.vehicleId,sourceRevision:row.revision,assessedBy:row.assessedBy,assessedAt:new Date(row.assessedAt).toISOString(),fireDamage:row.fireDamage,floodDamage:row.floodDamage,structuralDamage:row.structuralDamage});return{...value,sourceHash:canonicalHash(value)};}
export function publicBasicCondition(raw:unknown,vehicleId:string){const parsed=snapshot.safeParse(raw);if(!parsed.success)return null;const {sourceHash,...value}=parsed.data;if(value.vehicleId!==vehicleId||sourceHash!==canonicalHash(value))return null;return{fireDamage:value.fireDamage,floodDamage:value.floodDamage,structuralDamage:value.structuralDamage,assessedAt:value.assessedAt};}
