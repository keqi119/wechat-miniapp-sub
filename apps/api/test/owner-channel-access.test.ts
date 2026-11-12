import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Access} from '../src/auth/access';

test('an enterprise already handed to legal H5 cannot write through an old Bearer route before global cutover',async()=>{
 const oldWorkspace=process.env.OWNER_WORKSPACE_ENABLED,oldOnly=process.env.OWNER_LEGAL_H5_ONLY;
 process.env.OWNER_WORKSPACE_ENABLED='true';process.env.OWNER_LEGAL_H5_ONLY='false';
 let channel='OWNER_LEGAL_H5',lookups=0;
 const db:any={customerSession:{findUnique:async()=>({customer:{id:'synthetic'},expiresAt:new Date(Date.now()+60000)})},ownerESignAccount:{findUnique:async({where}:any)=>{assert.equal(where.ownerId,'enterprise');lookups++;return{consentSnapshot:{channel}};}}};
 const access=new Access(db);
 const context=(method:string,path:string)=>({switchToHttp:()=>({getRequest:()=>({method,path:'/api'+path,headers:{authorization:'Bearer synthetic'}}),getResponse:()=>({setHeader(){}})})} as any);
 try{
  for(const suffix of ['/verification','/refresh','/seal','/authorities/authority/revoke','/contracts/task/manual','/contracts/task/sign'])await assert.rejects(access.canActivate(context('POST','/customer/owners/enterprise'+suffix)),(e:any)=>e.getResponse?.().error?.code==='OWNER_H5_REQUIRED');
  await assert.rejects(access.canActivate(context('POST','/customer/owners/%65nterprise/refresh')),(e:any)=>e.getResponse?.().error?.code==='OWNER_H5_REQUIRED');
  assert.equal(await access.canActivate(context('GET','/customer/owners/enterprise')),true);
  assert.equal(lookups,7);
  channel='OLD_NATIVE';
  assert.equal(await access.canActivate(context('POST','/customer/owners/enterprise/refresh')),true);
 }finally{
  if(oldWorkspace===undefined)delete process.env.OWNER_WORKSPACE_ENABLED;else process.env.OWNER_WORKSPACE_ENABLED=oldWorkspace;
  if(oldOnly===undefined)delete process.env.OWNER_LEGAL_H5_ONLY;else process.env.OWNER_LEGAL_H5_ONLY=oldOnly;
 }
});
