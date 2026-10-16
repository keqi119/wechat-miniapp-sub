import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const repository = 'D:/Projects/auto-subscription-platform';
const commit = '453da778dcfefd3727813179382490903644ef26';
const mode = process.argv[2];
if (!['tests', 'protocol'].includes(mode)) throw new Error('Expected tests or protocol');
const files = mode === 'tests'
  ? ['apps/api/test/fadada-digest.spec.ts', 'apps/api/test/fadada-api-client.spec.ts',
    'apps/api/test/enterprise-seal-policy.spec.ts', 'apps/api/test/enterprise-seal-signing-plan.spec.ts']
  : ['apps/api/src/esign/esign.provider.ts',
    ...['fadada.types.ts', 'fadada-digest.ts', 'fadada-request-builder.ts', 'fadada-http-client.ts', 'fadada-api.client.ts'].map(name => `apps/api/src/esign/fadada/${name}`),
    ...['enterprise-seal.types.ts', 'signature-policy-engine.ts', 'signing-plan-compiler.ts', 'signing-plan-hash.ts', 'enterprise-seal-mask.ts'].map(name => `apps/api/src/esign/enterprise-seal/${name}`)];
const manifestPath = resolve('docs/evidence/fadada-source-manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { repository: 'https://github.com/keqi119/subscription-Saas', commit, files: [] };
for (const file of files) {
  const contents = execFileSync('git', ['show', `${commit}:${file}`], { cwd: repository });
  const target = resolve(file);
  if (existsSync(target)) throw new Error(`Refusing to replace existing file: ${file}`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  manifest.files.push({ source: file, target: file, sha256: createHash('sha256').update(contents).digest('hex'), adaptation: 'none' });
}
mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(`Imported ${files.length} ${mode} files from ${commit.slice(0, 8)}.\n`);
