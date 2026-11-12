import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import type {LegalTask} from './legal-client.ts';

function syntheticPdf(signed=false){
 const content='BT /F1 18 Tf 40 700 Td (Synthetic contract - local test only) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
 if(signed){
  objects[0]='<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R] /SigFlags 3 >> >>';
  objects[2]=objects[2].replace('/Contents','/Annots [6 0 R] /Contents');
  const appearance='q 0.8 0 0 RG 0.8 0 0 rg 3 w 5 5 150 100 re S BT /F1 12 Tf 18 52 Td (SYNTHETIC SEAL) Tj ET Q';
  objects.push('<< /Type /Annot /Subtype /Widget /FT /Sig /T (synthetic) /F 4 /Rect [360 80 520 190] /AP << /N 7 0 R >> >>',`<< /Type /XObject /Subtype /Form /BBox [0 0 160 110] /Resources << /Font << /F1 4 0 R >> >> /Length ${appearance.length} >>\nstream\n${appearance}\nendstream`);
 }
 let pdf='%PDF-1.4\n';const offsets=[0];
 objects.forEach((body,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${body}\nendobj\n`;});
 const size=objects.length+1,xref=pdf.length;pdf+=`xref\n0 ${size}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(pdf);
}
test('actual legal app binds PDF consent, confirms grant cancellation once and isolates provider departure',{timeout:90000},async()=>{
 const server=await createServer({configFile:false,root:fileURLToPath(new URL('../..',import.meta.url)),logLevel:'error',server:{host:'127.0.0.1',port:0}});
 await server.listen();
 const origin=`http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`,browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}}),requests:{path:string;body:any;csrf:string|undefined}[]=[],errors:string[]=[];
 const party=(role:string,status:string)=>({role,mode:'MANUAL',status,signedAt:status==='SIGNED'?'2026-11-09T00:00:00Z':null});
 const grant:LegalTask={id:'grant',kind:'COOPERATION_GRANT',orderId:null,status:'ARCHIVING',revision:7,sourceSha256:'a'.repeat(64),signaturePolicy:'MANUAL_ONLY',parties:[party('OWNER','SIGNED'),party('PLATFORM','SIGNED')],nextAction:{kind:'ARCHIVE'},stopStatus:'NONE',evidenceReviewStatus:'NONE',legalCompletedAt:'2026-11-09T00:00:00Z',archivedAt:null,filingStatus:'CONFIRMED',lastErrorCode:'ELECTRONIC_FINAL_VERIFICATION_FAILED',finalFileAvailable:false,grant:{id:'grant-record',revision:2,sourceHash:'a'.repeat(64),revokedAt:null,archivedAt:null},frozenSources:{parties:{OWNER:{id:'company'},PLATFORM:{id:'platform'}}}};
 const pending:LegalTask={...grant,id:'pending',kind:'COOPERATION',status:'PREPARED',revision:3,grant:null,legalCompletedAt:null,filingStatus:'NOT_STARTED',lastErrorCode:null,parties:[party('OWNER','PENDING'),party('PLATFORM','PENDING')],nextAction:{kind:'SIGN',role:'OWNER'}};
 const signed:LegalTask={...grant,id:'signed',kind:'COOPERATION_AMENDMENT',status:'ARCHIVED',grant:null,lastErrorCode:null,archivedAt:'2026-11-10T00:00:00Z',finalFileAvailable:true,nextAction:{kind:'DONE'}};
 let pdfFailure=false,holdPdf=false,releasePdf:(()=>Promise<void>)|undefined,expired=false;
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin==='https://textapi17.fadada.com')return route.abort('aborted');
   assert.equal(url.origin,origin,'the fixture must never contact an external system');
   if(!url.pathname.startsWith('/owner/api'))return route.continue();
   const path=url.pathname.slice('/owner/api'.length),body=request.method()==='POST'?request.postDataJSON():undefined;
   requests.push({path,body,csrf:request.headers()['x-csrf-token']});
   const json=(value:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
   if(path==='/config')return json({enabled:true,mode:'PARTNER_READONLY'});
   if(path==='/legal'||path==='/legal-signing')return json({documents:['terms','privacy','owner-identity'].map(type=>({id:type,type,version:1,title:'合成说明',content:'本地测试'}))});
   if(expired)return json({error:{message:'签署登录已失效，请重新登录'}},401);
   if(path==='/auth/me')return json({mode:'ELECTRONIC_LEGAL',sessionBinding:'synthetic-session',csrfToken:'synthetic-csrf',expiresAt:'2099-01-01T00:00:00Z',viewer:{maskedMobile:'138****0000'},owners:[{ownerId:'company'}]});
   if(path==='/owners')return json([{ownerId:'company',name:'合成企业',status:'VERIFIED',memberStatus:'VERIFIED'}]);
   if(path==='/owners/company')return json({id:'company',name:'合成企业',creditCode:'SYNTHETIC',address:'合成地址',status:'VERIFIED',revision:1,memberStatus:'VERIFIED',realNameStatus:'VERIFIED',certStatus:'BOUND',readyForSigning:true,autoSigningEnabled:false,authorizationEntryEnabled:false,authorizationExecutionEnabled:false,seals:[],verificationDisplay:{identity:{complete:true,state:'COMPLETED',verifiedAt:'2026-11-09T00:00:00Z'},label:'企业认证已完成',message:'合成已认证'},legalRepresentative:{name:'合成法人',maskedMobile:'138****0000'},capabilities:{canStartVerification:false,canRefreshVerification:true,canSelectSeal:false,canRequestAuthority:false,canManageAuthority:false,canEnableAuthority:false},blockers:[]});
   if(path.endsWith('/electronic-documents'))return json({items:[grant,pending,signed],total:3});
   if(path.endsWith('/files/signed'))return route.fulfill({contentType:'application/pdf',body:syntheticPdf(true)});
   if(path.endsWith('/files/source')){
    const finish=()=>pdfFailure?json({error:{message:'文件暂时无法读取'}},503):route.fulfill({contentType:'application/pdf',body:syntheticPdf()});
    if(holdPdf){releasePdf=async()=>{await finish();};return;}return finish();
   }
   if(path.endsWith('/revoke-grant')){grant.grant!.revokedAt='2026-11-10T00:00:00Z';return json(grant);}
   if(path.endsWith('/sign'))return json({url:'https://textapi17.fadada.com/synthetic-only'});
   if(path.endsWith('/grant'))return json(grant);
   if(path.endsWith('/signed'))return json(signed);
   if(path.endsWith('/pending')||path.endsWith('/sync'))return json(pending);
   return json({error:{message:'未提供的合成接口'}},404);
  });
  await page.goto(origin+'/owner.html#/legal/company/grant');await expect(page.locator('.legal-task-detail')).toBeVisible({timeout:15000});
  assert.deepEqual(await page.locator('.legal-document-card .legal-document-state').allTextContents(),['待归档','待签署','已归档']);
  assert.deepEqual(await page.locator('.legal-document-card').first().locator('.legal-signer-mark').allTextContents(),['✓','✓']);
  await expect(page.getByRole('button',{name:'本人逐份签署',exact:true})).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'取消原因'})).toHaveCount(0);
  await page.getByRole('button',{name:'取消用印授权',exact:true}).click();const dialog=page.getByRole('dialog',{name:'取消用印授权'});
  await expect(dialog.getByRole('button',{name:'确认取消授权'})).toBeDisabled();await dialog.getByRole('textbox',{name:'取消原因'}).fill('暂不继续');await dialog.getByRole('button',{name:'暂不取消'}).click();
  assert.equal(requests.filter(r=>r.path.endsWith('/revoke-grant')).length,0);
  await page.getByRole('button',{name:'取消用印授权',exact:true}).click();await expect(dialog.getByRole('textbox',{name:'取消原因'})).toHaveValue('');
  await dialog.getByRole('textbox',{name:'取消原因'}).fill('  合成取消原因  ');await dialog.getByRole('button',{name:'确认取消授权'}).evaluate(el=>{(el as HTMLElement).click();(el as HTMLElement).click();});
  await expect(page.getByText('用印授权已取消。已有文件与签署记录保留。')).toBeVisible();
  const cancellations=requests.filter(r=>r.path.endsWith('/revoke-grant'));assert.equal(cancellations.length,1);assert.equal(cancellations[0].body.revision,7);assert.equal(cancellations[0].body.reason,'合成取消原因');assert.equal(cancellations[0].csrf,'synthetic-csrf');assert.ok(cancellations[0].body.idempotencyKey);
  await page.getByRole('button',{name:'查看合作补充协议，已归档'}).click();
  const selectedHeading=page.getByRole('heading',{name:'合作补充协议',exact:true});await expect(selectedHeading).toBeFocused();await expect.poll(async()=>{const box=await selectedHeading.boundingBox();return !!box&&box.y>=0&&box.y<400;}).toBe(true);
  await page.getByRole('button',{name:'查看签后文件'}).click();await expect(page.locator('.legal-pdf-canvas')).toBeVisible({timeout:15000});
  const redPixels=await page.locator('canvas').evaluate(element=>{const c=element as HTMLCanvasElement,d=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]>120&&d[i+1]<90&&d[i+2]<90)n++;return n;});
  assert.ok(redPixels>70,'signature Widget /FT /Sig /AP /N must remain visible on the canvas');
  pending.parties[0].status='SIGNED';pending.parties[0].signedAt='2026-11-10T00:00:00Z';pending.nextAction={kind:'SIGN',role:'PLATFORM'};
  await page.getByRole('button',{name:'查看主合作协议，待签署'}).click();await expect(page.getByRole('button',{name:'查看主合作协议，待签署'}).locator('.legal-signer-mark').first()).toHaveText('✓');
  pending.parties[0].status='PENDING';pending.parties[0].signedAt=null;pending.nextAction={kind:'SIGN',role:'OWNER'};
  await page.getByRole('button',{name:'查看独立用印授权，待归档'}).click();await page.getByRole('button',{name:'查看主合作协议，待签署'}).click();const consent=page.getByRole('checkbox',{name:'本人已阅读本版完整 PDF 并同意签署'});
  await expect(consent).toBeDisabled();pdfFailure=true;await page.getByRole('button',{name:'阅读文件原件'}).click();await expect(page.getByText('文件暂时无法读取',{exact:true})).toBeVisible();await expect(consent).toBeDisabled();
  pdfFailure=false;await page.getByRole('button',{name:'重新读取 PDF'}).click();await expect(page.locator('.legal-pdf-canvas')).toBeVisible();await expect(consent).toBeEnabled();await expect(consent).not.toBeChecked();
  await consent.check();await page.getByRole('button',{name:'关闭阅读'}).click();await expect(consent).not.toBeChecked();await expect(consent).toBeDisabled();
  holdPdf=true;await page.getByRole('button',{name:'阅读文件原件'}).click();await expect.poll(()=>!!releasePdf).toBe(true);
  await page.getByRole('button',{name:'查看独立用印授权，待归档'}).click();await releasePdf!();await expect(page.locator('.legal-pdf-canvas')).toHaveCount(0);holdPdf=false;
  await page.getByRole('button',{name:'查看主合作协议，待签署'}).click();await page.getByRole('button',{name:'阅读文件原件'}).click();await expect(consent).toBeEnabled();await expect(consent).not.toBeChecked();await consent.check();
  const departureStart=requests.length;await page.getByRole('button',{name:'本人逐份签署',exact:true}).click({noWaitAfter:true});
  await expect(page.getByRole('heading',{name:'正在前往签署…'})).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
  assert.deepEqual(requests.slice(departureStart).map(r=>r.path),['/owners/company/electronic-documents/pending/sign']);
  const sign=requests.at(-1)!;assert.equal(sign.body.revision,3);assert.equal(sign.body.sourceSha256,pending.sourceSha256);assert.equal(sign.body.accepted,true);assert.equal(sign.csrf,'synthetic-csrf');
  await page.goto(origin+'/owner.html?return=1');await expect(page.locator('.legal-task-detail')).toBeVisible();await expect.poll(()=>requests.slice(departureStart).filter(r=>r.path.endsWith('/sync')).length).toBe(1);
  assert.ok(requests.slice(departureStart).filter(r=>r.path.endsWith('/sync')).every(r=>r.path==='/owners/company/electronic-documents/pending/sync'));
  await expect(consent).toBeDisabled();await expect(consent).not.toBeChecked();expired=true;await page.getByRole('button',{name:'阅读文件原件'}).click();await expect(page.locator('.legal-task-detail')).toHaveCount(0);await expect(page.locator('canvas')).toHaveCount(0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
