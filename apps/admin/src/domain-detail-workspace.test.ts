import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium, expect, type Browser} from '@playwright/test';

// Render the real components with synthetic local HTTP responses. No production
// endpoint, account, or business write is used by this interaction regression.
test('module drawers share vehicle detail navigation and preserve version-bound commands', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const result = await build({configFile: false, root, logLevel: 'silent',
    define: {'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api')},
    plugins: [{name: 'drawer-fixture', resolveId: id => id === 'virtual:drawer-fixture' ? id : undefined,
      load: id => id === 'virtual:drawer-fixture' ? `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import {api} from '/src/core'; import {ProductsPage} from '/src/products';
        import {PartnersPage} from '/src/partners'; import {InsurancePage} from '/src/insurance';
        import {Drawer,DetailWorkspace} from '/src/ui';
        import '/src/style.css'; import '/src/ninda-brand.css'; import '/src/seven-module.css'; import '/src/domain-ui.css';
        const params=new URLSearchParams(location.search), readonly=params.has('readonly');
        api.setSession({user:{id:'operator',username:'synthetic',role:readonly?'SUPPORT':'OPERATIONS',partnerCapabilities:readonly?[]:['partner.cooperation.read','partner.cooperation.write'],permissions:readonly?[]:['*']},csrfToken:'local-test'});
        const kind=params.get('kind');
        function Fixture(){const[hash,setHash]=React.useState(location.hash);React.useEffect(()=>{const update=()=>setHash(location.hash);addEventListener('hashchange',update);addEventListener('process-location',update);return()=>{removeEventListener('hashchange',update);removeEventListener('process-location',update);};},[]);const content=kind==='vehicle'?React.createElement(Drawer,{title:'车辆详情',onClose:()=>{}},React.createElement(DetailWorkspace,{entity:{id:'vehicle',title:'本地验收车辆',year:2024},status:'DRAFT',resource:'vehicles',actions:React.createElement('button',{className:'button'},'编辑资料'),onRefresh:()=>{}})):kind==='partner'?React.createElement(PartnersPage,{view:'partners'}):kind==='insurance'?React.createElement(InsurancePage):React.createElement(ProductsPage,{warehouse:hash.split('?')[0]==='#product-warehouse'});return content;}
        createRoot(document.getElementById('root')).render(React.createElement(Fixture));
      ` : undefined}],
    build: {write: false, minify: false, rolldownOptions: {input:'virtual:drawer-fixture'}}});
  const output = (Array.isArray(result) ? result[0] : result) as {output: {type: string; fileName: string; code?: string; source?: string | Uint8Array}[]};
  const assets = new Map(output.output.map(item => ['/' + item.fileName, item]));
  const script = output.output.find(item => item.type === 'chunk')!.fileName;
  const styles = output.output.filter(item => item.fileName.endsWith('.css')).map(item => `<link rel="stylesheet" href="/${item.fileName}">`).join('');
  const server = createServer((request, response) => {
    const asset = assets.get(new URL(request.url!, 'http://localhost').pathname);
    response.setHeader('Content-Type', asset ? asset.fileName.endsWith('.css') ? 'text/css' : 'text/javascript' : 'text/html');
    response.end(asset ? asset.code || asset.source : `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body><div id="root"></div><script type="module" src="/${script}"></script></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as {port: number};
  const origin = `http://127.0.0.1:${address.port}`;
  let browser: Browser | undefined;
  try {
    try {browser=await chromium.launch({headless:true});}
    catch(error){if(!(error instanceof Error)||!error.message.includes("Executable doesn't exist"))throw error;browser=await chromium.launch({channel:'chrome',headless:true});}
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    const qaDirectory=process.env.NINDA_DRAWER_QA_DIR;
    if(qaDirectory)await mkdir(qaDirectory,{recursive:true});
    const screenshot=async(name:string)=>{if(qaDirectory)await page.screenshot({path:join(qaDirectory,name+'.png')});};
    const errors: string[] = [], writes: {path: string; body: any}[] = [];
    let newVersionAttempts=0,detailFailuresRemaining=0;
    page.on('pageerror', error => errors.push(error.message));
    const product = {id:'product-1',revision:7,versions:[{id:'version-3',version:3,revision:4,status:'DRAFT',configurationVersion:2,baseFeeAmount:300000,mileageMonthlyFeeAmount:99900,mileagePerMonthKm:2300,excessMileagePriceAmount:125,swapPolicy:{version:2,period:'TERM',includedCount:0,extraFeeAmount:62000},name:'本地验收产品',months:12,monthlyFeeAmount:399900,energyDescription:'包含电池租金',conditions:'适用约定',vehicleIds:['vehicle-1'],modelDefinitionIds:[],items:[]},{id:'version-2',version:2,revision:6,status:'PUBLISHED',name:'历史版',months:12,monthlyFeeAmount:389900}]};
    const otherProduct={...product,id:'product-2',revision:11,versions:[{...product.versions[0],id:'other-version',name:'另一本地产品'}]};
    const partner = {id:'partner-1',name:'本地验收企业',subjectType:'ENTERPRISE',revision:2,admissionStatus:'DRAFT',identities:[],vehicles:[],vehicleProposals:[],address:'本地测试地址'};
    const policy = {id:'policy-1',revision:5,insurer:'本地验收保险机构',policyNumber:'LOCAL-POLICY',files:[],versions:[{id:'policy-version',version:1,revision:2,status:'DRAFT',vehicleIds:['vehicle-1'],fileIds:[],requirementVersionIds:[],coverageItems:[]}]};
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, origin, 'The fixture must not contact external services');
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const path = url.pathname.slice(4);
      if (request.method() !== 'GET') {writes.push({path, body:request.postDataJSON()});if(path==='/admin/products/product-1/versions'&&newVersionAttempts++===0)return route.fulfill({status:503,json:{error:{message:'本地模拟结果未知，请重试'}}});return route.fulfill({json:{id:'saved'}});}
      if(path==='/admin/products/product-1'&&detailFailuresRemaining>0){detailFailuresRemaining--;return route.fulfill({status:503,json:{error:{message:'本地模拟详情刷新失败'}}});}
      if(path==='/admin/vehicles/vehicle/documents')return route.fulfill({json:{revision:0,vehicleRevision:0,items:[]}});
      const item = path.startsWith('/admin/products') ? path.endsWith('/product-2')?otherProduct:product : path.startsWith('/admin/partners') ? partner : path.startsWith('/admin/insurance-policies') ? policy : undefined;
      return route.fulfill({json:item ? path.endsWith('/'+item.id) ? item : path==='/admin/products'?{items:[product,otherProduct],total:2}:{items:[item],total:1} : {items:[],total:0}});
    });
    await page.goto(origin+'/?kind=product#product-warehouse?record=product-1');
    const dialog = page.locator('.record-workspace-shell'), bar = dialog.getByRole('region', {name:'当前状态与操作'});
    await expect(dialog.getByRole('region',{name:'产品版本进度'})).toBeVisible();
    await expect(dialog.getByRole('tab',{name:'处理概览'})).toHaveAttribute('aria-selected','true');
    await expect(dialog.getByRole('tabpanel',{name:'处理概览'})).toContainText('本地验收产品');
    await screenshot('product-overview-desktop-local-synthetic');
    await dialog.getByRole('tab',{name:'详细资料'}).click();
    const current = dialog.locator('.domain-version').filter({has:page.getByRole('heading',{name:/第 3 版/})}).first();
    await expect(current.getByRole('link',{name:'编辑草稿',exact:true})).toBeVisible();
    await current.getByRole('button',{name:'发布产品',exact:true}).click();
    await current.getByRole('button',{name:'确认发布产品',exact:true}).click();
    await expect.poll(()=>writes.length).toBe(1);
    assert.equal(writes[0].path,'/admin/products/product-1/publish');
    assert.equal(writes[0].body.versionId,'version-3');
    assert.equal(writes[0].body.revision,4);
    assert.ok(writes[0].body.idempotencyKey);
    await screenshot('product-version-actions-desktop-local-synthetic');
    await dialog.getByRole('link',{name:'新增版本',exact:true}).click();
    const form=page.locator('.product-workbench-form');
    await expect(page.getByRole('heading',{name:'建立产品新版本',exact:true})).toBeVisible();
    await expect(form.getByRole('textbox',{name:'产品名称',exact:true})).toHaveValue('本地验收产品');
    assert.equal(await page.locator('.record-workspace-shell').count(),0,'The long product form is a separate workbench page');
    await form.getByRole('textbox',{name:'产品名称',exact:true}).fill('保留中的输入');
    await screenshot('product-new-version-desktop-local-synthetic');
    detailFailuresRemaining=1;
    await page.getByRole('button',{name:'刷新产品资料',exact:true}).click();
    await expect(page.getByRole('alert').filter({hasText:'本地模拟详情刷新失败'})).toBeVisible();
    await expect(form.getByRole('textbox',{name:'产品名称',exact:true})).toHaveValue('保留中的输入');
    await expect(form.getByRole('button',{name:'保存草稿',exact:true})).toBeDisabled();
    await screenshot('product-refresh-failure-desktop-local-synthetic');
    await page.getByRole('button',{name:'重新连接'}).click();
    await expect(form.getByRole('button',{name:'保存草稿',exact:true})).toBeEnabled();
    await form.getByRole('button',{name:'保存草稿',exact:true}).click();
    await expect(form.getByRole('alert')).toContainText('本地模拟结果未知');
    await expect(form.getByRole('textbox',{name:'产品名称',exact:true})).toBeDisabled();
    detailFailuresRemaining=1;
    await form.getByRole('button',{name:'按原配置重试',exact:true}).click();
    await expect(form.getByText('保存已返回成功，仅核对读取结果，不重复提交。',{exact:true})).toBeVisible();
    await form.getByRole('button',{name:'重新读取草稿结果',exact:true}).click();
    await expect(dialog).toBeVisible();
    assert.equal(writes.length,3);
    assert.deepEqual(writes[1],writes[2],'Unknown retry keeps the exact draft, key and parent revision; committed recovery only reads');
    assert.equal(writes[2].body.baseFeeAmount+writes[2].body.mileageMonthlyFeeAmount,399900);
    assert.equal(writes[2].body.monthlyFeeAmount,undefined);
    assert.equal(writes[2].body.revision,7);
    await dialog.getByRole('tab',{name:'详细资料'}).click();
    await dialog.getByRole('combobox',{name:'查看版本'}).selectOption('version-2');
    const historical=dialog.locator('.domain-version').filter({has:page.getByRole('heading',{name:/第 2 版/})}).first();
    await historical.getByRole('button',{name:'停用版本',exact:true}).click();
    await historical.getByRole('textbox',{name:'核对说明',exact:true}).fill('仅本地回归的历史版本上下文');
    await historical.getByRole('button',{name:'确认停用版本',exact:true}).click();
    await expect.poll(()=>writes.length).toBe(4);
    assert.equal(writes[3].path,'/admin/products/product-1/versions/version-2/suspend');
    assert.equal(writes[3].body.revision,6);
    await dialog.getByRole('link',{name:'新增版本',exact:true}).click();
    await form.getByRole('textbox',{name:'产品名称',exact:true}).fill('关闭后应丢弃的输入');
    await form.getByRole('link',{name:'取消并返回仓库',exact:true}).click();
    await dialog.getByRole('button',{name:'返回列表',exact:true}).click();
    await page.getByRole('row').filter({hasText:'另一本地产品'}).getByRole('button',{name:'查看版本'}).click();
    await dialog.getByRole('link',{name:'新增版本',exact:true}).click();
    await expect(form.getByRole('textbox',{name:'产品名称',exact:true})).toHaveValue('另一本地产品');
    assert.equal(writes.length,4,'Opening, navigating and cancelling the unsaved workbench must not submit');
    for (const [kind,record,action] of [['partner','partner-1','更新主体资料']]) {
      await page.goto(`${origin}/?kind=${kind}#${kind==='partner'?'partners':kind}?record=${record}`);
      await expect(page.getByRole('region',{name:'当前状态与操作'}).getByRole('button',{name:action,exact:true})).toBeVisible();
      await expect(page.getByRole('tab',{name:'详细资料'})).toBeVisible();
      await screenshot(kind+'-overview-desktop-local-synthetic');
    }
    await page.goto(origin+'/?kind=insurance#insurance?record=policy-1');
    await expect(page.getByRole('heading',{name:'基本保险信息 未核验',exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{name:'保单文件与批单',exact:true})).toBeVisible();
    await screenshot('insurance-overview-desktop-local-synthetic');
    await page.getByRole('button',{name:'修改保险信息',exact:true}).click();
    await expect(page.locator('.insurance-registration').getByLabel('保单号',{exact:true})).toHaveValue('LOCAL-POLICY');
    await page.locator('.insurance-registration').getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(writes.length,4,'Opening the independent insurance editor must not save a registration');
    await page.goto(origin+'/?readonly#products?record=product-1&view=edit&versionId=version-3');
    await expect(page.getByText('当前账号无权登记或修改产品。',{exact:true})).toBeVisible();
    await expect(page.locator('.product-workbench-form')).toHaveCount(0);
    assert.equal(writes.length,4,'A disallowed role cannot open or save a product editor');
    await page.goto(origin+'/?kind=vehicle');
    const vehicleWorkspace=page.getByRole('region',{name:'车辆工作台',exact:true});
    await expect(vehicleWorkspace.getByRole('button',{name:'编辑资料',exact:true})).toBeVisible();
    await expect(vehicleWorkspace.getByRole('tab')).toHaveText(['车辆概览','权证资料','车辆照片','车况查验','保险信息','电池 BaaS','商品展示','估值与折旧','资本与分润','待分类资料']);
    await expect(vehicleWorkspace.locator('[data-vehicle-workspace-header] .vehicle-workspace-label')).toHaveText(['车辆','当前车牌','车辆状态']);
    await expect(vehicleWorkspace.locator('[data-vehicle-workspace-header]')).toContainText('本地验收车辆');
    await expect(page.getByRole('region',{name:'车辆概览内容',exact:true}).getByRole('definition').filter({hasText:/^2024$/})).toBeVisible();
    await screenshot('vehicle-baseline-desktop-local-synthetic');
    const overviewTab=vehicleWorkspace.getByRole('tab',{name:'车辆概览',exact:true});
    await overviewTab.focus();await page.keyboard.press('ArrowRight');
    const documentsTab=vehicleWorkspace.getByRole('tab').nth(1);
    await expect(documentsTab).toBeFocused();await page.keyboard.press('Enter');
    await expect(documentsTab).toHaveAttribute('aria-selected','true');
    const documents=page.getByRole('region',{name:'权证资料内容',exact:true});await expect(documents.locator('[data-document-category]')).toHaveCount(4);
    for(const category of ['登记证','行驶证','采购合同','发票'])await expect(documents.getByRole('button',{name:'选择'+category+'资料',exact:true})).toBeVisible();
    await expect(documents.getByText('暂无资料',{exact:true})).toHaveCount(4);
    await page.setViewportSize({width:390,height:844});
    await page.goto(origin+'/#product-warehouse?record=product-1');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('region',{name:'产品版本进度'})).toBeVisible();
    await screenshot('product-overview-mobile-local-synthetic');
    await dialog.getByRole('tab',{name:'详细资料'}).click();
    await dialog.getByRole('link',{name:'新增版本',exact:true}).click();
    await expect(form.getByRole('textbox',{name:'产品名称',exact:true})).toBeVisible();
    await screenshot('product-new-version-mobile-local-synthetic');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await form.getByRole('link',{name:'取消并返回仓库',exact:true}).click();
    await dialog.getByRole('tab',{name:'详细资料'}).click();
    await expect(dialog.getByRole('combobox',{name:'查看版本'})).toBeVisible();
    await screenshot('product-version-actions-mobile-local-synthetic');
    assert.deepEqual(errors,[]);
    if(qaDirectory)await writeFile(join(qaDirectory,'local-browser-result.json'),JSON.stringify({source:'synthetic data in isolated local HTTP fixture; not production acceptance',viewports:[{width:1440,height:1000},{width:390,height:844}],passed:true,errors,syntheticWriteRequests:writes.map(w=>({path:w.path,revision:w.body.revision})),externalRequests:0},null,2));
  } finally {await browser?.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
