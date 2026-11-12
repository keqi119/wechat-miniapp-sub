import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInThisContext} from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as jsxRuntime from 'react/jsx-runtime';
import * as core from './core.ts';
import * as commands from './domain-commands.ts';
import * as operations from './partner-operations.ts';
import * as prose from './prose.ts';
import * as processGuide from './process-guide-model.ts';
import * as processNavigation from './process-navigation.ts';
import type {BusinessField, BusinessValues} from './domain-commands.ts';

type Element = React.ReactElement<any>;
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  return React.isValidElement<any>(value) ? [value, ...elements(value.props.children)] : [];
}

// Execute the real TSX modules in memory; only the Vite environment and external
// React hook/network boundaries are supplied by this pure Node test.
function loadTsx(name: string, imports: Record<string, unknown>): Record<string, any> {
  const code = ts.transpileModule(readFileSync(new URL(name, import.meta.url), 'utf8'), {
    fileName: name,
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX},
    transformers: {before: [context => source => {
      const visit: ts.Visitor = node => ts.isMetaProperty(node)
        ? context.factory.createObjectLiteralExpression([context.factory.createPropertyAssignment('env', context.factory.createObjectLiteralExpression())])
        : ts.visitEachChild(node, visit, context);
      return ts.visitNode(source, visit) as ts.SourceFile;
    }]},
  }).outputText;
  const module = {exports: {}};
  const require = (id: string) => {
    assert.ok(Object.hasOwn(imports, id), `Unexpected module dependency: ${id}`);
    return imports[id];
  };
  runInThisContext(`(function(require,module,exports){${code}\n})`, {filename: name})(require, module, module.exports);
  return module.exports;
}

async function uploadThroughActualControl(commandLabel?: string) {
  const requests: {url: string; options: RequestInit}[] = [];
  let updated: BusinessValues = {};
  let completed!: () => void;
  let failed!: (error: unknown) => void;
  const done = new Promise<void>((resolve, reject) => {completed = resolve; failed = reject;});
  const client = new core.ApiClient(async (url, options) => {
    requests.push({url: String(url), options: options || {}});
    return new Response(JSON.stringify({id: 'proof-file-1'}), {status: 201, headers: {'Content-Type': 'application/json'}});
  });
  client.setSession({user: {id: 'staff-1', username: 'synthetic-operator', role: 'OPERATIONS', permissions: ['partners.write'], partnerCapabilities:['partner.cooperation.write','partner.cooperation.read']}, csrfToken: 'synthetic-csrf'});
  const imports: Record<string, unknown> = {
    'react': {...React, useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, (value: unknown) => {if (value instanceof Error) failed(value);}], useRef: (current: unknown) => ({current}), useEffect: () => {}, useContext: (context: {_currentValue:unknown}) => context._currentValue},
    'react/jsx-runtime': jsxRuntime,
    'react-dom': ReactDOM,
    'lucide-react': {Plus: () => null, RefreshCw: () => null},
    './core': {...core, api: client},
    './domain-commands': commands,
    './process-guide-model': processGuide,
    './process-navigation': processNavigation,
    './resource-list-layout': {ResourceListLayout: () => null},
    './record-workspace-shell': {RecordWorkspaceShell: () => null},
    './ui': {Drawer: () => null, ErrorNotice: () => null, Loading: () => null, Status: () => null},
    './partner-finance': {PartnerFinance: () => null},
    './partner-operations':operations,
    './contract-center':{ArchiveDetail:()=>null},'./partner-simple':{SimplePartnersPage:()=>null},
  };
  imports['./prose-text'] = loadTsx('./prose-text.tsx', {...imports, './prose': prose});
  const domain = loadTsx('./domain-ui.tsx', imports);
  const help = loadTsx('./partner-access-help.tsx', imports);
  const partners = loadTsx('./partners.tsx', {...imports, './domain-ui': domain, './partner-access-help': help});
  let field: BusinessField = domain.evidence;
  if (commandLabel) {
    const page = partners.LegacyPartnersPage({view: 'partners'}) as Element;
    assert.equal(page.type, domain.Manager);
    const detailElement = page.props.children({id: 'partner-1', subjectType: 'ENTERPRISE', identities: [], verification: null, vehicles: [], vehicleProposals: []}, async () => {});
    const detail=(detailElement.type as (props:unknown)=>unknown)(detailElement.props);
    const command = elements(detail).find(node => node.type === domain.Command && node.props.label === '维护合作草稿');
    assert.ok(command, `Missing actual command: ${commandLabel}`);
    const fields=command.props.fields as BusinessField[];
    const parent=fields.find(f=>f.key===commandLabel)!;
    field=parent.kind==='files'?parent:parent.fields!.find(f=>f.kind==='files')!;
    field={...field,key:'evidenceFileIds'};
    assert.ok(field, `Missing actual upload field: ${commandLabel}`);
  }
  const form = domain.FormFields({fields: [field], values: {}, setValues: (value: BusinessValues) => {updated = value;}, disabled: false, afterUpload: completed});
  const control = elements(form).find(node => typeof node.type === 'function');
  assert.ok(control, 'FormFields should render the real file control');
  const rendered = (control.type as (props: unknown) => unknown)(control.props);
  const input = elements(rendered).find(node => node.type === 'input' && node.props.type === 'file');
  assert.ok(input, 'The actual control should render a file input');
  const timer = setTimeout(() => failed(new Error('Upload did not complete')), 2000);
  try {
    input.props.onChange({target: {files: [new File(['synthetic proof'], 'proof.pdf', {type: 'application/pdf'})], value: 'selected'}});
    await done;
  } finally {clearTimeout(timer);}
  assert.equal(requests.length, 1, 'Choosing a file must only upload it, without submitting a business command');
  assert.equal(requests[0].url, '/api/admin/files');
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(updated, {evidenceFileIds: ['proof-file-1']});
  const body = requests[0].options.body;
  assert.ok(body instanceof FormData);
  assert.equal((body.get('file') as File).name, 'proof.pdf');
  assert.ok(body.get('idempotencyKey'));
  return body;
}

for (const label of ['representatives', 'subjectEvidenceFileIds', 'vehicles']) {
  test(`${label} uploads protected identity materials before any business submission`, async () => {
    const body = await uploadThroughActualControl(label);
    assert.equal(body.get('purpose'), 'identity');
  });
}

test('ordinary shared evidence upload retains its existing purpose', async () => {
  const body = await uploadThroughActualControl();
  assert.equal(body.get('purpose'), 'evidence');
});
