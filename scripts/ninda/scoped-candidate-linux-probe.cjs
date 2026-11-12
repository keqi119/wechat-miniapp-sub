// Bounded offline OS probe against an immutable candidate. No provider or database calls.
const {createRequire}=require('node:module'),requireApi=createRequire('/app/apps/api/package.json');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
Object.assign(process.env,{NODE_ENV:'test',UPLOAD_DIR:'/tmp/probe/uploads',DATABASE_URL:'postgresql://synthetic:synthetic@invalid/synthetic',NEW_ORDER_CONTRACT_MODE:'OFFLINE',CUSTOMER_IDENTITY_POLICY:'MANUAL_REVIEW',ESIGN_NEW_REQUESTS_ENABLED:'true',ELECTRONIC_SIGNING_ENABLED:'true',FADADA_SIGNING_ENABLED:'true',MINIAPP_SIGNING_ENABLED:'true',MINIAPP_FACE_BRIDGE_ENABLED:'false',FADADA_BASE_URL:'https://textapi17.fadada.com/api2/',MINIAPP_SIGNING_PROVIDER_HOSTS:'textapi17.fadada.com,realnameverify16.fadada.com',PLATFORM_API_ORIGIN:'https://api.evsub.ndacar.com',H5_SIGNING_ORIGIN:'https://sign.evsub.ndacar.com',ADMIN_ORIGIN:'https://admin.evsub.ndacar.com',OWNER_LEGAL_H5_ONLY:'false',H5_SIGNING_ENABLED:'false',JWT_SECRET:'synthetic-offline-probe-key'.repeat(2)});
const load=name=>requireApi('/app/apps/api/dist/'+name);
(async()=>{
 assert.equal(process.getuid(),1000);assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
 const PDF=requireApi('pdfkit'),doc=new PDF(),parts=[];
 const pdf=new Promise((resolve,reject)=>{doc.on('data',c=>parts.push(c));doc.on('end',()=>resolve(Buffer.concat(parts)));doc.on('error',reject);});
 load('contract/pdf-font').useCjkFont(doc,process.env.CONTRACT_CJK_FONT_PATH);doc.text('宁达隔离中文文件验证 人民币壹元整');doc.end();const bytes=await pdf;assert.ok(bytes.length>1000);
 let row;const db={storedFile:{create:async({data})=>(row={id:'synthetic-quarantine',...data}),findUnique:async()=>row},electronicFileQuarantine:{findUnique:async()=>({sha256:row.sha256}),count:async()=>1}};
 const writer=new (load('contract/contract-pdf-artifact-writer.service').ContractPdfArtifactWriterService)(db);
 await writer.persistPdf(bytes,{customerId:'synthetic-customer',name:'synthetic.pdf',purpose:'electronic-quarantine'});
 const sha=crypto.createHash('sha256').update(bytes).digest('hex');assert.equal(row.storagePath,`/tmp/probe/uploads/electronic-quarantine/${sha.slice(0,2)}/${sha}`);
 const modes=[];for(const [p,mode] of [[row.storagePath,0o600],[path.dirname(row.storagePath),0o700],[path.dirname(path.dirname(row.storagePath)),0o700]]){const st=await fs.stat(p);assert.equal(st.uid,1000);assert.equal(st.mode&0o777,mode);modes.push({path:p,uid:st.uid,mode:(st.mode&0o777).toString(8)});}
 assert.deepEqual(await writer.readQuarantined(row.id,sha),bytes);
 const {validateQuarantinePath}=load('files/quarantine-storage');
 await assert.rejects(()=>validateQuarantinePath('/tmp/probe/outside','/tmp/probe/uploads'));
 await fs.mkdir('/tmp/probe/outside');await fs.symlink('/tmp/probe/outside','/tmp/probe/uploads/escape');
 await assert.rejects(()=>validateQuarantinePath('/tmp/probe/uploads/escape','/tmp/probe/uploads'));
 const original=row.storagePath;await fs.rename(original,original+'.retained');await fs.symlink('/tmp/probe/outside/no-write',original);
 await assert.rejects(()=>writer.persistPdf(bytes,{customerId:null,name:'synthetic.pdf',purpose:'electronic-quarantine'}));
 await assert.rejects(()=>fs.stat('/tmp/probe/outside/no-write'));await fs.unlink(original);await fs.rename(original+'.retained',original);
 const controller=new (load('files/files').FilesController)(db);
 for(const method of ['customerRead','adminRead'])await assert.rejects(()=>controller[method](row.id,{customer:{id:'synthetic-customer'},admin:{role:'ADMIN'}},{}),e=>e.getStatus()===403&&e.getResponse().error.code==='ELECTRONIC_QUARANTINE_PRIVATE');
 const mode=load('offline-documents/mode');assert.throws(()=>mode.assertNewEsignAllowed());assert.throws(()=>mode.assertEnterpriseOnboardingAllowed());await assert.rejects(()=>mode.assertNewProviderOperation());assert.throws(()=>load('customers/identity-policy').requireProviderIdentity());
 const baseline=JSON.parse(await fs.readFile('/probe/public-baseline.json','utf8'));
 const {createApp}=load('app');const app=await createApp({db:{...db,$queryRaw:async()=>[], $disconnect:async()=>{}}});
 try{await app.listen(0,'127.0.0.1');const base=await app.getUrl();for(const entry of baseline.entries){const r=await fetch(base+entry.path);assert.equal(r.status,200);const body=await r.json();for(const [key,value] of Object.entries(entry.body))assert.deepEqual(body[key],value,key);if(entry.path.includes('signing-config')){assert.equal(body.newElectronicRequestsEnabled,false);assert.equal(body.electronicEnabled,false);}}
 const relative=path.relative(process.env.UPLOAD_DIR,row.storagePath).split(path.sep).map(encodeURIComponent).join('/');assert.equal(relative,`electronic-quarantine/${sha.slice(0,2)}/${sha}`);assert.ok((await fs.stat(row.storagePath)).isFile());
 for(const url of ['/uploads/'+relative,'/api/uploads/'+relative,'/api/'+relative]){const r=await fetch(base+url);assert.equal(r.status,404);assert.ok(!(await r.text()).startsWith('%PDF-'));}
 for(const url of ['/api/admin/files/'+row.id,'/api/customer/files/'+row.id])assert.equal((await fetch(base+url)).status,401);
 }finally{await app.close();}
 console.log(JSON.stringify({status:'PASS',uid:process.getuid(),platform:process.platform,arch:process.arch,pdfBytes:bytes.length,pdfSha256:sha,modes,hashedPath:true,symlinkEscapeRejected:true,controllerQuarantineDenied:true,publicApiStaticDenied:true,actualArtifactUrlSuffix:path.relative(process.env.UPLOAD_DIR,row.storagePath).split(path.sep).join('/'),ordinaryCapabilitiesMatchBaseline:true,ordinaryProviderOperationsRejected:true,network:'none',database:'none',providerCalls:0}));
})().catch(e=>{console.error(e);process.exitCode=1;});
