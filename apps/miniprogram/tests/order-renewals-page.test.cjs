const {test}=require('node:test');
const assert=require('node:assert/strict');
const {setup,page,renewal,summary}=require('./fixtures/order-renewals.cjs');
const vm=require('node:vm');
const {compile}=require('../scripts/compile-templates.cjs');
test('actual record page renders renewal and sends separate reading/sharing consent, then only reads receipt outcome',async()=>{
 const e=setup(),p=page(e);await p.reload();assert.equal(p.data.change.isRenewal,true);assert.equal(p.data.renewalSharingAccepted,false);p.setData({changeRead:true});await p.confirmChange();assert.equal(e.calls.some(c=>c.method==='POST'),false);
 p.setData({renewalSharingAccepted:true});await p.confirmChange();assert.equal(e.calls.filter(c=>c.method==='POST').length,1);assert.equal(p.data.change.status,'AWAITING_ARCHIVE');assert.match(p.data.message,/尚未生效/);
});
test('actual records page switches to dedicated renewal pagination and keeps detail route kind',async()=>{
 const e=setup();e.rows(Array.from({length:14},(_,i)=>summary(renewal({id:'r'+i}))));const p=page(e,'records',{type:'orderchanges',kind:'SUBSCRIPTION_EXTENSION'});await p.reload();assert.equal(p.data.items.length,12);assert.equal(p.data.renewalTotal,14);await p.nextRenewalPage();assert.equal(p.data.items[0].id,'r12');p.openRecord({currentTarget:{dataset:{id:'r12'}}});assert.match(e.navigations.at(-1),/kind=SUBSCRIPTION_EXTENSION/);
});
test('late old GET cannot resurrect private renewal after a newer forbidden read',async()=>{
 const e=setup(),p=page(e);await p.reload();e.hold(true);const old=p.reload(),latest=p.reload();e.deferred.at(-1).success({statusCode:403,data:{error:{code:'FORBIDDEN',message:'已失权'}}});await latest;assert.equal(p.data.change,null);e.deferred.at(-2).success({statusCode:200,data:renewal()});await old;assert.equal(p.data.change,null);assert.equal(p.data.changeRead,false);
});
test('session changes during modal/late read clear confirmation and cannot write for another customer',async()=>{
 const e=setup(),p=page(e);await p.reload();p.setData({changeRead:true,renewalSharingAccepted:true});e.wx.showModal=v=>{e.switchSession();v.success({confirm:true});};await p.confirmChange();assert.equal(e.calls.some(c=>c.method==='POST'),false);assert.equal(p.data.changeRead,false);assert.equal(p.data.renewalSharingAccepted,false);
});
test('renewal legal and contract links cannot relabel the previous customer private evidence into a new session',async()=>{
 const e=setup(),p=page(e);await p.reload();assert.equal(p.data.change.isRenewal,true);e.switchSession();p.openChangeTerms();p.openRenewalNotice();p.openChangeContract();assert.equal(e.navigations.length,0);assert.equal(p.data.change,null);assert.equal(p.data.record,null);
});
test('a forbidden renewal list read clears old list data and a late category response cannot restore it',async()=>{
 const e=setup(),p=page(e,'records',{type:'orderchanges',kind:'SUBSCRIPTION_EXTENSION'});await p.reload();assert.equal(p.data.items.length,1);e.fail(403,true);await p.reload();assert.deepEqual(p.data.items,[]);
});
test('a successful command followed by failed GET only offers readback and never repeats POST',async()=>{
 const e=setup(),p=page(e);await p.reload();p.setData({changeRead:true,renewalSharingAccepted:true});e.failReadAfterPost();await p.confirmChange();assert.equal(e.calls.filter(c=>c.method==='POST').length,1);assert.equal(p.data.change,null);assert.match(p.data.message,/已提交/);await p.confirmChange();assert.equal(e.calls.filter(c=>c.method==='POST').length,1);
});
test('compiled record error branch visibly preserves the confirmed command receipt message',()=>{
 const compiled=compile(),generate=vm.runInNewContext('(function(global){'+compiled.wxml+'})({})',{window:{},console});
 const tree=generate('pages/record/index.wxml')({type:'orderchanges',changeKind:'SUBSCRIPTION_EXTENSION',loading:false,error:'读取失败',record:null,message:'操作已提交，请只刷新原续期记录'});
 assert.match(JSON.stringify(tree),/操作已提交，请只刷新原续期记录/);
});
test('unload and list-category changes invalidate late renewal GETs',async()=>{
 const e=setup(),p=page(e);await p.reload();e.hold(true);const read=p.reload();p.onUnload();e.deferred.at(-1).success({statusCode:200,data:renewal({reason:'迟到私有资料'})});await read;assert.notEqual(p.data.change?.reason,'迟到私有资料');
 const e2=setup(),list=page(e2,'records',{type:'orderchanges',kind:'SUBSCRIPTION_EXTENSION'});e2.hold(true);const old=list.reload();const latest=list.selectChangeKind({currentTarget:{dataset:{kind:''}}});e2.deferred.at(-1).success({statusCode:200,data:{items:[],total:0,page:1,pageSize:50}});await latest;e2.deferred.at(-2).success({statusCode:200,data:{items:[summary(renewal())],total:1,page:1,pageSize:12}});await old;assert.deepEqual(list.data.items,[]);assert.equal(list.data.changeKind,'');
});
