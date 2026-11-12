import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
const env=parseEnv(readFileSync('.runtime/ninda/production/.env.production','utf8'));
assert.equal(env.ADMIN_ORIGIN,'https://admin.evsub.ndacar.com');assert.equal(env.PLATFORM_API_ORIGIN,'https://api.evsub.ndacar.com');
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
page.setDefaultTimeout(25000);const forbidden=[],errors=[];let loggedIn=false;
await context.route('**/*',route=>{
 const req=route.request(),url=new URL(req.url());
 if(![env.ADMIN_ORIGIN,env.PLATFORM_API_ORIGIN].includes(url.origin)){forbidden.push('external-origin');return route.abort();}
 if(!['GET','HEAD','OPTIONS'].includes(req.method())&&!['/api/admin/auth/login','/api/admin/auth/logout'].includes(url.pathname)){forbidden.push('business-write');return route.abort();}
 if(url.pathname.includes('/customer-profile/files/')){forbidden.push('private-document-read');return route.abort();}
 return route.continue();
});page.on('pageerror',()=>errors.push('page-error'));
try{
 await page.goto(env.ADMIN_ORIGIN+'/#applications?record=cmvs5a43h001dp301ns4y9gvx');
 await page.getByLabel('工作账号',{exact:true}).fill(env.BOOTSTRAP_ADMIN_USERNAME);
 await page.getByLabel('登录密码',{exact:true}).fill(env.BOOTSTRAP_ADMIN_PASSWORD);
 await page.getByRole('button',{name:'进入工作台',exact:true}).click();loggedIn=true;
 const flow=page.getByRole('region',{name:'申请办理进度'});
 await expect(flow).toContainText('资格资料已提交');await expect(flow).toContainText('第 2 版候选');
 await expect(page.getByRole('region',{name:'当前阻断事项'})).toContainText('身份与驾驶资格');
 await page.getByRole('region',{name:'下一步操作'}).getByRole('button').click();
 await expect(page.getByRole('tab',{name:'客户资料',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('button',{name:'沿用已上传证件提交资格资料',exact:true}).click();
 await expect(page.getByLabel('身份证有效期至',{exact:true})).toHaveAttribute('type','date');
 await expect(page.getByLabel('驾驶证有效期至',{exact:true})).toHaveAttribute('type','date');
 await page.getByLabel('身份证有效期类型',{exact:true}).selectOption('long-term');
 await page.getByLabel('驾驶证有效期类型',{exact:true}).selectOption('long-term');
 assert.equal(await page.getByLabel('身份证有效期至',{exact:true}).count(),0);assert.equal(await page.getByLabel('驾驶证有效期至',{exact:true}).count(),0);
 await page.getByRole('button',{name:'取消',exact:true}).click();
 assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[]);
 const report={checkedAt:new Date().toISOString(),release:'20261029-application-flow-v1',realBrowser:true,checks:['current real qualification blocker','candidate revision 2 retained','next action opens customer profile','two inputs type=date','independent long-term selectors hide dates'],businessWrites:0,privateDocumentReads:0,savedChanges:0};
 writeFileSync('.runtime/ninda/application-flow-20261029/production-browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({ok:false,stage:'production-browser',details:'withheld',forbidden,errors}));process.exitCode=1;}
finally{if(loggedIn){await page.keyboard.press('Escape').catch(()=>{});await page.getByRole('button',{name:'退出登录',exact:true}).click({force:true}).catch(()=>{});}await context.close();await browser.close();}
