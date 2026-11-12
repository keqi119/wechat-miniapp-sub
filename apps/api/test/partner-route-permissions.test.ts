import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Access} from '../src/auth/access';
import {PartnerSettlementController} from '../src/partners/settlement-controller';
const forbidden=(e:any)=>e.getResponse?.().error?.code==='FORBIDDEN';
async function guard(role:string,capabilities:string[],path:string,method='GET'){
 const admin={id:'staff',role,active:true,authVersion:1,partnerCapabilities:capabilities};
 const request:any={path:'/api'+path,method,cookies:{admin_session:'synthetic'},headers:{origin:'http://localhost:3100','x-csrf-token':'csrf'}};
 const db:any={adminSession:{findUnique:async()=>({admin,authVersion:1,expiresAt:new Date(Date.now()+10000),csrfToken:'csrf'})}};
 return new Access(db).canActivate({switchToHttp:()=>({getRequest:()=>request,getResponse:()=>({setHeader(){}})})} as any);
}
test('ADMIN and operations directly manage simple partners without legacy cooperation grants',async()=>{
 const routes=[['/admin/partners','GET'],['/admin/partners','POST'],['/admin/partners/p','GET'],['/admin/partners/p/profile','PATCH'],['/admin/partners/p/agreements','GET'],['/admin/partners/p/agreements','POST'],['/admin/partners/p/agreements/a/stop','POST'],['/admin/partners/p/agreements/a/files/f','GET'],['/admin/partners/p/company-admin','GET'],['/admin/partners/p/company-admin/invitation','POST'],['/admin/partners/p/company-admin/disable','POST'],['/admin/partners/p/revenue','GET']];
 for(const role of ['ADMIN','OPERATIONS'])for(const[path,method]of routes)assert.equal(await guard(role,[],path,method),true,`${role} ${method} ${path}`);
 for(const role of ['FINANCE','SUPPORT','FIELD'])for(const[path,method]of routes)await assert.rejects(guard(role,['partner.cooperation.write','partner.cooperation.read'],path,method),forbidden);
 for(const path of ['/admin/partners/p/agreements/a/review','/admin/partners/p/company-admin/anything','/admin/partners/p/identities','/admin/partners/p/review'])await assert.rejects(guard('OPERATIONS',[],path,'POST'),forbidden);
});
test('an operations employee with the account read capability can reach the account service',async()=>{
 assert.equal(await guard('OPERATIONS',['partner.accounts.read'],'/admin/partner-settlements/accounts/owner'),true);
 await assert.rejects(guard('OPERATIONS',['partner.settlements.read'],'/admin/partner-settlements/accounts/owner'),forbidden);
});
test('cooperation write does not allow review or managing the external viewing phone',async()=>{
 await assert.rejects(guard('OPERATIONS',['partner.cooperation.write'],'/admin/partners/p/review','POST'),forbidden);
 await assert.rejects(guard('OPERATIONS',['partner.cooperation.write'],'/admin/partners/p/portal-access','POST'),forbidden);
 for(const action of ['','/submit','/review','/disable'])await assert.rejects(guard('OPERATIONS',['partner.portal.write','partner.portal.review','partner.portal.disable'],'/admin/partners/p/portal-access'+action,'POST'),forbidden);
 assert.equal(await guard('OPERATIONS',['partner.portal.read'],'/admin/partners/p/portal-access'),true);
});
test('settlement reads cannot register payments or use legacy customer identity writes',async()=>{
 await assert.rejects(guard('ADMIN',['partner.settlements.read'],'/admin/partner-settlements/s/payments','POST'),forbidden);
 await assert.rejects(guard('ADMIN',['partner.cooperation.write'],'/admin/partners/p/identities','POST'),forbidden);
});
test('cooperation archive routes admit exact grants without granting customer archive access',async()=>{
 assert.equal(await guard('FINANCE',['partner.cooperation.write'],'/admin/offline-archives','POST'),true);
 assert.equal(await guard('SUPPORT',['partner.cooperation.review'],'/admin/offline-archives/archive/review','POST'),true);
 assert.equal(await guard('SUPPORT',['partner.cooperation.read'],'/admin/offline-archives/archive','GET'),true);
 await assert.rejects(guard('SUPPORT',['partner.cooperation.write'],'/admin/offline-archives/archive/review','POST'),forbidden);
 await assert.rejects(guard('FINANCE',[],'/admin/offline-archives','POST'),forbidden);
 assert.equal(await guard('OPERATIONS',[],'/admin/offline-archives/order-archive','GET'),true);
});
test('a rules reader can choose a partner without acquiring settlement or bank account access',async()=>{
 const actor={id:'staff',role:'OPERATIONS',authVersion:1};
 const staff={...actor,active:true,partnerCapabilities:['partner.rules.read']};
 const db:any={adminUser:{findUnique:async()=>staff},vehicleOwner:{findMany:async()=>[{id:'partner',name:'合成合作商',subjectType:'ENTERPRISE',status:'UNVERIFIED'}]}};
 db.serial=(fn:any)=>fn(db);
 assert.equal(await guard(actor.role,staff.partnerCapabilities,'/admin/partner-settlements/partners'),true);
 const items=await new PartnerSettlementController(db).partners({admin:actor});
 assert.equal(items[0].id,'partner');
 staff.partnerCapabilities=[];
 await assert.rejects(new PartnerSettlementController(db).partners({admin:actor}),forbidden);
});
