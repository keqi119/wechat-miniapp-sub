// Production public read-only acceptance with real native requests; preserves prior evidence.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const automator=require('../../../.runtime/miniapp-tools/node_modules/miniprogram-automator');
const label=process.argv[2]||'after-domain-config';
if(!/^[a-z0-9-]+$/.test(label))throw new Error('Invalid evidence directory');
const out=path.resolve(__dirname,'../evidence/devtools',label);
if(fs.existsSync(path.join(out,'report.json')))throw new Error('Keep existing evidence; select a new directory before rerunning.');
const report={recordedAt:new Date().toISOString(),scope:'Production public native wx.request and DevTools page rendering only. No mocks, login, SMS, storage writes, customer business writes, payments, identity verification or signing.',requests:[],pages:[],exceptions:[]};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
function bounded(work,ms=18000){let timer;return Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('SDK operation timed out')),ms);})]).finally(()=>clearTimeout(timer));}
(async()=>{let mini;fs.mkdirSync(out,{recursive:true});try{
  const project=path.resolve(__dirname,'../.artifacts/production');
  const config=JSON.parse(fs.readFileSync(path.join(project,'project.config.json'),'utf8'));
  const privateFile=path.join(project,'project.private.config.json');
  const privateConfig=fs.existsSync(privateFile)?JSON.parse(fs.readFileSync(privateFile,'utf8')):{};
  report.domainCheck={projectUrlCheck:config.setting?.urlCheck,privateUrlCheck:privateConfig.setting?.urlCheck??null,effectiveUrlCheck:privateConfig.setting?.urlCheck??config.setting?.urlCheck};
  if(report.domainCheck.effectiveUrlCheck!==true)throw new Error('urlCheck must stay enabled');
  mini=await bounded(automator.connect({wsEndpoint:'ws://127.0.0.1:9420'}));mini.on('exception',event=>report.exceptions.push(event));
  for(const endpoint of ['/health','/public/vehicles',...['terms','privacy','application','subscription','handover'].map(type=>'/public/legal/'+type)]){
    const response=await bounded(mini.evaluate(async url=>await new Promise(resolve=>wx.request({url,method:'GET',timeout:10000,success:r=>resolve({statusCode:r.statusCode,data:r.data}),fail:e=>resolve({errMsg:e.errMsg})})),'https://mini-api.subauto.keybox.cloud/api'+endpoint));
    const row={endpoint,statusCode:response.statusCode,errMsg:response.errMsg};
    if(endpoint==='/health')row.status=response.data?.status;
    else if(endpoint==='/public/vehicles'){row.items=response.data?.items?.length;row.total=response.data?.total;row.emptyInventoryExpected=row.items===0&&row.total===0;}
    else{const doc=response.data||{};row.document={id:doc.id,type:doc.type,title:doc.title,version:doc.version,status:doc.status,contentLength:typeof doc.content==='string'?doc.content.length:0,contentSha256:typeof doc.content==='string'?crypto.createHash('sha256').update(doc.content).digest('hex'):null};}
    report.requests.push(row);save();console.log(JSON.stringify(row));
  }
  // A freshly reopened IDE can run App requests before it has a page metadata entry.
  await bounded(mini.callWxMethod('reLaunch',{url:'/pages/home/index'}));
  await new Promise(resolve=>setTimeout(resolve,3000));
  for(const[name,method,url]of[['home','switchTab','/pages/home/index'],['catalog','switchTab','/pages/catalog/index'],['terms','navigateTo','/pages/legal/index?type=terms'],['privacy','redirectTo','/pages/legal/index?type=privacy'],['application','redirectTo','/pages/legal/index?type=application']]){
    const page=await bounded(mini[method](url));for(let check=0;check<12&&await page.data('loading');check++)await page.waitFor(500);
    const row={name,path:page.path,loading:await page.data('loading'),error:await page.data('error'),hasPageRoot:Boolean(await page.$('.page'))};
    if(['terms','privacy','application'].includes(name)){row.version=await page.data('version');row.title=await page.data('title');const sections=await page.data('sections');row.contentLength=sections?.[0]?.text?.length||0;}
    if(name==='catalog')row.items=(await page.data('items'))?.length;
    if(name==='home')row.vehicles=(await page.data('vehicles'))?.length;
    for(let attempt=1;attempt<=2;attempt++){try{await bounded(mini.screenshot({path:path.join(out,name+'.png')}));row.screenshot=name+'.png';break;}catch(error){(row.screenshotErrors??=[]).push(error.message);}}
    report.pages.push(row);save();console.log(JSON.stringify(row));
  }
  await bounded(mini.switchTab('/pages/home/index'));
}catch(error){report.sdkError=error.message;console.error(error.message);process.exitCode=1;}finally{if(mini)await bounded(mini.disconnect()).catch(()=>{});report.summary={requests:report.requests.length,successfulRequests:report.requests.filter(row=>row.statusCode===200).length,nativePages:report.pages.length,pageErrors:report.pages.filter(row=>row.error||row.loading||!row.hasPageRoot).length,exceptions:report.exceptions.length,screenshots:report.pages.filter(row=>row.screenshot).length};save();console.log(JSON.stringify(report.summary));if(report.summary.successfulRequests!==7||report.summary.pageErrors||report.summary.exceptions)process.exitCode=1;}})();
