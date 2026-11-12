import test from 'node:test';
import assert from 'node:assert/strict';
import {OwnerClient,OwnerApiError} from './client.ts';
import {invitationPreviewPayload,invitationConfirmPayload,validateInvitationPreview,revenueQuery,datePreset,validateRevenue,companyRoute} from './simple-model.ts';
const documents=[{id:'terms',type:'terms',version:2,title:'服务协议',content:'正文'},{id:'privacy',type:'privacy',version:3,title:'隐私政策',content:'正文'}];
test('invitation preview and confirmation bind a short-lived credential and current explicit consents',()=>{
 assert.deepEqual(invitationPreviewPayload('13800000000','a'.repeat(24)),{mobile:'13800000000',invitationCode:'a'.repeat(24)});
 assert.equal(invitationPreviewPayload('13800000000','a'.repeat(43)).invitationCode.length,43);
 const preview={previewToken:'b'.repeat(64),companyName:'合成公司',ownerId:'p1',maskedMobile:'138****0000',expiresAt:'2099-01-01T00:00:00Z'};
 assert.equal(validateInvitationPreview(preview).ownerId,'p1');
 assert.deepEqual(invitationConfirmPayload(preview,true,documents),{previewToken:'b'.repeat(64),consents:[{documentId:'terms',version:2},{documentId:'privacy',version:3}]});
 assert.throws(()=>invitationConfirmPayload(preview,false,documents));assert.throws(()=>invitationConfirmPayload({...preview,expiresAt:'2000-01-01'},true,documents));assert.throws(()=>invitationConfirmPayload(preview,true,documents.slice(0,1)));
 for(const code of ['','123456','a'.repeat(42),'https://example.com'])assert.throws(()=>invitationPreviewPayload('13800000000',code));
 assert.throws(()=>validateInvitationPreview({...preview,ownerId:'../other'}));
});
test('new auth endpoints preserve an existing session on invalid invitations while business writes remain denied',async()=>{
 const requests:any[]=[];let denied=0;const api=new OwnerClient(async(url,init)=>{requests.push({url,init});return String(url).endsWith('/preview')?new Response('{"error":{"code":"INVITATION_UNAVAILABLE","message":"邀请码已失效"}}',{status:401}):new Response('{}');});
 api.setCsrf('existing-session');api.onAccessDenied(()=>denied++);
 await assert.rejects(api.request('/auth/invitation/preview',{mobile:'13800000000',invitationCode:'a'.repeat(24)}),(e:any)=>e.code==='INVITATION_UNAVAILABLE');
 await api.request('/auth/logout',{});assert.equal(new Headers(requests.at(-1).init.headers).get('X-CSRF-Token'),'existing-session');assert.equal(denied,0);
 await api.request('/auth/invitation/confirm',{previewToken:'b'.repeat(64),consents:[]});
 await assert.rejects(api.request('/auth/invitation/confirm/other',{}),(e:any)=>e instanceof OwnerApiError&&e.code==='PARTNER_READ_ONLY');
 await assert.rejects(api.request('/owners/p1/agreements',{}));
});
test('new scoped query paths accept only defined filters and reject injected or duplicated query fields',async()=>{
 const api=new OwnerClient(async()=>new Response('{}'));
 for(const path of ['/owners/p1/agreements','/owners/p1/cooperation-vehicles?modelId=m1&status=IN_USE&page=2&pageSize=20','/owners/p1/revenue?from=2026-10-01&to=2026-10-31&agreementId=a1&modelId=m1&vehicleId=v1&groupBy=month&page=1&pageSize=20'])await api.request(path);
 for(const path of ['/owners/p1/revenue?from=bad','/owners/p1/revenue?ownerId=p2','/owners/p1/revenue?groupBy=customer','/owners/p1/revenue?from=2026-10-01&from=2026-10-02','/owners/p1/cooperation-vehicles?status=APPROVED'])await assert.rejects(api.request(path));
 const file=new OwnerClient(async()=>new Response('%PDF synthetic',{headers:{'Content-Type':'application/pdf'}}));assert.equal(await(await file.request<Blob>('/owners/p1/agreements/a1/files/f1')).text(),'%PDF synthetic');
});
test('date presets use Beijing natural days and revenue filters preserve explicit zero and reject invalid ranges',()=>{
 assert.deepEqual(datePreset('month',new Date('2026-10-31T17:00:00Z')),{from:'2026-11-01',to:'2026-11-30'});
 assert.deepEqual(datePreset('previous',new Date('2026-01-15T00:00:00Z')),{from:'2025-12-01',to:'2025-12-31'});
 assert.equal(revenueQuery({from:'2026-10-01',to:'2026-10-31',agreementId:'a1',modelId:'m1',vehicleId:'v1',groupBy:'vehicle',page:2}), 'from=2026-10-01&to=2026-10-31&agreementId=a1&modelId=m1&vehicleId=v1&groupBy=vehicle&page=2&pageSize=20');
 assert.throws(()=>revenueQuery({from:'2026-02-30',to:'2026-03-02',groupBy:'month',page:1}));assert.throws(()=>revenueQuery({from:'2026-11-01',to:'2026-10-01',groupBy:'month',page:1}));
 const zero={totals:{receivedAmount:0,refundedAmount:0,netAmount:0,partnerAmount:0,platformAmount:0},groups:[],items:[],total:0,page:1,pageSize:20,incompleteCount:0};
 assert.equal(validateRevenue(zero).totals.partnerAmount,0);assert.throws(()=>validateRevenue({...zero,totals:undefined}));assert.throws(()=>validateRevenue({...zero,incompleteCount:undefined}));assert.throws(()=>validateRevenue({...zero,totals:{...zero.totals,partnerAmount:'0'}}));
 assert.deepEqual(companyRoute('#/owners/p1/orders/old','p1'),{tab:'orders',orderId:'old'});assert.deepEqual(companyRoute('#/owners/p2/revenue','p1'),{tab:'overview'});assert.deepEqual(companyRoute('#/owners/p1/revenue','p1'),{tab:'revenue'});
});
