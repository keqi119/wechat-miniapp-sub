import {z} from 'zod';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {customerProfileHash} from '../customers/qualifications';
import {validProfileFile,profileRevision} from '../customers/profile';
import {requireCurrentVirtualScope} from './scope';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const virtualProfileSchema=z.object({version:z.literal(4),kind:z.literal('VIRTUAL_ACCEPTANCE'),identityPolicy:z.literal('SIGNING_REQUIRED'),scopeId:z.string().min(1),configurationHash:digest,customerId:z.string().min(1),name:z.string().trim().min(1).max(40),mobile:z.string().min(1),profileRevision:z.number().int().nonnegative(),profileHash:digest,identityDocuments:z.array(z.object({slot:z.enum(['identityFront','identityBack']),id:z.string().min(1),sha256:digest}).strict()).max(2),driverQualification:z.literal('NOT_APPLICABLE'),creditVerification:z.literal('NOT_APPLICABLE'),capturedAt:z.iso.datetime()}).strict();
export type VirtualProfileSnapshot=z.infer<typeof virtualProfileSchema>;
export async function captureVirtualProfile(tx:any,customerId:string,vehicleId:string):Promise<VirtualProfileSnapshot>{
 const scope=await requireCurrentVirtualScope(tx,{vehicleId,customerId,action:'PROFILE'});ensure(scope,409,'VIRTUAL_SCOPE_REQUIRED');
 await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${customerId} FOR UPDATE`;
 const customer=await tx.customer.findUniqueOrThrow({where:{id:customerId}}),identityDocuments=[];
 for(const slot of ['identityFront','identityBack'] as const){const id=customer.profile?.[slot+'FileId'];if(!id)continue;const file=await tx.storedFile.findUnique({where:{id}});ensure(validProfileFile(file,customerId),403,'FILE_OWNERSHIP','身份证来源须是当前客户真实持有的资料');identityDocuments.push({slot,id,sha256:file.sha256});}
 return virtualProfileSchema.parse({version:4,kind:'VIRTUAL_ACCEPTANCE',identityPolicy:'SIGNING_REQUIRED',scopeId:scope.id,configurationHash:scope.configurationHash,customerId,name:customer.name,mobile:customer.mobile,profileRevision:profileRevision(customer),profileHash:customerProfileHash(customer),identityDocuments,driverQualification:'NOT_APPLICABLE',creditVerification:'NOT_APPLICABLE',capturedAt:new Date().toISOString()});
}
export function virtualApplicationProfile(snapshot:VirtualProfileSnapshot){return{name:snapshot.name,mobile:snapshot.mobile,fileIds:snapshot.identityDocuments.map(d=>d.id),handoverLocation:null,customerProfileSnapshot:snapshot,reviewLabel:'测试资料确认（驾驶资格、信用核验不适用）'};}
export async function confirmVirtualProfile(tx:any,customerId:string,vehicleId:string,raw:unknown){const before=virtualProfileSchema.parse(raw),current=await captureVirtualProfile(tx,customerId,vehicleId);const comparable=({capturedAt,...facts}:VirtualProfileSnapshot)=>facts;ensure(canonicalHash(comparable(before))===canonicalHash(comparable(current)),409,'CUSTOMER_PROFILE_CHANGED','测试客户资料或范围已变化，请先退回补件并重新确认');return before;}
