import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium, expect, type Browser } from '@playwright/test';

const adminRoot = fileURLToPath(new URL('..', import.meta.url));

test('retry of an uncertain create only reconciles the original draft and stops later work', async () => {
  const entry = `import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {GoodsPage} from '/src/goods';
    import {api} from '/src/core';
    api.setSession({user:{id:'synthetic-operator',username:'synthetic',role:'OPERATIONS',permissions:['*']},csrfToken:'synthetic-csrf'});
    createRoot(document.getElementById('root')).render(React.createElement(GoodsPage));`;
  const built = await build({
    configFile: false, root: adminRoot, envDir: false, logLevel: 'silent',
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') },
    plugins: [{
      name: 'review-goods-reconcile',
      resolveId: id => id === 'virtual:review-goods-reconcile' ? id : undefined,
      load: id => id === 'virtual:review-goods-reconcile' ? entry : undefined,
    }],
    build: { write: false, minify: false, rolldownOptions: { input: 'virtual:review-goods-reconcile' } },
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
  const cars = ['a', 'b'].map(id => ({ id, title: `合成车辆${id}`, plateNumber: id === 'a' ? '甲' : '乙', vin: `SYNTHETIC-${id}`, modelDefinitionId: 'model' }));
  const version = { id: 'v1', productId: 'p1', version: 1, name: '合成生效产品', status: 'PUBLISHED', vehicleIds: [], modelDefinitionIds: ['model'] };
  const goods: {id:string;vehicleId:string;status:string;revision:number;[key:string]:unknown}[] = [];
  const commands = new Map();
  const writes: {path:string;body:unknown}[] = [];
  const pageErrors: string[] = [];
  let browser: Browser | undefined;
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
      assert.equal(url.origin, origin, 'all traffic stays on the synthetic loopback origin');
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const path = url.pathname.slice(4);
      if (request.method() === 'GET') {
        const data = path === '/admin/vehicles' ? cars : path === '/admin/products' ? [{ id: 'p1', versions: [version] }] : path === '/admin/goods' ? goods : null;
        assert.notEqual(data, null, `unexpected GET ${path}`);
        return route.fulfill({ json: { items: data, total: data!.length, page: 1, pageSize: Number(url.searchParams.get('pageSize')) } });
      }
      assert.equal(request.method(), 'POST');
      const body = request.postDataJSON();
      assert.ok(body.idempotencyKey);
      writes.push({ path, body });
      const identity = `${path}:${body.idempotencyKey}`;
      const prior = commands.get(identity);
      if (prior) {
        assert.deepEqual(prior.body, body, 'same idempotency identity must retain the exact body');
        return route.fulfill({ status: 201, json: prior.receipt });
      }
      let record;
      if (path === '/admin/goods') {
        assert.equal(body.productVersionId, version.id);
        assert.equal(body.revision, 0);
        assert.equal(goods.some(item => item.vehicleId === body.vehicleId), false, 'synthetic unique vehicle/version constraint');
        const vehicle = cars.find(car => car.id === body.vehicleId);
        assert.ok(vehicle);
        record = {
          id: `g${vehicle.id}`, vehicleId: vehicle.id, productVersionId: version.id, subscriptionPlanId: `plan-${vehicle.id}`,
          revision: 0, status: 'DRAFT', visible: body.visible, recommended: body.recommended, sortOrder: body.sortOrder, source: 'EXPLICIT',
          vehicle, productVersion: version,
          plan: { id: `plan-${vehicle.id}`, name: version.name, months: 12, monthlyFeeAmount: 100000, mileagePerMonthKm: 1500, excessMileagePriceAmount: 150, energyDescription: '自付', conditions: '本地合成测试', benefits: [] },
        };
        goods.push(record);
      } else {
        assert.ok(['/admin/goods/ga/publish', '/admin/goods/gb/publish'].includes(path), `unexpected write ${path}`);
        record = goods.find(item => item.id === path.split('/')[3])!;
        assert.equal(body.revision, record.revision);
        record.status = 'PUBLISHED';
        record.revision++;
      }
      commands.set(identity, { body, receipt: structuredClone(record) });
      if (writes.length === 1) {
        // The draft really committed; only its first response is uncertain.
        return route.fulfill({ status: 503, json: { error: { code: 'SYNTHETIC_UNKNOWN', message: '合成：创建回执未知' } } });
      }
      return route.fulfill({ status: 201, json: record });
    });

    await page.goto(origin + '/#goods');
    await page.getByRole('button', { name: '批量上架 / 下架产品方案', exact: true }).click();
    await page.getByLabel('生效产品版本').selectOption('v1');
    await page.getByLabel('全选产品适用车辆').check();
    await page.getByRole('button', { name: '批量上架所选方案', exact: true }).click();
    await expect(page.getByText('当前请求结果尚未确认', { exact: false })).toBeVisible();
    assert.equal(writes.length, 1, 'the initial unknown result stops the batch');
    assert.equal(goods[0].status, 'DRAFT');
    await page.getByRole('button', { name: '重试原请求', exact: true }).click();
    await expect(page.getByText('本次办理已结束或停止', { exact: false })).toBeVisible();
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(writes[1], writes[0], 'retry uses exactly the original create command');
    assert.deepEqual(writes.map(write => write.path), ['/admin/goods', '/admin/goods'], 'reconciliation must not publish that draft or start a later vehicle');
    assert.deepEqual(goods.map(({ vehicleId, status }) => ({ vehicleId, status })), [{ vehicleId: 'a', status: 'DRAFT' }]);
    await expect(page.getByText('乙：未处理', { exact: true })).toBeVisible();
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
