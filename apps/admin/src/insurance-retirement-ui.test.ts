import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {build} from 'vite';
import {chromium,expect} from '@playwright/test';

test('insurance screens keep retired requirements absent and retain genuine renewal reminders',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),result:any=await build({configFile:false,root,logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'insurance-retirement',resolveId:id=>id==='virtual:retirement'?id:undefined,load:id=>process.env.INSURANCE_RETIREMENT_BEFORE&&id.replaceAll('\\','/').endsWith('/src/insurance.tsx')?readFileSync(process.env.INSURANCE_RETIREMENT_BEFORE,'utf8'):id==='virtual:retirement'?`import React from 'react';import {createRoot} from 'react-dom/client';import {api} from '/src/core';import {InsurancePage,CoverageRequirements} from '/src/insurance';import '/src/style.css';import '/src/domain-ui.css';api.setSession({user:{id:'reviewer',role:'OPERATIONS',permissions:['*']},csrfToken:'local-only'});const mode=new URLSearchParams(location.search).get('mode');createRoot(document.getElementById('root')).render(React.createElement(mode==='retired'?CoverageRequirements:InsurancePage,{renewals:mode==='renewals'}));`:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:retirement'}}});
 const out=(Array.isArray(result)?result[0]:result).output,assets=new Map(out.map((a:any)=>['/'+a.fileName,a])),script=out.find((a:any)=>a.type==='chunk').fileName,styles=out.filter((a:any)=>a.fileName.endsWith('.css')).map((a:any)=>`<link rel="stylesheet" href="/${a.fileName}">`).join('');
 const server=createServer((req,res)=>{const a:any=assets.get(new URL(req.url!,'http://localhost').pathname);res.setHeader('Content-Type',a?a.fileName.endsWith('.css')?'text/css':'text/javascript':'text/html');res.end(a?a.code||a.source:`<!doctype html><html><head>${styles}</head><body><div id="root"></div><script type="module" src="/${script}"></script></body></html>`);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 const browser=await chromium.launch({headless:true}).catch(e=>{if(!String(e).includes("Executable doesn't exist"))throw e;return chromium.launch({channel:'chrome',headless:true});}),page=await browser.newPage({viewport:{width:1440,height:1000}}),reads:string[]=[],writes:any[]=[],errors:string[]=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
 const version={id:'version',version:1,revision:4,status:'SUBMITTED',changeKind:'ORIGINAL',vehicleIds:['vehicle'],fileIds:['file'],requirementVersionIds:['historical-only'],createdBy:'creator',submittedBy:'creator',editedByIds:[],coverageItems:[{code:'A',label:'险种A',amount:10000,deductible:'原件',terms:'原件'}]},policy={id:'policy',revision:9,policyNumber:'REAL-COMPONENT-LOCAL',insurer:'合成机构',versions:[version],files:[{fileId:'file',uploadedBy:'creator'}]};
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);if(!url.pathname.startsWith('/api/'))return route.continue();const path=url.pathname.slice(4);if(req.method()!=='GET'){writes.push({path,body:req.postDataJSON()});return route.fulfill({json:{id:'saved'}});}reads.push(path);if(path==='/admin/insurance-policies/policy')return route.fulfill({json:policy});if(path==='/admin/insurance-policies')return route.fulfill({json:{items:[policy],total:1}});if(path.startsWith('/admin/coverage-requirements'))return route.fulfill({status:410,json:{error:{code:'COVERAGE_REQUIREMENTS_RETIRED',message:'已停用'}}});return route.fulfill({json:{items:[],total:0}});});
 try{
  await page.goto(origin+'/#insurance');await page.getByRole('row').filter({hasText:'REAL-COMPONENT-LOCAL'}).getByRole('button',{name:'查看',exact:true}).click();
  await expect(page.getByRole('button',{name:'修改保险信息',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/独立复核保单|提交保单复核/})).toHaveCount(0);
  assert.equal(reads.some(p=>p.startsWith('/admin/coverage-requirements')),false);
  assert.deepEqual(writes,[]);
  await page.goto(origin+'/?mode=renewals');await expect(page.getByRole('heading',{name:'续保待办',exact:true})).toBeVisible();await expect(page.getByText('当前暂无待办。')).toBeVisible();
  await page.goto(origin+'/?mode=retired');await expect(page.getByText('保障要求管理已停用',{exact:true})).toBeVisible();assert.equal(reads.some(p=>p.startsWith('/admin/coverage-requirements')),false);assert.deepEqual(errors,[]);
 }catch(e){console.log(JSON.stringify({reads,errors,text:await page.locator('body').innerText()}));throw e;}finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
});
