import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = 'docs/legal';
const manifest = JSON.parse(readFileSync(`${root}/approval-manifest.json`, 'utf8').replace(/^\uFEFF/, ''));
if (manifest.status !== 'PENDING_USER_APPROVAL') throw new Error('Approval has already been recorded');
const files = ['subscription-contract.md','commercial-schedule.md','handover-record.md','user-agreement.md','privacy-policy.md','application-notice.md'];
mkdirSync(`${root}/approved-source`, { recursive: true });
const hashes = [];
for (const file of files) {
  const source = readFileSync(`${root}/${file}`, 'utf8');
  const sourceHash = createHash('sha256').update(source).digest('hex');
  const recorded = manifest.files.find(item => item.path.replaceAll('\\','/').endsWith(`/${file}`));
  if (recorded?.sha256 !== sourceHash) throw new Error(`Reviewed document changed: ${file}`);
  copyFileSync(`${root}/${file}`, `${root}/approved-source/${file}`);
  const content = source
    .replaceAll('草稿 v0.1｜未批准生效', '正式文本 v1.0｜2026-10-16 经运营主体确认')
    .replaceAll('草稿 v0.1｜生效日期待审定', '正式文本 v1.0｜2026-10-16 经运营主体确认；实际发布生效日期见小程序版本信息')
    .replace('拟定版本：1.0；生效日期由审定后的实际发布日期确定', '版本：1.0；生效日期由实际发布日期确定')
    .replace('甲方拟在 7 个工作日内', '甲方在 7 个工作日内')
    .replace('本段时限为待审定业务规则。', '')
    .replace('原则上拟于 15 个工作日内答复；该服务时限待运营确认。', '原则上于 15 个工作日内答复。')
    .replace('拟定保存规则如下，均从对应业务状态满足时起计算；这些期限与运营流程须经本政策正式审定后执行。', '保存规则如下，均从对应业务状态满足时起计算。')
    .replace('拟定期限及处理', '期限及处理')
    .replace('作为拟定业务期限', '作为业务期限')
    .replace('本草稿本身不用于取得客户授权。审定时需确认上述保存规则、Gmail 联系方式及人工权利响应安排，并核对实际功能与处理范围一致。', '本政策经运营主体确认后发布；实际功能和处理范围发生变化时，依本政策第五条更新告知。');
  writeFileSync(`${root}/${file}`, content);
  hashes.push({ file, approvedSourceSha256: sourceHash, finalSha256: createHash('sha256').update(content).digest('hex') });
}
Object.assign(manifest, { status: 'APPROVED', approvedAt: new Date().toISOString(), approvedBy: '用户代表上海晓浪网络科技有限公司', approvalStatement: '已审阅并批准六份文案，逐单附件由运营填写后签署', approvalQuestionId: 'call_270844bd13a54617b65461608fccb4c5', sourceThread: '01a1429f-b865-7d13-8589-1f63aa27b1db', editorialChanges: '仅将草稿/拟定/待确认标记改为已批准正式文本；保留全部实体业务条款及逐单变量。', approvedFiles: hashes });
writeFileSync(`${root}/approval-manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ approvalRecorded: true, documents: hashes.length, version: '1.0' }));
