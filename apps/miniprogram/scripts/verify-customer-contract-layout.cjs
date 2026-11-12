// Actual wcc/wcsc output, synthetic records and offline Edge layout only.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { compile } = require('./compile-templates.cjs');
const { contractRecord, phases } = require('../tests/fixtures/customer-contract-page.cjs');
const root = path.resolve(__dirname, '..');
const sourceRoot = path.resolve(process.env.MINIAPP_SOURCE_ROOT || process.env.MINIAPP_SOURCE_DIR || path.join(root, 'src'));
const out = path.resolve(process.env.MINIAPP_QA_OUTPUT || path.join(root, '.artifacts/customer-contract-layout'));
fs.mkdirSync(out, { recursive: true });
const compiled = compile(sourceRoot);
const generate = vm.runInNewContext('(function(global){' + compiled.wxml + '})({})', { window: {}, console });
const states = Object.fromEntries(Object.keys(phases).map(phase => [phase, contractRecord(phase)]));
states.long_lessor = contractRecord('WAITING_OWNER', { lessor: { name: '上海离线合成超长实际车辆出租方新能源汽车租赁与综合运营服务管理有限公司' } });
states.legacy_platform = contractRecord('READY_TO_SIGN');
states.legacy_platform.contractDetail.parties[1].role = 'PLATFORM';
states.amendment = contractRecord('READY_TO_SIGN', { kind: 'AMENDMENT', canSign: false, canQuery: false, primaryAction: null });
states.missing = contractRecord(); delete states.missing.contractDetail;
states.unknown = contractRecord('VERIFYING', { phase: 'UNKNOWN_FUTURE_PHASE' });
if (process.env.MINIAPP_CONTRACT_DTO_FIXTURE) {
  const fixture = JSON.parse(fs.readFileSync(process.env.MINIAPP_CONTRACT_DTO_FIXTURE, 'utf8'));
  if (fixture.synthetic !== true) throw Error('Contract layout fixture must be synthetic');
  for (const [name, record] of Object.entries(fixture.records || { contract: fixture.record })) states['api_' + name] = record;
}
const expected = {};
const renderer = `function render(t){if(t==null)return document.createTextNode('');if(typeof t!=='object')return document.createTextNode(String(t));if(!t.tag||t.tag==='virtual'){const f=document.createDocumentFragment();(t.children||[]).forEach(c=>f.append(render(c)));return f;}const e=document.createElement(t.tag);for(const[k,v]of Object.entries(t.attr||{})){if(v==null)continue;if(['disabled','hidden'].includes(k)){if(v)e.setAttribute(k,'');}else e.setAttribute(k,String(v));}(t.children||[]).forEach(c=>e.append(render(c)));return e;}`;
(async () => {
  for (const [state, record] of Object.entries(states)) {
    let definition;
    const helpers = { load: async (page, fn) => page.setData({ ...await fn(), loading: false }), go: () => { throw Error('Layout must not navigate'); } };
    vm.runInNewContext(fs.readFileSync(path.join(sourceRoot, 'pages/record/index.js'), 'utf8'), { Page: value => definition = value, require: name => name.includes('/services/') ? { getRecord: async () => record } : name.includes('/utils/page') ? helpers : require(path.resolve(sourceRoot, 'pages/record', name)), wx: {} });
    const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
    page.setData({ type: 'contracts', id: record.id }); await page.reload();
    expected[state] = { id: record.id, available: page.data.contract?.available === true, phaseText: page.data.contract?.phaseText || '', primaryAction: page.data.contract?.primaryAction?.id || '', values: (page.data.contract?.summaryRows || []).map(row => row.value) };
    for (const width of [320, 390]) {
      const tree = generate('pages/record/index.wxml')({ ...page.data, message: '操作反馈不得写入合同正文' });
      fs.writeFileSync(path.join(out, `contract-${width}-${state}.html`), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(root, 'scripts/preview/preview.css')).href}"></head><body class="phone-body"><header id="preview-navigation">合同详情 · 离线排版核验</header><main id="preview-page"></main><script>${renderer};document.getElementById('preview-page').append(render(${JSON.stringify(tree).replaceAll('<', '\\u003c')}));const styles=(function(global){${compiled.wxss}})({});for(const file of ['app.wxss','pages/record/index.wxss'])styles(file)('',{deviceWidth:${width},allowIllegalSelector:true});</script></body></html>`);
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
            page.goto((out/f'contract-{width}-{state}.html').as_uri(),wait_until='load')
            text=page.locator('#preview-page').inner_text()
            assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(width,state)
            assert page.locator('.contract-heading').count()==1,(width,state,'missing dedicated contract branch')
            assert text.count(case['id'])==1,(width,state,text)
            assert '旧通用待处理' not in text and '旧通用签署' not in text and '不可沿用旧文件' not in text
            assert '操作反馈不得写入合同正文' not in text
            assert page.locator('[bindtap="act"]').count()==0
            if case['available']:
                assert case['phaseText'] in text
                for value in case['values']: assert value in text,(width,state,value)
                assert page.locator('.contract-summary').bounding_box()['y']<page.locator('.contract-progress').bounding_box()['y']
                assert page.locator('.contract-summary').bounding_box()['y']<400,(width,state,'summary is below first screen')
                if state=='long_lessor': assert '综合运营服务管理有限公司' in text
                if state=='amendment': assert '查看订阅变更方案' in text
                if state in ['ARCHIVED','api_ARCHIVED']:
                    assert '合同原文（未签署）' in text and '双方签署归档文件' in text
                    assert '等待车主' not in text and '当前步骤' not in text and '待进行' not in text
                    assert page.locator('.contract-step-DONE').count()==5
                    assert text.count('已核实签署')==2
                if state=='WAITING_OWNER':
                    assert '您的签署结果已核实' in text
                    assert page.locator('.contract-step-CURRENT').inner_text().find('车主签署')>=0
                sign=page.locator('[bindtap="contractAction"][data-action="sign"]')
                assert sign.count()==(1 if case['primaryAction']=='sign' else 0),(width,state,'wrong sign capability')
            else:
                assert '合同信息暂未提供或版本待核对' in text
                assert page.locator('[bindtap="contractAction"]').count()==0
            footer=page.locator('.contract-actions')
            assert footer.count()==1
            box=footer.bounding_box()
            assert abs(box['y']+box['height']-844)<2,(width,state,box)
            for button in footer.locator('wx-button').all():
                b=button.bounding_box()
                assert b['width']>=90 and b['height']>=38,(width,state,b)
            page.screenshot(path=str(out/f'contract-{width}-{state}.png'),full_page=False)
            page.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)')
            meta=page.locator('.contract-meta').bounding_box()
            assert meta['y']+meta['height']<=footer.bounding_box()['y']+1,(width,state,'footer overlaps metadata')
            results.append({'width':width,'state':state,'horizontalOverflow':False,'metadataAboveFixedActions':True})
        page.close()
    browser.close()
assert not errors,errors
assert not external,external
report={'cases':results,'runtimeErrors':errors,'externalRequests':external,'productionMutations':False,'runtime':'Actual wcc/wcsc + synthetic DTO + offline Edge; not a real device test'}
(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\\n',encoding='utf-8')
print(json.dumps({'cases':len(results),'runtimeErrors':len(errors),'externalRequests':len(external),'passed':True}))
`;
  const result = spawnSync('python', ['-c', python], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  process.exitCode = result.status || 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
