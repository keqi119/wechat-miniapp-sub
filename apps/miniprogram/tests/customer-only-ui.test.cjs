const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(process.env.MINIAPP_SOURCE_ROOT||path.join(__dirname,'../src'));
function page(file,services={}){let value;vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),{Page:p=>value=p,require:id=>id.includes('handover-location')?require('../src/utils/handover-location'):id.includes('services')?services:id.includes('config')?{storageKey:'session'}:{load(){},go(){},confirm(){},toastError(){}},wx:{}});value.data=structuredClone(value.data);value.setData=function(next){Object.assign(this.data,next)};return value;}
function nodes(node){return !node||typeof node!=='object'?[]:[node,...(node.children||[]).flatMap(nodes)];}
test('customer application cannot route to or package the enterprise owner workspace',()=>{
 const app=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));
 assert.equal(app.pages.includes('pages/owner/index'),false);
 for(const ext of ['js','json','wxml','wxss'])assert.equal(fs.existsSync(path.join(root,'pages/owner/index.'+ext)),false);
 assert.equal(fs.existsSync(path.join(root,'services/owners.js')),false);
});
test('profile renders separate personal and evidence cards with labelled account actions',()=>{
 const p=page('pages/profile/index.js');const compiler=require('miniprogram-compiler');
 const compiled=compiler.wxmlToJs(root,{wxmlList:['pages/profile/index.wxml'],maxBuffer:16*1024*1024});
 const render=vm.runInNewContext('(function(global){'+compiled+'})({})',{window:{},console})('pages/profile/index.wxml');
 for(const authenticated of [false,true]){
  const tree=render({...p.data,authenticated,profile:{name:'客户',mobile:'13000000000'},identityStatusText:'未核验'}),all=nodes(tree);
  assert.doesNotMatch(JSON.stringify(tree),/企业车主|入驻|用印授权|车主中心|历史资料|本人实名与签署|签署证书|法大大|ACCOUNT|让每次出行|返回首页/);
  const handlers=all.filter(x=>x.tag==='wx-button').map(x=>x.attr.bindtap);
  assert.equal(handlers.includes('openOwner'),false);assert.equal(handlers.includes('openProfile'),false);
  assert.equal(handlers.includes('verifyIdentity'),false);assert.equal(handlers.includes('clearCache'),false);assert.equal(handlers.includes('toggleHistory'),false);
  if(authenticated){
   const cards=all.filter(x=>x.tag==='wx-view'&&x.attr?.class?.split(' ').includes('card'));assert.equal(cards.length,2);
   assert.match(JSON.stringify(cards[0]),/个人信息/);assert.match(JSON.stringify(cards[0]),/姓名：|手机号：|身份证号码：/);assert.match(JSON.stringify(cards[1]),/证件资料/);assert.doesNotMatch(JSON.stringify(cards),/保存个人资料|tablist/);
   assert.equal(handlers.filter(handler=>handler==='chooseDocument').length,3);
   const account=all.find(node=>node.attr?.class==='profile-footer');assert.deepEqual(nodes(account).filter(node=>node.tag==='wx-button').map(node=>node.attr.bindtap),['callService','logout']);assert.equal(handlers.includes('openHome'),false);
  }else{assert.equal(handlers.includes('openProfile'),false);assert.equal(handlers.includes('logout'),false);assert.doesNotMatch(JSON.stringify(tree),/实名核验/);}
  const phone=all.find(x=>x.tag==='wx-button'&&x.attr.bindtap==='callService');assert.equal(phone.children.join(''),'联系客服');assert.match(phone.attr.class,/settings-contact/);
 }
 assert.equal(typeof p.openOwner,'undefined');
});
test('legal reader preserves customer rental and data-sharing disclosures while excluding owner onboarding and authorization',()=>{
 for(const type of ['privacy','terms','application','credit-verification','mileage-pack','owner-rental-contract','owner-data-sharing']){const p=page('pages/legal/index.js');p.reload=()=>{};p.onLoad({type});assert.equal(p.type,type);}
 for(const type of ['owner-identity','owner-auto-sign','owner-authorization-letter']){const p=page('pages/legal/index.js');p.reload=()=>{};p.onLoad({type});assert.equal(p.type,'terms');}
});
test('personal face bridge instructions do not describe company certificates or seals',()=>{
 const text=fs.readFileSync(path.join(root,'pagesFace/pages/middle/middle.wxml'),'utf8');assert.doesNotMatch(text,/企业认证|返回企业页面|印章/);assert.match(text,/本人/);assert.match(text,/核验/);
});
