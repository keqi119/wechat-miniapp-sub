import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium, expect, type Browser } from '@playwright/test';
import { navigationFor, routeVisible, type ModuleView } from './modules/navigation.ts';
import { presentationFor } from './navigation-group-model.ts';

function allowed(role = 'ADMIN', permissions = ['*']) {
  return navigationFor(role).map(module => ({ ...module, views: module.views.filter(view => routeVisible(view.key, role, permissions, ['partner.cooperation.read'])) })).filter(module => module.key === 'dashboard' || module.views.length > 0);
}

test('license archive deep link selects the archive itself beside the vehicle ledger', () => {
  const result = presentationFor(allowed(), '#license-plates?record=plate-1&view=history');
  assert.equal(result.selectedRoute, 'license-plates');
  const views = result.navigation.find(module => module.key === 'vehicles')!.views;
  assert.equal(views.find(view => view.key === 'license-plates')?.label, '牌照档案');
  assert.equal(views.find(view => view.key === 'vehicles')?.label, '车辆台账');
  assert.deepEqual(result.tabs, []);
});

test('sidebar retains every independent business leaf and its real metadata without changing input', () => {
  const navigation = allowed();
  const before = structuredClone(navigation);
  for (const module of navigation) { module.views.forEach(Object.freeze); Object.freeze(module.views); Object.freeze(module); }
  Object.freeze(navigation);
  const result = presentationFor(navigation, 'vehicles');
  assert.deepEqual(result.navigation, navigation);
  const reachable: string[] = [];
  for (const module of result.navigation) for (const representative of module.views) {
    const current = presentationFor(navigation, representative.key);
    assert.equal(current.selectedRoute, representative.key);
    assert.deepEqual(current.tabs, []);
    reachable.push(current.selectedRoute);
  }
  const leaves = navigation.flatMap(module => module.views.map(view => view.key));
  assert.equal(new Set(reachable).size, reachable.length, 'A business leaf must appear exactly once');
  assert.deepEqual([...reachable].sort(), [...leaves].sort(), 'Every authorized business must be in the sidebar');
  assert.deepEqual(navigation, before);
  assert.equal(result.selectedRoute, 'vehicles');
});

test('limited grants keep original names and revoked or unknown routes receive no invented selection', () => {
  const navigation = allowed('FINANCE', ['residual-curves.read', 'asset-cost-plans.read', 'order-changes.read']);
  const result = presentationFor(navigation, '#residual-curves?record=synthetic&view=history');
  assert.equal(result.selectedRoute, 'residual-curves');
  assert.equal(result.label, '残值曲线');
  assert.deepEqual(result.tabs, []);
  assert.equal(result.navigation.some(module => module.key === 'vehicles'), false);
  assert.deepEqual(result.navigation.find(module => module.key === 'depreciation')!.views.map(view => [view.key, view.label]), [['residual-curves', '残值曲线']]);
  assert.deepEqual(result.navigation.find(module => module.key === 'finance')!.views.map(view => view.key), ['asset-cost-plans']);
  for (const route of ['vehicles', 'residual-forecasts', 'not-authorized', '#payments?record=private']) {
    const denied = presentationFor(navigation, route);
    assert.equal(denied.selectedRoute, ''); assert.deepEqual(denied.tabs, []); assert.equal(denied.label, undefined);
  }
  const withdrawn = presentationFor(allowed('FINANCE', []), 'residual-curves');
  assert.equal(withdrawn.selectedRoute, ''); assert.deepEqual(withdrawn.tabs, []);
  assert.deepEqual(presentationFor([], 'dashboard'), { navigation: [], selectedRoute: '', tabs: [] });
  assert.equal(presentationFor(navigation, 'dashboard').selectedRoute, 'dashboard');
  const empty = {key:'empty', label:'空业务组', kind:'business' as const, description:'', views:[]};
  assert.deepEqual(presentationFor([...navigation, empty], 'empty').navigation, navigation);
  assert.equal(presentationFor([...navigation, empty], 'empty').selectedRoute, '');
});

test('deep links and future authorized leaves select themselves without altering the hash', () => {
  const navigation = allowed();
  const extra: ModuleView = { key: 'future-vehicle-route', label: '未来已授权功能', permission: 'future.read' };
  navigation.find(module => module.key === 'vehicles')!.views.push(extra);
  navigation.push({ key: 'future-module', label: '未来模块', kind: 'business', description: '既有可见模型', views: [{ key: 'future-module-leaf', label: '未来页面', permission: 'future-module.read' }] });
  const hash = '#residual-curves?record=curve-1&view=history&returnTo=vehicles';
  const result = presentationFor(navigation, hash);
  assert.equal(result.selectedRoute, 'residual-curves');
  assert.deepEqual(result.tabs, []);
  assert.equal(hash, '#residual-curves?record=curve-1&view=history&returnTo=vehicles');
  const future = presentationFor(navigation, 'future-vehicle-route');
  assert.equal(future.selectedRoute, extra.key); assert.deepEqual(future.tabs, []);
  assert.equal(future.navigation.find(module => module.key === 'vehicles')!.views.at(-1), extra);
  assert.equal(presentationFor(navigation, 'future-module-leaf').selectedRoute, 'future-module-leaf');
  assert.equal(presentationFor(navigation, 'dashboard').tabs.length, 0);
});

test('real sidebar leaves cold-load deep routes and clear on permission changes at desktop and 390px', async () => {
  const entry = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {AdminTheme,InheritedAdminShell} from '/src/inherited-admin-shell';
import {navigationFor,routeVisible} from '/src/modules/navigation';
import {presentationFor} from '/src/navigation-group-model';
import {PageFunctionTabs} from '/src/navigation-groups';
function Fixture(){const[role,setRole]=React.useState('ADMIN');const[permissions,setPermissions]=React.useState(['*']);const[route,setRoute]=React.useState(location.hash.slice(1)||'residual-curves');
React.useEffect(()=>{const read=()=>setRoute(location.hash.slice(1)||'residual-curves');window.addEventListener('hashchange',read);return()=>window.removeEventListener('hashchange',read)},[]);
const nav=navigationFor(role).map(m=>({...m,views:m.views.filter(v=>routeVisible(v.key,role,permissions,['partner.cooperation.read']))})).filter(m=>m.key==='dashboard'||m.views.length);const p=presentationFor(nav,route);
return <AdminTheme><InheritedAdminShell navigation={p.navigation} route={p.selectedRoute} userId={role} userName="合成用户" roleLabel={role} onNavigate={key=>{location.hash=key}} onLogout={()=>{}}><PageFunctionTabs tabs={p.tabs} route={route} label={p.label}/><h1>本地合成功能页</h1><p data-testid="route">{route}</p><button onClick={()=>{setRole('FINANCE');setPermissions(['residual-curves.read','asset-cost-plans.read'])}}>只读财务</button><button onClick={()=>setPermissions([])}>撤回权限</button><button onClick={()=>{setRole('ADMIN');setPermissions(['*'])}}>恢复运营</button></InheritedAdminShell></AdminTheme>};
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`;
  const built = await build({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent', plugins: [{ name: 'function-navigation-fixture', resolveId: id => id === 'virtual:function-navigation.tsx' ? id : undefined, load: id => id === 'virtual:function-navigation.tsx' ? entry : undefined }], build: { write: false, minify: false, rolldownOptions: { input: 'virtual:function-navigation.tsx' } } });
  const output = (Array.isArray(built) ? built[0] : built) as { output: { type: string; fileName: string; code?: string; source?: string | Uint8Array; isEntry?: boolean }[] };
  const entryChunk = output.output.find(item => item.type === 'chunk' && item.isEntry)!;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${output.output.filter(item => item.fileName.endsWith('.css')).map(item => `<link rel="stylesheet" href="/${item.fileName}">`).join('')}</head><body style="margin:0"><div id="root"></div><script type="module" src="/${entryChunk.fileName}"></script></body></html>`;
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname.slice(1);
    const asset = output.output.find(item => item.fileName === path);
    res.setHeader('Content-Type', asset ? path.endsWith('.css') ? 'text/css' : 'text/javascript' : 'text/html');
    res.end(asset ? asset.code ?? asset.source : html);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let browser: Browser | undefined;
  try {
    try { browser = await chromium.launch({ headless: true }); }
    catch (error) { if (!(error instanceof Error) || !error.message.includes("Executable doesn't exist")) throw error; browser = await chromium.launch({ channel: 'chrome', headless: true }); }
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => { assert.equal(new URL(route.request().url()).origin, origin); assert.equal(new URL(route.request().url()).pathname.startsWith('/api/'), false); return route.continue(); });
      const initialHash = '#license-plates?record=plate-1&view=history&page=2';
      await page.goto(`${origin}/${initialHash}`);
      await expect(page.getByTestId('route')).toHaveText(initialHash.slice(1));
      await expect(page.locator('.page-function-tabs')).toHaveCount(0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (width === 390) await page.getByRole('button', { name: '打开导航', exact: true }).click();
      const menu = page.getByRole('navigation', { name: '主导航' });
      await expect(menu.getByRole('menuitem', { name: '牌照档案', exact: true })).toHaveClass(/ant-menu-item-selected/);
      await expect(menu.getByRole('menuitem', { name: '车辆台账', exact: true })).not.toHaveClass(/ant-menu-item-selected/);
      await expect(menu.getByRole('menuitem', { name: '保养提醒', exact: true })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: '内部工单', exact: true })).toBeVisible();
      const evidence = new URL('../../../.runtime/ninda/pc-ui-inheritance-20261031/navigation-independent/', import.meta.url); mkdirSync(evidence, { recursive: true });
      await page.screenshot({ path: fileURLToPath(new URL(`sidebar-${width}.png`, evidence)) });
      for (const [label, routeName] of [['内部工单','asset-work-orders'],['残值曲线','residual-curves']]) {
        if (routeName === 'residual-curves') await menu.getByRole('menuitem', { name: '折旧管理', exact: true }).click();
        await menu.getByRole('menuitem', { name: label, exact: true }).click();
        await expect(page.getByTestId('route')).toHaveText(routeName);
        if (width === 390) await page.getByRole('button', { name: '打开导航', exact: true }).click();
        await expect(menu.getByRole('menuitem', { name: label, exact: true })).toHaveClass(/ant-menu-item-selected/);
      }
      if (width === 390) await page.keyboard.press('Escape');
      await page.reload();
      if (width === 390) await page.getByRole('button', { name: '打开导航', exact: true }).click();
      await expect(menu.getByRole('menuitem', { name: '残值曲线', exact: true })).toHaveClass(/ant-menu-item-selected/);
      if (width === 390) await page.keyboard.press('Escape');
      await page.goBack();
      await expect(page.getByTestId('route')).toHaveText('asset-work-orders');
      await page.getByRole('button', { name: '只读财务', exact: true }).click();
      await expect(page.locator('.page-function-tabs')).toHaveCount(0);
      if (width === 390) await page.getByRole('button', { name: '打开导航', exact: true }).click();
      await expect(menu.locator('.ant-menu-item-selected')).toHaveCount(0);
      await expect(menu.getByRole('menuitem', { name: '车辆管理', exact: true })).toHaveCount(0);
      await menu.getByRole('menuitem', { name: '折旧管理', exact: true }).click();
      await expect(menu.getByRole('menuitem', { name: '牌照档案', exact: true })).toHaveCount(0);
      await expect(menu.getByRole('menuitem', { name: '内部工单', exact: true })).toHaveCount(0);
      await menu.getByRole('menuitem', { name: '残值曲线', exact: true }).click();
      await expect(page.getByTestId('route')).toHaveText('residual-curves');
      await page.getByRole('button', { name: '撤回权限', exact: true }).click();
      if (width === 390) await page.getByRole('button', { name: '打开导航', exact: true }).click();
      await expect(menu.getByRole('menuitem', { name: '车辆管理', exact: true })).toHaveCount(0);
      await expect(menu.getByRole('menuitem', { name: '折旧管理', exact: true })).toHaveCount(0);
      await expect(menu.getByRole('menuitem', { name: '财务管理', exact: true })).toHaveCount(0);
      await expect(menu.locator('.ant-menu-item-selected')).toHaveCount(0);
      assert.deepEqual(errors, []); await page.close();
    }
  } finally { await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
