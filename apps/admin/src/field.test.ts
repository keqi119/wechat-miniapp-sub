import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toDraft,fromDraft,phase,canEdit,validateFile} from './field/forms.ts';
test('Shanghai local form time round-trips independently of device timezone and blanks remain unset',()=>{
 const d=toDraft({actualAt:'2026-10-17T15:23',readingKm:'118000',batteryPercent:'80',place:'上海现场',accessories:'钥匙',condition:'正常',openItems:'无',resolutionPlan:'无',resolutionNote:''},['f']);
 assert.equal(d.actualAt,'2026-10-17T07:23:00.000Z');assert.equal(fromDraft(d).actualAt,'2026-10-17T15:23');
 assert.equal(toDraft({...fromDraft(d),readingKm:''},[]).readingKm,null);
 assert.throws(()=>toDraft({...fromDraft(d),readingKm:'1.2'},[]));
});
test('only unsubmitted and objection drafts editable, completed signing is separate',()=>{
 assert.equal(canEdit({status:'ASSIGNED',canEdit:true,handover:null}),true);
 assert.equal(canEdit({status:'ASSIGNED',canEdit:false,handover:{status:'PUBLISHED'}}),false);
 assert.equal(canEdit({status:'CANCELLED',canEdit:true}),false);
 assert.match(phase({status:'ASSIGNED',handover:{status:'CUSTOMER_CONFIRMED',signatureStatus:'DRAFT'}}),/签署/);
 assert.match(phase({status:'ASSIGNED',handover:{status:'COMPLETED'}}),/完成/);
});
test('unsupported camera file formats and oversized files have actionable errors',()=>{
 assert.throws(()=>validateFile({type:'image/heic',size:10}),/JPEG/);
 assert.throws(()=>validateFile({type:'image/jpeg',size:10*1024*1024+1}),/10/);
 assert.doesNotThrow(()=>validateFile({type:'image/png',size:100}));
});

test('online customer confirmation waits only for actual backend completion, legacy paper stays explicit',()=>{assert.equal(phase({status:'ASSIGNED',contractMode:'OFFLINE',handover:{status:'CUSTOMER_CONFIRMED',confirmationMode:'ONLINE_RECORD',executionMode:'OFFLINE'}}),'客户已确认 · 等待后台完成交接');});
