const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { handoverRecord, stages } = require('./fixtures/customer-handover-page.cjs');
const sourceRoot = path.resolve(process.env.MINIAPP_SOURCE_ROOT || process.env.MINIAPP_SOURCE_DIR || path.join(__dirname, '../src'));
async function setup(record = handoverRecord()) {
  let definition, current = record, failRead = false, afterSubmit = handoverRecord('PREPARING');
  const calls = [], notices = [];
  const services = {
    getDashboard: async () => ({ subscription: { vehicleName: '离线合成验收车辆', planTitle: '离线套餐' }, handover: { id: current.id } }),
    getContext: () => ({ profile: { name: '离线测试客户' } }),
    getHandover: async id => { calls.push(['read', id]); if (failRead) throw Error('读取失败'); return structuredClone(current); },
    openPrivateFile: async id => { calls.push(['file', id]); },
    performAction: async (...args) => { calls.push(['action', ...args]); },
    submitHandover: async body => { calls.push(['submit', body]); current = afterSubmit; return { id: current.id, status: current.status, customerResponse: current.customerResponse }; },
    idempotencyKey: () => 'offline-idempotency',
  };
  const helpers = { ...require(path.join(sourceRoot, 'utils/page')), toastError: error => notices.push(error.message), go: () => {} };
  vm.runInNewContext(fs.readFileSync(path.join(sourceRoot, 'pages/handover/index.js'), 'utf8'), { Page: value => definition = value, require: name => name.includes('/services/') ? services : name.includes('/utils/page') ? helpers : require(path.resolve(sourceRoot, 'pages/handover', name)) });
  const page = { ...definition, data: structuredClone(definition.data), handoverId: record.id, setData(value) { Object.assign(this.data, value); } };
  await page.reload();
  return { page, calls, notices, set: value => current = value, failRead: () => failRead = true, setAfterSubmit: value => afterSubmit = value };
}
const readChange = checked => ({ detail: { value: checked ? ['read'] : [] } });
test('evidence checkbox requires opened attachments, can be unchecked and clears dependent consent', async () => {
  const { page, calls } = await setup(handoverRecord('FACTS_PENDING'));
  page.showEvidence(); page.acknowledgeEvidence(readChange(true));
  assert.equal(page.data.evidenceRead, false);
  await page.openEvidence({ currentTarget: { dataset: { id: 'offline-photo' } } });
  page.acknowledgeEvidence(readChange(true)); assert.equal(page.data.evidenceRead, true);
  page.consent({ detail: { value: ['accepted'] } }); assert.equal(page.data.accepted, true);
  page.acknowledgeEvidence(readChange(false));
  assert.equal(page.data.evidenceRead, false); assert.equal(page.data.accepted, false);
  await page.submit(); assert.equal(calls.some(call => call[0] === 'submit'), false);
});
test('every waiting signing stage refuses native signing even when called directly', async () => {
  for (const stage of Object.keys(stages).filter(stage => stage !== 'READY_TO_SIGN')) {
    const env = await setup(handoverRecord(stage));
    await env.page.sign();
    assert.equal(env.calls.some(call => call[0] === 'action'), false, stage);
    assert.equal(env.page.data.signing.canSign, false, stage);
    assert.equal(env.page.data.signing.stage, stage);
  }
});
test('only bound current ready facts permit signing and repeated busy taps do not dispatch', async () => {
  const env = await setup(handoverRecord('READY_TO_SIGN'));
  assert.equal(env.page.data.signing.canSign, true);
  env.page.setData({ busy: true }); await env.page.sign();
  assert.equal(env.calls.some(call => call[0] === 'action'), false);
  env.page.setData({ busy: false }); await env.page.sign();
  assert.deepEqual(env.calls.filter(call => call[0] === 'action'), [['action', 'handovers', 'offline-handover', 'sign']]);
});
test('missing stale malformed or contradictory readiness closes signing', async () => {
  for (const alter of [h => delete h.signingReadiness, h => h.signingReadiness.version = 2, h => h.signingReadiness.handoverId = 'other', h => h.signingReadiness.manifestHash = 'stale', h => h.signingReadiness.revision++, h => h.signingReadiness.stage = 'NEW_STAGE', h => h.signingReadiness.canSign = 'true', h => h.customerResponse = 'OBJECT', h => h.status = 'SUPERSEDED', h => h.actualAtValid = false, h => h.signatureStatus = 'SIGNED']) {
    const record = handoverRecord('READY_TO_SIGN'); alter(record); const env = await setup(record);
    await env.page.sign(); assert.equal(env.calls.some(call => call[0] === 'action'), false);
    assert.equal(env.page.data.signing.canSign, false);
  }
});
test('fact submission rereads readiness instead of retaining published facts stage', async () => {
  const env = await setup(handoverRecord('FACTS_PENDING'));
  env.page.setData({ evidenceRead: true, accepted: true, readFileIds: ['offline-photo'] });
  await env.page.submit();
  assert.equal(env.page.data.submitted.customerResponse, 'CONFIRM');
  assert.equal(env.page.data.signing.stage, 'PREPARING');
  assert.equal(env.page.data.signing.canSign, false);
  assert.deepEqual(env.calls.map(call => call[0]), ['read', 'submit', 'read']);
});
test('ordinary refresh picks up review progression without querying or invoking a signing provider', async () => {
  const env = await setup();
  env.set(handoverRecord('REVIEWING')); await env.page.reload(); assert.equal(env.page.data.signing.stage, 'REVIEWING');
  env.set(handoverRecord('READY_TO_SIGN')); await env.page.reload(); assert.equal(env.page.data.signing.canSign, true);
  assert.deepEqual(env.calls.map(call => call[0]), ['read', 'read', 'read']);
  env.failRead(); await env.page.reload(); await env.page.sign();
  assert.equal(env.calls.some(call => call[0] === 'action'), false);
});
test('changing current evidence version resets both explicit acknowledgements', async () => {
  const env = await setup(handoverRecord('FACTS_PENDING'));
  env.page.setData({ evidenceRead: true, accepted: true, readFileIds: ['offline-photo'] });
  env.set(handoverRecord('FACTS_PENDING', { revision: 3, manifestHash: 'b'.repeat(64) }));
  await env.page.reload(); assert.equal(env.page.data.evidenceRead, false); assert.equal(env.page.data.accepted, false); assert.equal(env.page.data.readFileIds.length, 0);
});

test('submitted and terminal handovers hide process checkboxes while evidence stays accessible', async () => {
  const {renderPage}=require('./helpers/wxml-view.cjs');
  for(const status of ['CUSTOMER_CONFIRMED','OBJECTION_SUBMITTED','COMPLETED','SUPERSEDED']){
    const env=await setup(handoverRecord('PREPARING',{status}));
    env.page.showEvidence();
    const text=renderPage('handover',env.page.data);
    assert.doesNotMatch(text,/我已阅读全部交接证据|待阅读|已打开.*份附件/);
    assert.match(text,/车辆外观与附件照片/);
    if(status==='SUPERSEDED')assert.match(text,/已被替代/);
    if(status==='COMPLETED')assert.match(text,/交接已完成/);
    env.page.acknowledgeEvidence(readChange(true));env.page.consent({detail:{value:['accepted']}});
    assert.equal(env.page.data.accepted,false);
    await env.page.openEvidence({currentTarget:{dataset:{id:'offline-photo'}}});
    assert.equal(env.calls.some(c=>c[0]==='file'),true);
  }
});

function onlineRecord(stage='FACTS_PENDING',extra={}){
 const raw=handoverRecord(stage==='FACTS_PENDING'?'FACTS_PENDING':'PREPARING',extra);
 raw.executionMode='OFFLINE';raw.confirmationMode='ONLINE_RECORD';
 raw.onlineRecord={documentId:'online-terms',termsVersion:'ONLINE_HANDOVER_V1',termsTitle:'线上交接约定',termsContent:'合成完整线上交接约定：本人核对证据并确认，由后台核对实际完成后自动留存。',termsHash:'d'.repeat(64),evidence:[{fileId:'offline-photo',sha256:'e'.repeat(64),size:100}],confirmedAt:null,completedAt:null};
 raw.signingReadiness={version:3,confirmationMode:'ONLINE_RECORD',handoverId:raw.id,revision:raw.revision,manifestHash:raw.manifestHash,stage,canSign:false,message:'合成线上交接进度'};
 return raw;
}
test('all four explicit online record types show full terms and bind consent to current evidence and terms',async()=>{
 const {renderPage}=require('./helpers/wxml-view.cjs');
 for(const type of ['DELIVERY','RETURN','SWAP_DELIVERY','SWAP_RETURN']){
  const h=onlineRecord('FACTS_PENDING',{type});const env=await setup(h);
  const text=renderPage('handover',env.page.data);assert.match(text,/合成完整线上交接约定/);assert.doesNotMatch(text,/纸质交接单|交接单须单独签署/);
  env.page.showEvidence();await env.page.openEvidence({currentTarget:{dataset:{id:'offline-photo'}}});env.page.acknowledgeEvidence(readChange(true));env.page.consent({detail:{value:['accepted']}});await env.page.submit();
  const body=env.calls.find(c=>c[0]==='submit')?.[1];assert.ok(body);assert.equal(body.revision,h.revision);assert.equal(body.termsVersion,h.onlineRecord.termsVersion);assert.equal(body.termsHash,h.onlineRecord.termsHash);assert.equal(body.termsAccepted,true);
 }
});
test('online terms changes reset all acknowledgements, unknown or incomplete online state cannot submit',async()=>{
 const env=await setup(onlineRecord());env.page.setData({evidenceRead:true,accepted:true,readFileIds:['offline-photo']});
 const changed=onlineRecord();changed.onlineRecord.termsHash='f'.repeat(64);env.set(changed);await env.page.reload();assert.equal(env.page.data.accepted,false);assert.equal(env.page.data.evidenceRead,false);assert.equal(env.page.data.readFileIds.length,0);
 for(const alter of [h=>h.confirmationMode='UNKNOWN',h=>delete h.onlineRecord,h=>h.onlineRecord.termsContent='',h=>h.signingReadiness.stage='NEW',h=>h.signingReadiness.revision++]){
  const h=onlineRecord();alter(h);const bad=await setup(h);bad.page.setData({evidenceRead:true,accepted:true,readFileIds:['offline-photo']});await bad.page.submit();assert.equal(bad.calls.some(c=>c[0]==='submit'),false);
 }
});
test('recorded online handover keeps full retained terms and evidence without paper or consent controls',async()=>{
 const {renderPage}=require('./helpers/wxml-view.cjs');const h=onlineRecord('RECORDED',{status:'COMPLETED',customerResponse:'CONFIRM'});h.onlineRecord.confirmedAt='2026-10-26T10:31:00Z';h.onlineRecord.completedAt='2026-10-26T10:32:00Z';const env=await setup(h);env.page.showEvidence();
 const text=renderPage('handover',env.page.data);assert.match(text,/合成完整线上交接约定/);assert.match(text,/车辆外观与附件照片/);assert.doesNotMatch(text,/我已阅读全部交接证据|纸质交接单|交接单须单独签署/);assert.equal(env.page.data.signing.onlineRecord,true);assert.equal(env.page.data.signing.canSign,false);
});
test('completed ELECTRONIC initial delivery is readonly evidence and never offers consent or paper/sign actions',async()=>{
 const {renderPage}=require('./helpers/wxml-view.cjs');const h=onlineRecord('RECORDED',{type:'DELIVERY',status:'COMPLETED',customerResponse:'CONFIRM'});h.executionMode='ELECTRONIC';h.onlineRecord.confirmedAt='2026-11-08T10:31:00Z';h.onlineRecord.completedAt='2026-11-08T10:32:00Z';const env=await setup(h);env.page.showEvidence();const text=renderPage('handover',env.page.data);assert.match(text,/交接已完成/);assert.doesNotMatch(text,/我已阅读全部交接证据|确认无异议|纸质交接单|签署当前交接单/);env.page.acknowledgeEvidence(readChange(true));env.page.consent({detail:{value:['accepted']}});await env.page.submit();await env.page.sign();assert.equal(env.calls.some(c=>['submit','sign'].includes(c[0])),false);
});
