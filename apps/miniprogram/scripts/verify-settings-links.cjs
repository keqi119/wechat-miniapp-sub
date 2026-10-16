// Actual DevTools read-only navigation proof for the requested account UI adjustment.
const fs=require('node:fs'),path=require('node:path');
const automator=require('../../../.runtime/miniapp-tools/node_modules/miniprogram-automator');
const out=path.resolve(__dirname,'../evidence/devtools/settings-legal-links');
if(fs.existsSync(path.join(out,'report.json')))throw new Error('Preserve prior evidence before rerun');
const report={recordedAt:new Date().toISOString(),scope:'Actual native account agreement links, public legal reads/navigation/screenshots only; no login, SMS, consent submission or business mutation.',links:[],exceptions:[]};
function bounded(work,ms=18000){let timer;return Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('SDK operation timed out')),ms);})]).finally(()=>clearTimeout(timer));}
(async()=>{let mini;fs.mkdirSync(out,{recursive:true});try{
  mini=await bounded(automator.connect({wsEndpoint:'ws://127.0.0.1:9420'}));mini.on('exception',event=>report.exceptions.push(event));
  let page=await bounded(mini.navigateTo('/pages/settings/index'));await page.waitFor(500);
  report.settings={path:page.path,error:await page.data('error'),authenticated:await page.data('authenticated'),accepted:await page.data('accepted'),legalDocumentVersions:(await page.data('legalDocuments')).map(doc=>({type:doc.type,title:doc.title,version:doc.version}))};
  const links=await page.$$('.text-button');if(links.length!==2)throw new Error('Expected exactly two compiled agreement links; current page may not have refreshed');
  if(!report.settings.authenticated)await bounded(mini.screenshot({path:path.join(out,'settings-top.png')}));
  for(let index=0;index<2;index++){
    const currentLinks=await page.$$('.text-button'),element=currentLinks[index];
    const row={type:await element.attribute('data-type'),text:await element.text()};report.links.push(row);
    const offset=await element.offset();row.linkOffset=offset;
    await mini.pageScrollTo(Math.max(0,Number(offset.top??offset.y??0)-120));
    if(index===0)await bounded(mini.screenshot({path:path.join(out,'settings-links.png')}));
    await element.tap();await page.waitFor(500);const legal=await mini.currentPage();
    row.destination=legal.path;row.query=legal.query;row.title=await legal.data('title');row.version=await legal.data('version');row.error=await legal.data('error');row.contentLength=(await legal.data('sections'))?.[0]?.text?.length||0;
    await bounded(mini.screenshot({path:path.join(out,row.type+'.png')}));
    page=await mini.navigateBack();await page.waitFor(500);
  }
  report.settings.acceptedAfterNavigation=await page.data('accepted');
  await bounded(mini.switchTab('/pages/home/index'));
}catch(error){report.sdkError=error.message;console.error(error.message);process.exitCode=1;}finally{if(mini)await bounded(mini.disconnect()).catch(()=>{});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(report.links.length!==2||report.links.some(row=>row.error||row.destination!=='pages/legal/index'||row.query?.type!==row.type||!row.contentLength)||report.exceptions.length)process.exitCode=1;}})();
