import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSevenModuleMigration} from '../src/operations/seven-module-migration';
import {policySummaries} from '../src/orders/seven-module-views';

function registered(){
 const startAt=new Date('2026-01-01'),endAt=new Date('2027-01-01'),registeredAt=new Date('2026-11-01');
 const policy={insurer:'登记机构',policyNumber:'REGISTER-1234',policyType:'COMMERCIAL',insuredParty:'合成被保人',startAt:startAt.toISOString(),endAt:endAt.toISOString()};
 return{id:'registered-local',policyId:'policy-local',version:2,status:'REGISTERED',changeKind:'ENDORSEMENT',effectiveAt:registeredAt,registeredAt,registeredBy:'operator-local',...{policyType:policy.policyType,insurerSnapshot:policy.insurer,policyNumberSnapshot:policy.policyNumber,insuredParty:policy.insuredParty},startAt,endAt,vehicleIds:['vehicle-local'],fileIds:['file-local'],terms:'',coverageItems:[],requirementVersionIds:[],registrationSnapshot:{schemaVersion:1,confirmed:true,registeredAt:registeredAt.toISOString(),registeredBy:'operator-local',policy,vehicles:[{id:'vehicle-local',vin:null,plateNumber:null,title:'合成车辆'}],files:[{id:'file-local',name:'合成保单.pdf',mimeType:'application/pdf',size:123,sha256:'a'.repeat(64),vehicleIds:['vehicle-local']}]}};
}
test('database inventory projection retains the full evidence needed to recognize registered insurance',async()=>{
 const policy=registered(),tx:any={};
 for(const key of ['vehicle','subscriptionPlan','vehicleOwner','partnerVerification','partnerIdentityBinding','documentArchive','archiveFeedback','insurancePolicyVersion','productVersion'])tx[key]={findMany:async({select}:any={})=>{
  const rows=key==='vehicle'?[{id:'vehicle-local',vin:'LVV14260712175847',modelDefinitionId:null,ownerBinding:null}]:key==='insurancePolicyVersion'?[policy]:[];
  return rows.map(row=>select?Object.fromEntries(Object.keys(select).map(k=>[k,(row as any)[k]])):row);
 }};
 for(const key of ['product','order','contract'])tx[key]={count:async()=>0};
 const result=await inspectSevenModuleMigration(tx,new Date('2026-11-04'));
 assert.equal(result.issues.some(issue=>issue.code==='INSURANCE_POLICY_UNVERIFIED'||issue.code==='INSURANCE_POLICY_MISSING'),false);
});
test('historical policy summaries use the selected version identity instead of corrected root identity',()=>{
 const old={id:'old-version',version:1,status:'APPROVED',changeKind:'ORIGINAL',effectiveAt:new Date('2026-01-01'),startAt:new Date('2026-01-01'),endAt:new Date('2027-01-01'),vehicleIds:['vehicle-local'],coverageItems:[],insurerSnapshot:'原保险机构',policyNumberSnapshot:'OLD-1122'};
 const rows=policySummaries([{id:'policy-local',insurer:'修改后的机构',policyNumber:'NEW-9988',versions:[old,registered()]}],['vehicle-local'],new Date('2026-06-01'));
 assert.equal(rows[0].insurer,'原保险机构');assert.equal(rows[0].policyNumberLast4,'1122');
});
