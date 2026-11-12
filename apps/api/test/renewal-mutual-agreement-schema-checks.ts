import assert from 'node:assert/strict';
import {verifyRenewalCancellationSchema} from './renewal-cancellation-schema-checks';

export async function verifyRenewalMutualAgreementSchema(db:any){
 const columns=await db.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='OrderRenewalCancellation'`;
 assert.ok(columns.some((v:any)=>v.column_name==='mutuallyAgreedAt'),'missing separately verified mutual-agreement facts');
 const {cancellation,staff}=await verifyRenewalCancellationSchema(db),where={id:cancellation.id};
 const complete={mutuallyAgreedAt:new Date('2026-10-01T03:00:00Z'),mutualAgreementVerifiedBy:staff.id,mutualAgreementVerifiedAt:new Date('2026-10-02T03:00:00Z'),mutualAgreementEvidenceFileIds:['synthetic-mutual-proof'],mutualAgreementNote:'仅验证互认证据结构约束，不代表真实取消',mutualAgreementHash:'e'.repeat(64)};
 const names=Object.keys(complete),check=(e:any)=>e.code==='P2004'||e.meta?.code==='23514'||/23514/.test(String(e.message));
 for(let mask=1;mask<63;mask++){
  const data:any={};names.forEach((name,index)=>{data[name]=mask&(1<<index)?(complete as any)[name]:name==='mutualAgreementEvidenceFileIds'?[]:null;});
  await assert.rejects(db.orderRenewalCancellation.update({where,data}),check);
 }
 for(const patch of [{mutualAgreementNote:' '},{mutualAgreementEvidenceFileIds:[' ']},{mutualAgreementEvidenceFileIds:['valid','   ']},{mutualAgreementHash:'bad'},{mutuallyAgreedAt:new Date('2026-10-03T03:00:00Z')}])await assert.rejects(db.orderRenewalCancellation.update({where,data:{...complete,...patch}}),check);
 await assert.rejects(db.orderRenewalCancellation.update({where,data:{...complete,mutualAgreementVerifiedBy:'missing-person'}}),(e:any)=>e.code==='P2003');
 await db.orderRenewalCancellation.update({where,data:complete});
 await assert.rejects(db.$executeRaw`UPDATE "OrderRenewalCancellation" SET "mutualAgreementEvidenceFileIds"=ARRAY[NULL]::text[] WHERE id=${cancellation.id}`,(e:any)=>e.meta?.code==='23514');
 const saved=await db.orderRenewalCancellation.findUniqueOrThrow({where});assert.equal(saved.sourceHash,cancellation.sourceHash);assert.equal(saved.mutualAgreementHash,complete.mutualAgreementHash);
}
