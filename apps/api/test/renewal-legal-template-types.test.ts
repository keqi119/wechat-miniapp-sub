import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AdminController} from '../src/operations/admin';
import {legalContentHash} from '../src/operations/legal-template';

const bodies={OFFLINE_ORDER_AMENDMENT:'原合同{{originalContractNo}}，承租人{{customerName}}、出租人{{lessorName}}、平台{{platformName}}。\n{{changeFacts}}\n{{periodSchedule}}\n{{financialSchedule}}',OFFLINE_RENEWAL_CANCELLATION:'原合同{{originalContractNumber}}，{{customerName}}、{{ownerName}}、{{platformName}}共同确认。\n{{cancellationFacts}}\n{{refundPolicy}}'};
function fixture(){
 const rows:any[]=[],commands=new Map<string,any>(),actor={id:'operator',role:'OPERATIONS',active:true,authVersion:1};
 const tx:any={$queryRaw:async()=>[],$executeRaw:async()=>0,adminUser:{findUnique:async()=>actor},auditLog:{create:async({data}:any)=>data},legalDocument:{create:async({data}:any)=>{const row={id:'document-'+rows.length,status:'DRAFT',...data};rows.push(row);return row;},findUnique:async({where}:any)=>rows.find(row=>row.id===where.id),update:async({where,data}:any)=>Object.assign(rows.find(row=>row.id===where.id),data),updateMany:async({where,data}:any)=>{const selected=rows.filter(row=>row.type===where.type&&row.status===where.status);selected.forEach(row=>Object.assign(row,data));return{count:selected.length};}},archiveCommand:{findUnique:async({where}:any)=>commands.get(JSON.stringify(where.actorId_resourceId_action_key)),create:async({data}:any)=>{commands.set(JSON.stringify({actorId:data.actorId,resourceId:data.resourceId,action:data.action,key:data.key}),data);return data;}}};
 const controller=new AdminController({serial:async(fn:any)=>fn(tx)} as any),request={admin:actor};
 const activate=(document:any)=>controller.activateLegal(document.id,{confirmed:true,expectedVersion:document.version,expectedContentHash:legalContentHash(document),idempotencyKey:'activate-'+document.id},request);
 return{rows,controller,request,activate};
}
test('operators can create both required offline template types as drafts without activating any text',async()=>{
 const f=fixture();for(const[type,content]of Object.entries(bodies)){const result=await f.controller.create('legal-documents',{type,content,title:'合成待审核模板',version:1},f.request);assert.equal(result.status,'DRAFT');assert.equal(result.confirmedAt,undefined);}assert.equal(f.rows.filter(row=>row.status==='PUBLISHED').length,0);
});
test('explicit content-pinned activation accepts each renderer factual group and retires only the same type',async()=>{
 const f=fixture();for(const[type,content]of Object.entries(bodies)){const draft={id:type,type,content,title:'合成模板',version:2,status:'DRAFT'};f.rows.push({id:'old-'+type,type,content:'历史已签正文',title:'历史',version:1,status:'PUBLISHED'},draft);assert.equal((await f.activate(draft)).status,'PUBLISHED');assert.equal(f.rows.find(row=>row.id==='old-'+type).status,'RETIRED');}
});
test('activation rejects missing factual groups and foreign placeholders, and cannot reuse cancellation tokens in rental templates',async()=>{
 for(const[type,content]of Object.entries(bodies))for(const bad of ['仅{{customerName}}与平台约定。',content+' {{unknownSource}}']){const f=fixture(),draft={id:type,type,content:bad,title:'缺失事实',version:1,status:'DRAFT'};f.rows.push(draft);await assert.rejects(f.activate(draft));assert.equal(draft.status,'DRAFT');}
 const f=fixture(),draft={id:'rental',type:'OFFLINE_RENTAL',content:'{{cancellationFacts}} {{refundPolicy}}',title:'错误模板',version:1,status:'DRAFT'};f.rows.push(draft);await assert.rejects(f.activate(draft));assert.equal(draft.status,'DRAFT');
});
