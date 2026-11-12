import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium, expect, type Browser } from '@playwright/test';

test('inherited shell keeps source dimensions, exact leaf navigation and isolated menu state on desktop and mobile', async () => {
  assert.ok(existsSync(new URL('./inherited-admin-shell.tsx', import.meta.url)), 'The inherited theme and shell must be implemented');
  const entry = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {AdminTheme,InheritedAdminShell} from '/src/inherited-admin-shell';
const navigation=[
 {key:'dashboard',label:'驾驶舱',kind:'shared',description:'',views:[]},
 {key:'vehicles',label:'车辆管理',kind:'business',description:'',views:[{key:'vehicles',label:'车辆台账',permission:'vehicles.read'},...Array.from({length:24},(_,i)=>({key:'vehicle-extra-'+i,label:'车辆子项'+i,permission:'vehicles.read'}))]},
 {key:'orders',label:'订单管理',kind:'business',description:'',views:[{key:'orders',label:'订单列表',permission:'orders.read'},{key:'order-renewals',label:'同车续期',permission:'order-changes.read'}]}
];
function Fixture(){const[user,setUser]=React.useState('a');const[route,setRoute]=React.useState('vehicles');const[logout,setLogout]=React.useState(0);const[clicks,setClicks]=React.useState(0);return <AdminTheme><InheritedAdminShell userId={user} userName={user==='a'?'合成甲':'合成乙'} roleLabel={user==='restricted'?'客服':'运营'} navigation={user==='restricted'?[navigation[0]]:navigation} route={route} onNavigate={setRoute} onLogout={()=>setLogout(n=>n+1)} onContentClick={()=>setClicks(n=>n+1)}><h1>合成业务内容</h1><p data-testid="selected-route">{route}</p><p data-testid="logout-count">{logout}</p><p data-testid="content-clicks">{clicks}</p><button onClick={()=>{setUser('b');setRoute('dashboard')}}>切换合成乙</button><button onClick={()=>{setUser('a');setRoute('dashboard')}}>切回合成甲</button><button onClick={()=>setUser('restricted')}>切换受限用户</button><button onClick={()=>setRoute('order-renewals?record=synthetic')}>外部续期深链</button><div style={{height:1800}}>可滚动合成内容</div></InheritedAdminShell></AdminTheme>};
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`;
  const built = await build({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent', plugins: [{ name: 'inherited-shell-fixture', resolveId: id => id === 'virtual:inherited-shell.tsx' ? id : undefined, load: id => id === 'virtual:inherited-shell.tsx' ? entry : undefined }], build: { write: false, minify: false, rolldownOptions: { input: 'virtual:inherited-shell.tsx' } } });
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
    // Cold narrow mount differs from resizing an already-inline desktop menu:
    // Sider starts collapsed while the active vehicles group is already open.
    const cold = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await cold.route('**/*', route => { assert.equal(new URL(route.request().url()).origin, origin); assert.equal(new URL(route.request().url()).pathname.startsWith('/api/'), false); return route.continue(); });
    const coldNav=cold.getByRole('navigation',{name:'主导航'}),coldMenu=cold.getByTestId('admin-menu-scroll');
    for(const phase of ['cold','refresh']){
      if(phase==='cold')await cold.goto(origin);else await cold.reload();
      await expect(cold.getByTestId('selected-route')).toHaveText('vehicles');
      await expect(cold.locator('.inherited-admin-sider')).toHaveClass(/ant-layout-sider-collapsed/);
      await cold.waitForTimeout(350); // Let AntD's enter motion finish before checking body portals.
      await expect(coldNav).not.toBeVisible();
      await expect(cold.locator('.ant-menu-submenu-popup:visible')).toHaveCount(0);
      await cold.getByRole('button',{name:'打开导航',exact:true}).click();
      await expect(coldNav.getByRole('menuitem',{name:'车辆台账',exact:true})).toHaveClass(/ant-menu-item-selected/);
      await expect.poll(()=>coldMenu.evaluate(element=>element.scrollHeight-element.clientHeight)).toBeGreaterThan(240);
      await coldMenu.evaluate(element=>{element.scrollTop=240;element.dispatchEvent(new Event('scroll',{bubbles:true}));});
      const before=await coldMenu.evaluate(element=>element.scrollTop);assert.ok(before>200);
      await cold.keyboard.press('Escape');await expect(coldNav).not.toBeVisible();
      await expect(cold.locator('.ant-menu-submenu-popup:visible')).toHaveCount(0);
      await cold.getByRole('button',{name:'打开导航',exact:true}).click();
      await expect.poll(()=>coldMenu.evaluate(element=>element.scrollTop)).toBeGreaterThanOrEqual(before-2);
      await cold.keyboard.press('Escape');
    }
    await cold.close();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => { assert.equal(new URL(route.request().url()).origin, origin); assert.equal(new URL(route.request().url()).pathname.startsWith('/api/'), false); return route.continue(); });
    await page.goto(origin);
    const nav = page.getByRole('navigation', { name: '主导航' });
    await expect(nav.getByRole('menuitem', { name: '车辆台账', exact: true })).toHaveClass(/ant-menu-item-selected/);
    assert.equal(Math.round((await page.locator('.inherited-admin-sider').boundingBox())!.width), 248);
    assert.equal(Math.round((await page.locator('.inherited-admin-header').boundingBox())!.height), 64);
    await expect(page.locator('#main-content.main-content')).toHaveAttribute('data-testid', 'admin-content-scroll');
    const evidence = new URL('../../../.runtime/ninda/pc-ui-inheritance-20261031/shell-mobile-reviewfix/', import.meta.url);
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL('shell-1440.png', evidence)) });
    await page.getByRole('button', { name: '外部续期深链', exact: true }).click();
    await expect(nav.getByRole('menuitem', { name: '同车续期', exact: true })).toHaveClass(/ant-menu-item-selected/);
    await nav.getByRole('menuitem', { name: '订单列表', exact: true }).click();
    await expect(page.getByTestId('selected-route')).toHaveText('orders');
    await expect(page.getByTestId('content-clicks')).toHaveText('1');
    const menuScroll = page.getByTestId('admin-menu-scroll');
    await menuScroll.evaluate(element => { element.scrollTop = 260; element.dispatchEvent(new Event('scroll', { bubbles: true })); });
    await page.getByRole('button', { name: '切换合成乙', exact: true }).click();
    await expect(nav.getByRole('menuitem', { name: '车辆台账', exact: true })).not.toBeVisible();
    assert.equal(await menuScroll.evaluate(element => element.scrollTop), 0);
    await page.getByRole('button', { name: '切回合成甲', exact: true }).click();
    await expect(nav.getByRole('menuitem', { name: '车辆台账', exact: true })).toBeAttached();
    await expect.poll(() => menuScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page.getByTestId('logout-count')).toHaveText('1');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.ant-menu-submenu-popup:visible')).toHaveCount(0);
    await expect(nav).not.toBeVisible();
    await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await expect(nav).toBeVisible();
    await expect.poll(async () => Math.round((await page.locator('.inherited-admin-sider').boundingBox())!.width)).toBe(248);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.screenshot({ path: fileURLToPath(new URL('shell-390.png', evidence)) });
    await page.keyboard.press('Escape');
    await expect(nav).not.toBeVisible();
    await expect(page.getByRole('button', { name: '打开导航', exact: true })).toBeFocused();
    await page.screenshot({ path: fileURLToPath(new URL('shell-390-closed.png', evidence)) });
    await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await menuScroll.evaluate(element => { element.scrollTop = 0; });
    await nav.getByRole('menuitem', { name: '驾驶舱', exact: true }).click();
    await expect(nav).not.toBeVisible();
    await page.getByRole('button', { name: '切换受限用户', exact: true }).click();
    await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await expect(nav.getByRole('menuitem', { name: '车辆管理', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('menuitem', { name: '订单管理', exact: true })).toHaveCount(0);
    await expect(page.getByText('合成甲', { exact: true })).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
