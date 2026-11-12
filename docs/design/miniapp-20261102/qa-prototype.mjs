import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const dir=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(dir,'../../..');
const out=path.join(root,'.runtime/design-20261102');
const require=createRequire(path.join(root,'apps/signing-h5/package.json'));
const {chromium}=require('@playwright/test');
const browser=await chromium.launch({channel:'chrome',headless:true});
const results={screens:[],interactions:[],consoleErrors:[],overflows:[]};
const kinds=['native','premium','city'];
await fs.mkdir(path.join(out,'screens'),{recursive:true});
try{
  const page=await browser.newPage({viewport:{width:780,height:1200},deviceScaleFactor:1});
  page.on('pageerror',e=>results.consoleErrors.push(e.message));
  await page.goto(pathToFileURL(path.join(out,'preview.html')).href);
  await page.frameLocator('iframe').locator('[data-direction="native"] .nd-app').waitFor();
  const frame=page.frames().find(f=>f!==page.mainFrame());
  assert(frame,'Preview iframe missing');
  await frame.locator('.nd-photo').first().evaluate(e=>e.decode());
  const choose=async k=>frame.evaluate(kind=>{for(const section of document.querySelectorAll('[data-variant]'))section.hidden=section.querySelector('[data-direction]').dataset.direction!==kind;},k);
  for(const width of [320,390,736]){
    await page.setViewportSize({width:width+24,height:1400});
    for(const k of kinds){
      await choose(k);
      const stage=frame.locator(`[data-direction="${k}"]`);
      for(const screen of ['catalog','bill','handover']){
        await stage.locator(`[data-mode="${screen}"]`).click();
        const overflow=await stage.locator('.nd-app').evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,height:el.getBoundingClientRect().height,clipped:[...el.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect(),p=el.getBoundingClientRect();return r.width>0&&(r.left<p.left-1||r.right>p.right+1)}).map(e=>e.className).slice(0,10)}));
        if(overflow.scroll>Math.ceil(overflow.width)+1||overflow.clipped.length)results.overflows.push({requestedWidth:width,k,screen,...overflow});
        results.screens.push({requestedWidth:width,k,screen,...overflow});
        if(width===390)await stage.locator('.nd-app').screenshot({path:path.join(out,'screens',`${k}-${screen}.png`)});
        if(screen==='handover')assert.equal(await stage.locator('input[type="checkbox"]').count(),0,`${k} completed handover has checkbox`);
      }
      if(width===390){
        await stage.locator('[data-mode="catalog"]').click();
        await stage.locator('[data-action="vehicle"]').click();
        await stage.locator('[data-action="plan"][data-value="1"]').click();
        assert.equal(await stage.locator('[data-action="plan"][data-value="1"]').getAttribute('aria-pressed'),'true');
        assert.match(await stage.locator('.nd-card').innerText(),/3,699/);
        await stage.locator('[data-action="application"]').click();
        assert.match(await stage.locator('[role="dialog"]').innerText(),/24个月订阅/);
        await stage.locator('.nd-modal-close').click();
        await stage.locator('.nd-app').screenshot({path:path.join(out,'screens',`${k}-plans.png`)});
        await stage.locator('[data-mode="handover"]').click();
        await stage.locator('[data-handover-state]').selectOption('confirmed');
        assert.equal(await stage.locator('input[type="checkbox"]').count(),0);
        assert.match(await stage.locator('.nd-main').innerText(),/等待平台/);
        await stage.locator('[data-handover-state]').selectOption('pending');
        assert(await stage.locator('[data-action="confirm"]').isDisabled());
        for(const ev of ['photo','checklist','terms']){
          await stage.locator(`[data-action="evidence"][data-value="${ev}"]`).click();
          assert(await stage.locator('[role="dialog"]').isVisible());
          await stage.locator('.nd-modal-close').click();
        }
        await stage.locator('[data-agree]').check();
        await stage.locator('[data-action="confirm"]').click();
        assert.equal(await stage.locator('[data-handover-state]').inputValue(),'confirmed');
        assert.equal(await stage.locator('input[type="checkbox"]').count(),0);
        await stage.locator('[data-handover-state]').selectOption('completed');
        await stage.locator('[data-action="use"]').click();
        await stage.locator('.nd-tabbar [data-action="mine"]').click();
        assert.match(await stage.locator('.nd-main').innerText(),/未进行线上实名认证/);
        await stage.locator('.nd-tabbar [data-action="catalog"]').click();
        if(k!=='premium'){
          await stage.locator('[data-action="filter"][data-value="suv"]').click();
          assert(await stage.getByText('暂无匹配车辆').isVisible());
          await stage.locator('[data-action="reset"]').click();
        }
        results.interactions.push({kind:k,plans:true,localDialog:true,readBeforeConfirm:true,confirmedReadOnly:true,completedReadOnly:true,manualReviewCopy:true,navigation:true});
      }
    }
  }
  await page.setViewportSize({width:1260,height:1450});
  await frame.addStyleTag({content:'.viz-carousel{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:16px!important}.viz-carousel>[data-variant]{display:block!important}.study-stage{padding:10px 0!important;min-height:0!important}.study-label,.study-attribution,.demo-controls,.state-control{display:none!important}.nd-app{box-shadow:none!important}.direction-heading{padding:12px 2px!important}'});
  for(const screen of ['catalog','bill','handover']){
    await frame.evaluate(()=>{for(const e of document.querySelectorAll('[data-variant]'))e.hidden=false;});
    for(const k of kinds)await frame.locator(`[data-direction="${k}"] [data-mode="${screen}"]`).dispatchEvent('click');
    await frame.locator('#ninda-style-study').screenshot({path:path.join(out,'screens',`comparison-${screen}.png`)});
  }
  results.passed=results.consoleErrors.length===0&&results.overflows.length===0&&results.interactions.length===3;
  await fs.writeFile(path.join(out,'qa-results.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify({passed:results.passed,screens:results.screens.length,interactions:results.interactions.length,errors:results.consoleErrors,overflows:results.overflows}));
  assert(results.passed,'Prototype checks failed');
}finally{await browser.close();}
