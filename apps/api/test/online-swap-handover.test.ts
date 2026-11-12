import {test} from 'node:test';
import assert from 'node:assert/strict';
import {offlineSwapPhysicalFixture} from './offline-swap-physical-fixture';
import {completeSwapHandover} from '../src/vehicle-changes/handovers';
import {assertOfflineSwapHandoverSource} from '../src/vehicle-changes/offline-physical-source';
import {saveFile} from '../src/files/storage';
import {canonicalHash} from '../src/customers/types';
import {hash} from '../src/common/data';
import {onlineRecordFacts,onlineConfirmationData,onlineHandoverReadiness} from '../src/operations/online-handover';
test('both online swap sides retain quote, finance, FIELD, credit and assignment gates while completing without paper receipts',async()=>{
 const f=await offlineSwapPhysicalFixture(),bytes=Buffer.from('89504e470d0a1a0a0000000049454e44ae426082','hex'),stored=await saveFile({buffer:bytes,mimetype:'image/png',originalname:'合成换车证据.png',size:bytes.length} as any),file={id:'physical-proof',adminId:'ops',customerId:null,...stored};
 const original=f.tx.storedFile.findMany;f.tx.storedFile.findMany=async(args:any)=>args.where?.id?.in?.includes(file.id)?[file]:original(args);
 function online(side:'RETURN'|'DELIVERY',task:string){const h=f.addFact(side,task);h.revision=1;h.confirmationMode='ONLINE_RECORD';const s={documentId:'legal',termsVersion:'1',termsTitle:'线上交接约定',termsContent:'合成约定',termsHash:hash('合成约定'),facts:onlineRecordFacts(h),evidence:[{fileId:file.id,sha256:file.sha256,size:file.size}],parties:{customerId:h.customerId},sourceHash:h.manifestHash};h.onlineRecordSnapshot=s;h.manifestHash=canonicalHash(s);h.onlineConfirmation=onlineConfirmationData(h,{revision:1,manifestHash:h.manifestHash,documentId:'legal',termsVersion:'1',termsHash:s.termsHash,termsAccepted:true,readFileIds:h.fileIds},h.customerId);f.receipts.length=0;return h;}
 const returned=online('RETURN','online-return-task');assert.doesNotThrow(()=>assertOfflineSwapHandoverSource(returned,f.change,f.q));const originalManifest=returned.manifestHash;
 await completeSwapHandover(f.tx,returned,'ops');assert.equal(f.change.status,'SWAP_RETURNED');assert.equal(f.order.currentAssignmentId,null);assert.equal(returned.manifestHash,originalManifest);
 const delivered=online('DELIVERY','online-delivery-task');await completeSwapHandover(f.tx,delivered,'ops');assert.equal(f.change.status,'APPLIED');assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,1);assert.equal(f.receipts.length,0);assert.equal(onlineHandoverReadiness(delivered,delivered.customerId).stage,'RECORDED');
});
