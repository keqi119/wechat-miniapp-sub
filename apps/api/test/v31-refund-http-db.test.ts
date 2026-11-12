import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness} from './seven-module-journey-fixtures';
import {cancellationFixture} from './v31-cancellation-fixture';
import {tokenHash} from '../src/auth/auth.service';
test('real obligation routes enforce current staff, customer ownership, CSRF and finance writes',async()=>{
 const h=new JourneyHarness(),saved={...process.env};try{await h.start();process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';const {f,sub}=await cancellationFixture(h.db),token=randomUUID(),csrf=randomUUID();await h.db.adminSession.create({data:{id:tokenHash(token),adminId:f.actor.id,authVersion:f.actor.authVersion,csrfToken:csrf,expiresAt:new Date(Date.now()+3600000)}});const admin={id:f.actor.id,headers:{Origin:h.origin,Cookie:`admin_session=${token}`,'X-CSRF-Token':csrf}};
 const path=`/admin/refunds/orders/${sub.order.id}/obligations`,v=await h.get(path,admin);assert.equal(v.orderId,sub.order.id);assert.ok(Array.isArray(v.items));assert.equal((await h.get('/admin/refunds/working-calendar',h.finance)).years.length,2);
 await h.reject(path,{sourceHash:v.sourceHash,idempotencyKey:randomUUID()},h.maker,'FORBIDDEN');await h.reject(path,{sourceHash:v.sourceHash,amount:99,idempotencyKey:randomUUID()},h.finance,'VALIDATION');
 const foreign=await h.customer('refund-foreign');assert.equal((await fetch(h.base+`/api/customer/orders/${sub.order.id}/refund-obligations`,{headers:foreign.headers})).status,404);
 assert.equal((await fetch(h.base+'/api'+path,{headers:h.support.headers})).status,403);
 assert.equal((await fetch(h.base+'/api'+path,{method:'POST',headers:{...h.finance.headers,'X-CSRF-Token':'wrong','Content-Type':'application/json'},body:JSON.stringify({sourceHash:v.sourceHash,idempotencyKey:randomUUID()})})).status,403);
 await h.db.adminUser.update({where:{id:f.actor.id},data:{authVersion:{increment:1}}});assert.equal((await fetch(h.base+'/api'+path,{headers:admin.headers})).status,401);assert.equal(h.externalCalls+h.esignCalls+h.identityCalls,0);
 }finally{await h.close();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
