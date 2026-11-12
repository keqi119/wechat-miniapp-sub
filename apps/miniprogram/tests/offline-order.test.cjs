const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const root=path.resolve(__dirname,'../src');const {workspaceView,archiveView,archiveFilePath}=require(path.join(root,'utils/offline-order'));
const {createApi}=require(path.join(root,'services/api'));
const {contractOverview}=require(path.join(root,'utils/customer-contract'));
const {handoverSigning}=require(path.join(root,'utils/customer-handover'));
test('offline paper contract and handover capabilities never start electronic signing',async()=>{
 const calls=[],platform={getStorageSync:()=>({token:'token',expiresAt:'2099-01-01',customer:{id:'c'}})};
 const api=createApi({apiBase:'http://127.0.0.1:3101'},o=>{calls.push(o);o.success({statusCode:200,data:{id:'ct',contractDetail:{executionMode:'OFFLINE'}}});},platform);
 await assert.rejects(api.performAction('contracts','ct','sign'),e=>e.code==='OFFLINE_CONTRACT');assert.equal(calls.some(c=>c.method==='POST'),false);
 const detail={version:2,executionMode:'OFFLINE',contractId:'ct',orderId:'o',phase:'OFFLINE_ARCHIVED',phaseText:'已归档',guidance:{title:'纸质合同',description:'已审核'},vehicle:{title:'车辆'},lessor:{name:'个人出租方'},summaryRows:[],parties:[],progress:[],documents:[{id:'f',title:'合同.pdf',url:'/api/customer/offline-archives/a/versions/v/files/f'}],archive:{archiveId:'a'}};
 const contract=contractOverview({id:'ct',contractDetail:detail},'ct');assert.equal(contract.offline,true);assert.equal(contract.canSign,false);assert.equal(contract.documents[0].versionId,'v');assert.equal(contractOverview({id:'ct',contractDetail:{...detail,documents:[{id:'f',title:'wrong',url:'/api/customer/files/f'}]}},'ct').documents.length,0);
 const handover=handoverSigning({id:'h',revision:2,manifestHash:'hash',executionMode:'OFFLINE',signingReadiness:{version:2,executionMode:'OFFLINE',handoverId:'h',revision:2,manifestHash:'hash',stage:'PAPER_ARCHIVED',message:'纸质单已归档',canSign:true,archive:{archiveId:'a',versions:[{status:'ARCHIVED'}]}}});assert.equal(handover.canSign,false);assert.equal(handover.canReadArchive,true);
});
test('offline order never grants signing or payment without server archive readiness',()=>{
 const raw={orderId:'o',mode:'OFFLINE',stage:'AWAITING_CONTRACT_REVIEW',nextAction:{code:'SIGN',enabled:true},contracts:[],billing:[{id:'b',status:'PENDING',amount:100,paidAmount:0,dueDate:'2026-11-01'}],handovers:[],parties:[],capabilities:{canPay:false},riskSnapshot:{private:true},revenueRuleSnapshot:{private:true}};
 const view=workspaceView(raw,'o');assert.equal(view.bills[0].canPay,false);assert.equal(view.canSign,false);assert.equal(view.riskSnapshot,undefined);assert.equal(view.revenueRuleSnapshot,undefined);
 assert.equal(workspaceView({...raw,capabilities:{canPay:true}},'o').bills[0].canPay,true);
 assert.throws(()=>workspaceView({...raw,orderId:'other'},'o'));
});
test('archives preserve their approved version and build only dedicated file routes',()=>{
 const a=archiveView({id:'a',kind:'RENTAL',status:'ARCHIVED',currentApprovedVersionId:'v',versions:[{id:'v',version:1,status:'ARCHIVED',files:[{id:'f',position:1,name:'合同.pdf',mimeType:'application/pdf',size:10}]}]},'a');assert.equal(a.selectedVersion.id,'v');assert.equal(archiveFilePath('a','v','f'),'/offline-archives/a/versions/v/files/f');assert.throws(()=>archiveFilePath('../wrong','v','f'));
});
test('private archive images use the dedicated version route and native preview without generic file borrowing',async()=>{
 let request,preview;const platform={getStorageSync:()=>({token:'token',expiresAt:'2099-01-01',customer:{id:'c'}}),downloadFile:o=>{request=o;o.success({statusCode:200,tempFilePath:'/temporary/image'});},previewImage:o=>{preview=o;o.success({});},openDocument:()=>{throw Error('Raster must not open as PDF');}};
 const api=createApi({apiBase:'http://127.0.0.1:3101'},()=>{throw Error('No JSON requests');},platform);await api.openOfflineArchiveFile('a','v','f','image/png');assert.equal(request.url,'http://127.0.0.1:3101/api/customer/offline-archives/a/versions/v/files/f');assert.equal(request.header.Authorization,'Bearer token');assert.equal(preview.current,'/temporary/image');
});
test('customer credit adapter accepts the safe result without an internal band',async()=>{
 const response={applicationId:'a',creditRevision:1,ruleVersion:'ZHIMA_MANUAL_V1',status:'VERIFIED',document:{id:'d',type:'credit-verification',version:1,title:'说明',content:'说明'},consent:{id:'c',documentId:'d',version:1,status:'ACCEPTED'},verification:{verifiedAt:'2026-10-27T00:00:00Z',current:true},verificationCurrent:true,canConfirmFinalPlan:true,consentRequirementsMet:true};
 const platform={getStorageSync:()=>({token:'token',expiresAt:'2099-01-01',customer:{id:'c'}})};
 const api=createApi({apiBase:'http://127.0.0.1:3101'},o=>o.success({statusCode:200,data:response}),platform);const value=await api.getCreditReview('a');assert.equal(value.canConfirmFinalPlan,true);assert.equal(value.verification.band,undefined);
});
