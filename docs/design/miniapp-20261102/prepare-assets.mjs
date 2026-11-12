import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Local design-only asset optimization. Retain the original photograph untouched.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(path.join(root, 'apps/signing-h5/package.json'));
const { chromium } = require('@playwright/test');
const original = path.join(root, '.runtime/catalog-source/images/et5-2024-same-generation-original.jpg');
const license = JSON.parse(await fs.readFile(path.join(root, '.runtime/catalog-source/images/licenses.json'), 'utf8')).records.find(r => r.model === 'ET5');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const source = `data:image/jpeg;base64,${(await fs.readFile(original)).toString('base64')}`;
  const optimized = await page.evaluate(async data => {
    const img = new Image(); img.src = data; await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 960; canvas.height = Math.round(img.height * 960 / img.width);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', .83);
  }, source);
  await fs.mkdir(path.join(here, 'assets'), { recursive: true });
  await fs.writeFile(path.join(here, 'assets/et5-design-example.webp'), Buffer.from(optimized.split(',')[1], 'base64'));
  await fs.writeFile(path.join(here, 'assets/photo-source.json'), JSON.stringify({
    title: license.title, author: license.author, source: license.filePageUrl,
    sourceRevision: license.sourceRevisionUrl, license: license.license,
    licenseUrl: license.licenseCanonicalUrl, originalSha256: license.sha256,
    modifications: 'Resized to 960px wide and encoded as WebP for a local design prototype; CSS crops display only. No retouching.',
    caption: 'ET5 同代车型示意，非库存实拍；价格及记录均为合成示例。'
  }, null, 2) + '\n');
  console.log(JSON.stringify({assetBytes: Buffer.from(optimized.split(',')[1], 'base64').length}));
} finally { await browser.close(); }
