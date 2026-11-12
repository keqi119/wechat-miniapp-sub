import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AdminController} from '../src/operations/admin';
import {CreditReviewController} from '../src/applications/credit-review';
test('finance and support generic records cannot expose qualification or internal risk and sharing snapshots',async()=>{
 const value={id:'r',name:'客户',mobile:'13800000000',profile:{identityFileIds:['secret-file']},legalIdentityFileId:'secret-id',finalPlanSnapshot:{monthlyFeeAmount:100,riskSnapshot:{reviewerId:'secret-staff'},revenueRuleSnapshot:{rateBps:999},creditBand:'secret-band'}};
 for(const role of ['FINANCE','SUPPORT'])for(const resource of ['customers','orders']){
 const service=new AdminController({customer:{findUnique:async()=>value},order:{findUnique:async()=>value}} as any);
 const result=await service.detail(resource,'r',{admin:{role}}),serialized=JSON.stringify(result);
 assert.ok(!serialized.includes('secret-'));assert.ok(!serialized.includes('rateBps'));assert.equal(result.id,'r');
 }
});
test('customer credit status never returns the internal band or reviewer identity',async()=>{
 const app={id:'a',customerId:'c',status:'IN_REVIEW',creditRevision:1};
 const tx:any={application:{findFirst:async()=>app},legalDocument:{findFirst:async({where}:any)=>({id:where.type,version:1,confirmedAt:new Date(),content:'说明'})},customerConsent:{count:async()=>1},creditConsent:{findFirst:async()=>({id:'consent',documentId:'credit-verification',version:1,status:'ACCEPTED'})},creditVerification:{findFirst:async()=>({id:'v',consentId:'consent',revision:1,ruleVersion:'ZHIMA_MANUAL_V1',band:'GE750',verifiedBy:'internal-reviewer'})}};
 const result=await new CreditReviewController({serial:async(fn:any)=>fn(tx)} as any).customer('a',{customer:{id:'c'}});
 const serialized=JSON.stringify(result);assert.ok(!serialized.includes('GE750'));assert.ok(!serialized.includes('internal-reviewer'));assert.equal(result.status,'VERIFIED');
});
