// Read the native request failure reason without altering app code, storage or domain checks.
const fs=require('node:fs');
const path=require('node:path');
const automator=require('../../../.runtime/miniapp-tools/node_modules/miniprogram-automator');
(async()=>{let mini;const report={recordedAt:new Date().toISOString(),scope:'Read-only wx.request GET to independent public health; no configuration/storage/session or business mutations.'};try{
  mini=await automator.connect({wsEndpoint:'ws://127.0.0.1:9420'});
  report.result=await mini.evaluate(async()=>await new Promise(resolve=>wx.request({url:'https://mini-api.subauto.keybox.cloud/api/health',method:'GET',timeout:10000,success:r=>resolve({statusCode:r.statusCode,status:r.data?.status||null}),fail:e=>resolve({errMsg:e.errMsg})})));
}catch(error){report.sdkError=error.message;process.exitCode=1;}finally{if(mini)await mini.disconnect();const out=path.resolve(__dirname,'../evidence/devtools/production-public');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'public-network.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}})();
