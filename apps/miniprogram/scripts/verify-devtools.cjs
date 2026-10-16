// Read-only native DevTools evidence. Never mock data, modify storage, or invoke a business mutation.
const fs = require('node:fs');
const path = require('node:path');
const automator = require('../../../.runtime/miniapp-tools/node_modules/miniprogram-automator');
const label = process.argv[2] || 'read-only';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid evidence label');
const out = path.resolve(__dirname, '../evidence/devtools', label);
const routes = [
  ['home','switchTab','/pages/home/index'],['catalog','switchTab','/pages/catalog/index'],
  ['use','switchTab','/pages/use/index'],['mine','switchTab','/pages/mine/index'],
  ['settings','navigateTo','/pages/settings/index'],['terms','navigateTo','/pages/legal/index?type=terms'],
  ['privacy','redirectTo','/pages/legal/index?type=privacy'],['application-legal','redirectTo','/pages/legal/index?type=application'],
  ['vehicle-no-id','redirectTo','/pages/vehicle/index'],['application-no-id','redirectTo','/pages/application/index'],
  ['application-detail-no-id','redirectTo','/pages/application-detail/index'],['profile-anonymous','redirectTo','/pages/profile/index'],
  ['records-anonymous','redirectTo','/pages/records/index?type=mileages'],['record-no-id','redirectTo','/pages/record/index?type=contracts'],
  ['service-anonymous','redirectTo','/pages/service/index'],['mileage-anonymous','redirectTo','/pages/mileage/index'],
  ['handover-anonymous','redirectTo','/pages/handover/index'],['sign-no-entry','redirectTo','/pages/sign/index'],
];
function bounded(work, ms=18000) { let timer; return Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('SDK operation timed out')),ms);})]).finally(()=>clearTimeout(timer)); }
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const report={recordedAt:new Date().toISOString(),scope:'Actual WeChat DevTools native rendering/navigation, read-only, no mocked responses/storage, no login/SMS/pay/sign or business writes. Screenshots are simulator evidence, not physical-device verification.',sdk:require('../../../.runtime/miniapp-tools/node_modules/miniprogram-automator/package.json').version,pages:[],exceptions:[],consoleErrors:[]};
  let mini;
  try{
    mini=await bounded(automator.connect({wsEndpoint:'ws://127.0.0.1:9420'}));
    mini.on('exception',event=>report.exceptions.push(JSON.parse(JSON.stringify(event))));
    mini.on('console',event=>{if(['error','warn'].includes(event.level||event.type))report.consoleErrors.push(event);});
    const info=await bounded(mini.systemInfo());report.system={platform:info.platform,system:info.system,model:info.model,SDKVersion:info.SDKVersion,version:info.version,windowWidth:info.windowWidth,windowHeight:info.windowHeight};
    for(const[name,method,url]of routes){
      const row={name,url};report.pages.push(row);
      try{
        const page=await bounded(mini[method](url));
        if(!page)throw new Error('SDK returned no current page');
        for(let check=0;check<8&&await bounded(page.data('loading'));check++)await page.waitFor(500);
        row.path=page.path;
        for(const field of ['loading','error','actionError','authenticated','submitted','busy']){const value=await bounded(page.data(field));if(value!==undefined)row[field]=value;}
        const root=await bounded(page.$('.page'));row.hasPageRoot=Boolean(root);
        row.screenshotRequested=name+'.png';await bounded(mini.screenshot({path:path.join(out,row.screenshotRequested)}));row.screenshot=row.screenshotRequested;
        console.log(JSON.stringify({page:name,path:row.path,error:row.error||row.actionError||'',hasPageRoot:row.hasPageRoot}));
      }catch(error){if(row.hasPageRoot&&row.screenshotRequested)row.screenshotError=error.message;else row.sdkError=error.message;console.log(JSON.stringify({page:name,sdkError:error.message}));}
      fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
    }
    await bounded(mini.switchTab('/pages/home/index'));
  }catch(error){report.connectionError=error.message;console.error(error.message);process.exitCode=1;}
  finally{
    if(mini)await bounded(mini.disconnect()).catch(()=>{});
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({pages:report.pages.length,sdkErrors:report.pages.filter(row=>row.sdkError).length,exceptions:report.exceptions.length,consoleErrors:report.consoleErrors.length,report:path.join(out,'report.json')}));
  }
})();
