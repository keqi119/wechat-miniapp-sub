// Actual wcc/wcsc and page code; native checkbox is represented by an HTML input for offline layout only.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { compile } = require('./compile-templates.cjs');
const { handoverRecord, stages } = require('../tests/fixtures/customer-handover-page.cjs');
const root = path.resolve(__dirname, '..');
const sourceRoot = path.resolve(process.env.MINIAPP_SOURCE_ROOT || process.env.MINIAPP_SOURCE_DIR || path.join(root, 'src'));
const out = path.resolve(process.env.MINIAPP_QA_OUTPUT || path.join(root, '.artifacts/customer-handover-layout'));
fs.mkdirSync(out, { recursive: true });
const compiled = compile(sourceRoot);
const generate = vm.runInNewContext('(function(global){' + compiled.wxml + '})({})', { window: {}, console });
const states = Object.fromEntries(Object.keys(stages).map(stage => [stage, handoverRecord(stage)]));
states.checked = handoverRecord('FACTS_PENDING');
states.missing = handoverRecord(); delete states.missing.signingReadiness;
states.raw_signed_unarchived = handoverRecord('ARCHIVING', { signatureStatus: 'SIGNED', signedFileId: null });
const expected = {};
const renderer = `function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag);for(const[k,v]of Object.entries(t.attr||{})){if(v==null)continue;if(['disabled','hidden','checked'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}if(t.tag==='wx-checkbox'){const input=document.createElement('input');input.type='checkbox';input.checked=!!t.attr?.checked;input.disabled=!!t.attr?.disabled;e.append(input);}(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
(async () => {
  for (const [state, record] of Object.entries(states)) {
    let definition;
    const services = { getDashboard: async () => ({ subscription: { vehicleName: record.vehicleTitle, planTitle: '离线合成套餐 · 12 个月' }, handover: { id: record.id } }), getHandover: async () => structuredClone(record), getContext: () => ({ profile: { name: '离线测试客户' } }) };
    const helpers = { load: async (page, fn) => page.setData({ ...await fn(), loading: false }), go: () => { throw Error('No navigation in layout verification'); } };
    vm.runInNewContext(fs.readFileSync(path.join(sourceRoot, 'pages/handover/index.js'), 'utf8'), { Page: value => definition = value, require: name => name.includes('/services/') ? services : name.includes('/utils/page') ? helpers : require(path.resolve(sourceRoot, 'pages/handover', name)) });
    const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
    await page.reload(); page.setData({ evidenceOpen: true, evidenceRead: state === 'checked', readFileIds: state === 'checked' ? record.fileIds : [] });
    expected[state] = { submitted: Boolean(page.data.submitted), canSign: state === 'READY_TO_SIGN', canOpenSigned: state === 'SIGNED', checked: state === 'checked', title: page.data.signing.title };
    for (const width of [320, 390]) {
      const tree = generate('pages/handover/index.wxml')(page.data);
      fs.writeFileSync(path.join(out, `handover-${width}-${state}.html`), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(root, 'scripts/preview/preview.css')).href}"></head><body class="phone-body"><header id="preview-navigation">车辆交接 · 离线排版核验</header><main id="preview-page"></main><script>${renderer};document.getElementById('preview-page').append(render(${JSON.stringify(tree).replaceAll('<', '\\u003c')}));const styles=(function(global){${compiled.wxss}})({});for(const file of ['app.wxss','pages/handover/index.wxss'])styles(file)('',{deviceWidth:${width},allowIllegalSelector:true});</script></body></html>`);
    }
  }
  const python = `
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path(${JSON.stringify(out)})
expected=json.loads(${JSON.stringify(JSON.stringify(expected))})
results=[]
errors=[]
external=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    for width in [320,390]:
        page=browser.new_page(viewport={'width':width,'height':844},device_scale_factor=1)
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('request',lambda r:external.append(r.url) if r.url.startswith(('http:','https:')) else None)
        for state,case in expected.items():
            page.goto((out/f'handover-{width}-{state}.html').as_uri(),wait_until='load')
            assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(width,state,'horizontal overflow')
            read=page.locator('.evidence-consent')
            assert read.count()==1
            assert read.bounding_box()['height']>=44
            assert read.locator('input[type=checkbox]').count()==1
            control=read.locator('input[type=checkbox]')
            assert control.is_checked()==case['checked'],(width,state,'wrong checked state')
            assert control.bounding_box()['width']>=18 and control.bounding_box()['height']>=18
            assert float(read.evaluate("e=>getComputedStyle(e).borderTopWidth").replace('px',''))>=0.8
            assert page.locator('[bindtap="sign"]').count()==(1 if case['canSign'] else 0),(width,state,'unavailable sign shown')
            assert page.locator('[bindtap="openSigned"]').count()==(1 if case['canOpenSigned'] else 0)
            if case['submitted']:
                card=page.locator('.signing-card')
                assert card.count()==1
                assert case['title'] in card.inner_text()
                assert card.locator('[bindtap="openRecord"]').count()==1
                if state in ['PREPARING','REVIEWING']:
                    assert '此步骤由后台工作人员完成' in card.inner_text()
                    assert '事实已确认，请继续签署交接单' not in page.locator('#preview-page').inner_text()
                card.scroll_into_view_if_needed()
            else:
                assert page.locator('.signing-card').count()==0
                read.scroll_into_view_if_needed()
            page.evaluate('window.scrollTo(0,0)')
            page.screenshot(path=str(out/f'handover-{width}-{state}.png'),full_page=True)
            results.append({'width':width,'state':state,'visibleReadCheckbox':True,'canSign':case['canSign'],'canOpenSigned':case['canOpenSigned'],'horizontalOverflow':False})
        page.close()
    browser.close()
assert not errors,errors
assert not external,external
report={'cases':results,'runtimeErrors':errors,'externalRequests':external,'productionMutations':False,'runtime':'Actual wcc/wcsc and page logic + synthetic DTO + offline Edge; native checkboxes approximated with HTML inputs, not a device test'}
(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\\n',encoding='utf-8')
print(json.dumps({'cases':len(results),'runtimeErrors':len(errors),'externalRequests':len(external),'passed':True}))
`;
  const result = spawnSync('python', ['-c', python], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  process.exitCode = result.status || 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
