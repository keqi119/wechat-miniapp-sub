const {test}=require('node:test'),assert=require('node:assert/strict');
const {createApi}=require('../src/services/api');
function raw(){return{id:'h',type:'DELIVERY',status:'PUBLISHED',revision:2,manifestHash:'a'.repeat(64),actualAt:'2026-10-26T10:30:00Z',executionMode:'OFFLINE',confirmationMode:'ONLINE_RECORD',fileIds:['f'],onlineRecord:{documentId:'terms',termsVersion:'V1',termsTitle:'合成约定',termsContent:'合成完整线上交接约定正文',termsHash:'b'.repeat(64),evidence:[{fileId:'f',sha256:'c'.repeat(64),size:100}]},signingReadiness:{version:3,confirmationMode:'ONLINE_RECORD',handoverId:'h',revision:2,manifestHash:'a'.repeat(64),stage:'FACTS_PENDING',canSign:false,message:'待本人确认'}};}
function setup(value=raw()){
 const calls=[];let session={token:'token',customer:{id:'c'},expiresAt:'2099-01-01T00:00:00Z'};
 const api=createApi({apiBase:'https://api.evsub.ndacar.com'},v=>{calls.push(v);if(v.method==='GET')v.success({statusCode:200,data:structuredClone(value)});else v.success({statusCode:200,data:{id:'h',status:'CUSTOMER_CONFIRMED'}});},{getStorageSync:()=>session});
 return{api,calls,value,rotate(){session={...session,token:'other',customer:{id:'other'}};}};
}
function body(){const h=raw();return{handoverId:'h',decision:'confirm',revision:2,manifestHash:h.manifestHash,actualAt:h.actualAt,documentId:'terms',termsVersion:'V1',termsHash:h.onlineRecord.termsHash,termsAccepted:true,readFileIds:['f'],evidenceRead:true,accepted:true,idempotencyKey:'once'};}
test('online confirmation posts explicit version terms and evidence bindings without signing supplier lookup',async()=>{
 const e=setup();await e.api.submitHandover(body());const post=e.calls.find(c=>c.method==='POST');assert.equal(post.data.revision,2);assert.equal(post.data.termsVersion,'V1');assert.equal(post.data.termsHash,body().termsHash);assert.equal(post.data.termsAccepted,true);assert.deepEqual(post.data.readFileIds,['f']);assert.equal(e.calls.some(c=>c.url.includes('signing-config')),false);
});
test('online stale terms evidence or unsupported state refuse confirmation before POST',async()=>{
 for(const alter of [b=>delete b.termsAccepted,b=>b.termsHash='d'.repeat(64),b=>b.revision++,b=>b.termsVersion='old',b=>b.readFileIds=[]]){
  const e=setup(),b=body();alter(b);await assert.rejects(e.api.submitHandover(b));assert.equal(e.calls.some(c=>c.method==='POST'),false);
 }
 for(const alter of [h=>h.confirmationMode='UNKNOWN',h=>h.signingReadiness.stage='NEW',h=>h.onlineRecord.termsContent='',h=>h.status='COMPLETED']){
  const h=raw();alter(h);const e=setup(h);await assert.rejects(e.api.submitHandover(body()));assert.equal(e.calls.some(c=>c.method==='POST'),false);
 }
});
test('explicit online records with legacy ESIGN execution mode do not trigger provider discovery',async()=>{
 const h=raw();h.executionMode='ESIGN';const e=setup(h);const result=await e.api.getHandover('h');assert.equal(result.confirmationMode,'ONLINE_RECORD');assert.equal(e.calls.length,1);await assert.rejects(e.api.performAction('handovers','h','sign'));assert.equal(e.calls.some(c=>c.method==='POST'),false);
});
