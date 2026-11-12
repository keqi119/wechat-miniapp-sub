import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,statSync} from 'node:fs';
import {resolve,relative,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const root=resolve(import.meta.dirname,'../../..');
const require=createRequire(resolve(root,'apps/admin/package.json'));
const {chromium,expect}=require('@playwright/test');
const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,array)=>index%2?pairs:[...pairs,[value.replace(/^--/,''),array[index+1]]],[]));
assert(args.dist,'Required: --dist DIRECTORY; optional --out DIRECTORY --stage red|green|check --expected-api-base URL');
args.stage??='check';args.out??='.runtime/admin-api-origin-check';assert(['red','green','check'].includes(args.stage),'Invalid stage');
const dist=resolve(root,args.dist),out=resolve(root,args.out);
assert(out.startsWith(root+sep),'Evidence must remain in the project');
mkdirSync(out,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=[];
function walk(directory){for(const name of readdirSync(directory)){const path=resolve(directory,name);if(statSync(path).isDirectory())walk(path);else files.push({path:relative(dist,path).replaceAll('\\','/'),sha256:sha(readFileSync(path))});}}
walk(dist);for(const name of ['index.html','field.html'])assert(files.some(file=>file.path===name),name+' missing');
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),path=resolve(dist,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
 if(req.method!=='GET'||!path.startsWith(dist+sep)){res.writeHead(404);res.end();return;}
 try{const content=readFileSync(path);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream');res.end(content);}catch{res.writeHead(404);res.end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
const expectedBase=args['expected-api-base']||'https://api.evsub.ndacar.com/api',results=[];
assert(/^https?:\/\//.test(expectedBase),'Expected API base must be absolute');
let browser;
const message='合成路由回归：未向生产提交凭据';
try{
 try{browser=await chromium.launch({headless:true});}catch(error){if(!String(error.message).includes("Executable doesn't exist"))throw error;browser=await chromium.launch({channel:'chrome',headless:true});}
 for(const entry of [{name:'admin',path:'/index.html',username:'工作账号',password:'登录密码',submit:'进入工作台',viewport:{width:1440,height:1000}},{name:'field',path:'/field.html',username:'现场账号',password:'密码',submit:'进入我的任务',viewport:{width:390,height:844}}]){
  const context=await browser.newContext({viewport:entry.viewport,serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(10000);
  const requests=[],pageErrors=[],blockedRequests=[],servedAssets=[],checks=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  const check=(name,passed,details)=>checks.push({name,passed,...(details?{details}:{})});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url()),headers={'access-control-allow-origin':origin,'access-control-allow-credentials':'true','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Content-Type,Accept,X-CSRF-Token'};
   if(url.pathname.endsWith('/admin/auth/me')||url.pathname.endsWith('/admin/auth/login')){
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    const login=url.pathname.endsWith('/login');let syntheticPayload=true;
    if(login){try{const payload=request.postDataJSON();syntheticPayload=payload.username==='synthetic-route-check'&&payload.password==='synthetic-route-password-not-a-real-secret'&&Object.keys(payload).sort().join(',')==='password,username';}catch{syntheticPayload=false;}}
    requests.push({kind:login?'login':'me',method:request.method(),url:url.href,syntheticPayload});
    return route.fulfill({status:login?400:401,headers,json:{error:{code:login?'SYNTHETIC_LOGIN_BLOCKED':'UNAUTHENTICATED',message:login?message:'合成未登录'}}});
   }
   if(url.origin===origin&&request.method()==='GET'&&(url.pathname===entry.path||url.pathname.startsWith('/assets/'))){servedAssets.push(url.pathname);return route.continue();}
   blockedRequests.push({method:request.method(),url:url.href});return route.abort('blockedbyclient');
  });
  try{
   await page.goto(origin+entry.path);
   await page.getByLabel(entry.username,{exact:true}).fill('synthetic-route-check');
   await page.getByLabel(entry.password,{exact:true}).fill('synthetic-route-password-not-a-real-secret');
   await page.getByRole('button',{name:entry.submit,exact:true}).click();
   await expect(page.getByText(message,{exact:true})).toBeVisible();
   const me=requests.filter(r=>r.kind==='me'),login=requests.filter(r=>r.kind==='login');
   check('auth/me targets absolute production API',me.length>0&&me.every(r=>r.method==='GET'&&r.url===expectedBase+'/admin/auth/me'),me.map(r=>r.url));
   check('login targets absolute production API',login.length===1&&login[0].method==='POST'&&login[0].url===expectedBase+'/admin/auth/login',login.map(r=>r.url));
   check('login is intercepted with synthetic credentials only',login.length===1&&login.every(r=>r.syntheticPayload));
   check('built entry executes without runtime error or unhandled external requests',pageErrors.length===0&&blockedRequests.length===0&&servedAssets.some(path=>path.endsWith('.js')),{pageErrors,blockedRequests});
   await page.screenshot({path:resolve(out,entry.name+'.png'),fullPage:true});
  }catch(error){check('entry browser execution',false,String(error.message));await page.screenshot({path:resolve(out,entry.name+'-failure.png'),fullPage:true}).catch(()=>{});}
  finally{await context.close();}
  results.push({entry:entry.name,requests,servedAssets:[...new Set(servedAssets)],checks});
 }
}finally{await browser?.close();await new Promise(done=>server.close(done));}
const checks=results.flatMap(result=>result.checks),report={stage:args.stage,generatedAt:new Date().toISOString(),dist,expectedBase,source:'Real existing bundled index.html/field.html and their original assets; no source rebundling.',network:'All auth calls fulfilled locally; all non-asset requests blocked. No production credentials or customer data used.',artifactFiles:files,checks:checks.length,passed:checks.filter(check=>check.passed).length,failed:checks.filter(check=>!check.passed).length,results};
writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({stage:report.stage,checks:report.checks,passed:report.passed,failed:report.failed,report:resolve(out,'report.json')}));
process.exitCode=report.failed?1:0;
