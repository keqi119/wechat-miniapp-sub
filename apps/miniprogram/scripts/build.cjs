const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { check } = require('./check.cjs');
const { compile, filesBelow } = require('./compile-templates.cjs');
const ROOT = path.resolve(__dirname, '..');
function build({ source = path.join(ROOT, 'src'), destination = path.join(ROOT, '.artifacts/production') } = {}) {
  const artifactRoot = path.join(ROOT, '.artifacts') + path.sep;
  const output = path.resolve(destination);
  if (!output.startsWith(artifactRoot)) throw new Error('Production output must stay in this package .artifacts directory.');
  const files = filesBelow(source);
  for (const file of files) {
    if (/(^|\/)(mock|fixtures)(\.|\/)|demo-banner|private\.config|config\.local/i.test(file)) throw new Error('Mock/private data forbidden in production: ' + file);
    if (!/\.(js|json|wxml|wxss)$/.test(file)) continue;
    const text = fs.readFileSync(path.join(source, file), 'utf8');
    if (/setScenario|setFault|resetDemo|INTEGRATION_PENDING|\/api\/portal|mode\s*:\s*['"]mock['"]/.test(text)) throw new Error('Demo behavior forbidden in production: ' + file);
  }
  const errors = check(source);
  if (errors.length) throw new Error(errors.join('\n'));
  const compiled = compile(source);
  const config = require(path.join(source, 'config.js'));
  if (config.mode !== 'api' || config.apiBase !== 'https://mini-api.subauto.keybox.cloud') throw new Error('Production must target the approved independent HTTPS API.');
  // Windows DevTools can keep a directory handle open for an imported project.
  // Keep that root and replace its contents after validating the output boundary.
  if (fs.existsSync(output)) for (const entry of fs.readdirSync(output)) fs.rmSync(path.join(output, entry), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  fs.mkdirSync(output, { recursive: true });
  for (const file of files) {
    const target = path.join(output, 'src', file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(source, file), target);
  }
  fs.copyFileSync(path.join(ROOT, 'project.config.json'), path.join(output, 'project.config.json'));
  const manifest = files.map(file => ({ path: 'src/' + file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(source, file))).digest('hex') }));
  fs.writeFileSync(path.join(output, 'FILE-MANIFEST.json'), JSON.stringify({ generatedAt: new Date().toISOString(), apiBase: config.apiBase, scope: 'Native source package with wcc/wcsc template validation; requires current WeChat DevTools compilation and device verification before upload.', compiler: compiled.counts, files: manifest }, null, 2) + '\n');
  return { directory: output, files: files.length, compiler: compiled.counts };
}
if (require.main === module) console.log(JSON.stringify(build()));
module.exports = { build };
