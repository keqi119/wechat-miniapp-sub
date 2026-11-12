import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium, expect, type Browser } from '@playwright/test';

const adminRoot = fileURLToPath(new URL('..', import.meta.url));

test('leaving the goods workspace during a pending publication must stop later vehicles', async () => {
  const entry = `import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {GoodsPage} from '/src/goods';
    import {api} from '/src/core';
    api.setSession({user:{id:'synthetic-operator',username:'synthetic',role:'OPERATIONS',permissions:['*']},csrfToken:'synthetic-csrf'});
    function Fixture(){
      const[away,setAway]=React.useState(window.location.hash==='#away');
      React.useEffect(()=>{const read=()=>setAway(window.location.hash==='#away');window.addEventListener('hashchange',read);return()=>window.removeEventListener('hashchange',read)},[]);
      return away?React.createElement('p',null,'已离开商品中心'):React.createElement(GoodsPage);
    }
    createRoot(document.getElementById('root')).render(React.createElement(Fixture));`;
  const built = await build({
    configFile: false,
    root: adminRoot,
    envDir: false,
    logLevel: 'silent',
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') },
    plugins: [{
      name: 'review-goods-unmount',
      resolveId: id => id === 'virtual:review-goods-unmount' ? id : undefined,
      load: id => id === 'virtual:review-goods-unmount' ? entry : undefined,
    }],
    build: { write: false, minify: false, rolldownOptions: { input: 'virtual:review-goods-unmount' } },
  });
  const output = ((Array.isArray(built) ? built[0] : built) as {output: {type:string;fileName:string;code?:string;source?:string|Uint8Array}[]}).output;
  const assets = new Map(output.map(asset => ['/' + asset.fileName, asset]));
  const html = `<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/${output.find(asset => asset.type === 'chunk')!.fileName}"></script>`;
  const server = createServer((request, response) => {
    const asset = assets.get(new URL(request.url!, 'http://localhost').pathname);
    response.setHeader('Content-Type', asset ? 'text/javascript' : 'text/html');
    response.end(asset ? asset.code || asset.source : html);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  let browser: Browser | undefined;
  let releaseFirst: () => void = () => {};
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const cars = ['a', 'b'].map(id => ({
    id, title: `合成车辆${id}`, plateNumber: id === 'a' ? '甲' : '乙', vin: `SYNTHETIC-${id}`, modelDefinitionId: 'model',
  }));
  const version = { id: 'v1', productId: 'p1', version: 1, name: '合成生效产品', status: 'PUBLISHED', vehicleIds: [], modelDefinitionIds: ['model'] };
  const goods = cars.map(vehicle => ({
    id: `g${vehicle.id}`, vehicleId: vehicle.id, productVersionId: version.id, subscriptionPlanId: `plan-${vehicle.id}`,
    revision: 0, status: 'DRAFT', visible: true, recommended: false, sortOrder: 0, source: 'EXPLICIT',
    vehicle, productVersion: version,
    plan: { id: `plan-${vehicle.id}`, name: version.name, months: 12, monthlyFeeAmount: 100000, mileagePerMonthKm: 1500, excessMileagePriceAmount: 150, energyDescription: '自付', conditions: '本地合成测试', benefits: [] },
  }));
  const writes: {path:string;body:unknown}[] = [];
  const pageErrors: string[] = [];
  try {
    try { browser = await chromium.launch({ headless: true }); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Executable doesn't exist")) throw error;
      browser = await chromium.launch({ channel: 'chrome', headless: true });
    }
    const page = await browser.newPage();
    page.setDefaultTimeout(4000);
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      assert.equal(url.origin, origin, 'all traffic must stay on the synthetic loopback origin');
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const path = url.pathname.slice(4);
      if (request.method() === 'GET') {
        const data = path === '/admin/vehicles' ? cars : path === '/admin/products' ? [{ id: 'p1', versions: [version] }] : path === '/admin/goods' ? goods : null;
        assert.notEqual(data, null, `unexpected GET ${path}`);
        return route.fulfill({ json: { items: data, total: data!.length, page: 1, pageSize: Number(url.searchParams.get('pageSize')) } });
      }
      assert.equal(request.method(), 'POST');
      assert.ok(['/admin/goods/ga/publish', '/admin/goods/gb/publish'].includes(path), `unexpected write ${path}`);
      const body = request.postDataJSON();
      writes.push({ path, body });
      if (writes.length === 1) await firstGate;
      const record = goods.find(item => item.id === path.split('/')[3])!;
      assert.equal(body.revision, record.revision);
      record.status = 'PUBLISHED';
      record.revision++;
      await route.fulfill({ status: 201, json: record });
    });

    await page.goto(origin + '/#goods');
    await page.getByRole('button', { name: '批量上架 / 下架产品方案', exact: true }).click();
    await page.getByLabel('生效产品版本').selectOption('v1');
    await page.getByLabel('全选产品适用车辆').check();
    await page.getByRole('button', { name: '批量上架所选方案', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);

    // A hash navigation is also how App replaces custom pages; it bypasses Drawer.close.
    await page.evaluate(() => { window.location.hash = '#away'; });
    await expect(page.getByText('已离开商品中心', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const firstResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/goods/ga/publish');
    releaseFirst();
    await firstResponse;
    // A bounded quiet period observes forbidden follow-up work after the in-flight receipt.
    await page.waitForTimeout(500);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(writes.map(write => write.path), ['/admin/goods/ga/publish'], 'unmounted batch must not publish the second vehicle');
    assert.equal(goods[1].status, 'DRAFT');
  } finally {
    releaseFirst();
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
