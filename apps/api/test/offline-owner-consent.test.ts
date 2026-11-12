import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lessorIdentityHash} from '../src/owner-signing/lessor';
import {ownerOrderSharingValid} from '../src/offline-documents/partner-access';
test('partner order reading requires the original customer consent to this exact frozen lessor and notice',()=>{
 const lessor:any={ownerId:'owner',name:'合成出租方',sharingNotice:{contentHash:'notice'}},consent={ownerId:'owner',customerId:'customer',lessorHash:lessorIdentityHash(lessor),notice:{contentHash:'notice'},acceptedAt:'2026-10-27T00:00:00Z'},order={customerId:'customer',finalPlanSnapshot:{lessorSnapshot:lessor,ownerDataConsent:consent}};
 assert.equal(ownerOrderSharingValid(order,'owner'),true);assert.equal(ownerOrderSharingValid(order,'other'),false);
 for(const change of [{ownerId:'other'},{customerId:'other'},{lessorHash:'changed'},{notice:{contentHash:'changed'}},{acceptedAt:null}])assert.equal(ownerOrderSharingValid({...order,finalPlanSnapshot:{lessorSnapshot:lessor,ownerDataConsent:{...consent,...change}}},'owner'),false);
 assert.equal(ownerOrderSharingValid({...order,finalPlanSnapshot:{lessorSnapshot:lessor}},'owner'),false);
});
