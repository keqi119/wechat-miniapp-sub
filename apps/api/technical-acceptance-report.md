# 技术签署验收 API 实施报告

范围：Task 1，独立 `TECHNICAL_ACCEPTANCE`，未创建商业订单、账单、付款、车辆交接或权益。仅本地合成身份与供应商替身；未发送真实短信、实名、签署或企业章请求，未部署、未提交。

## 实现

- 独立模型、019 迁移、ADMIN/OPERATIONS 管理与本人归属；创建只接受指定既有已实名客户及已批准发布模板。正文由服务端实名姓名、脱敏手机、编号和生成时间解析，冻结正文、模板、PDF字节及业务绑定摘要。创建与读取不依赖技术签署开关。
- 本人按正文摘要和版本单独确认本份信息处理；一般 terms/privacy 过期走已有明确同意接口，不能被技术专项同意代替。实名绑定变化后拒绝原文件签署。
- 用印复用原独立策略、两人复核、批准文件和坐标，`TECHNICAL_ACCEPTANCE_SIGNING_ENABLED` 独立于商业签署开关。GET 只读；本人显式 POST sync 或可信回调才核对供应商。
- 停止与新外呼共享技术记录行锁。企业章耐久 claim 先提交，实际 dispatch 在**不自动重试**的 ReadCommitted 事务中再次检查停止/开关并持锁至外呼结束。停止先完成则不调用；外呼先开始则停止等待。外呼后事务失败保留原交易号及已提交 intent，只查原结果，不自动重盖。上传和本人签署URL生成也使用最终互斥门禁。
- 双方完成且真实签后PDF归档才显示 SIGNED；停止不虚构渠道撤销，迟到可信完成仍归档。并发lease、回调重放及归档失败均保留真实状态。归档CAS失败清理未关联文件；进程崩溃遗留通过本资源命名/归属在180天清理时回收。
- 到期必须 ADMIN 显式复核争议/法定留存，再执行清理。未知供应商任务阻断删除。清空独立正文、专项同意、文件关联与客户关联；保留摘要审计和状态事实，共享实名/证书不删。保护相同文件ID及相同物理路径的其他资源引用；已清理关联不因恢复单个 StoredFile 元数据重新可下载。
- PDF 保持原 body/hash 不变，行级标题和成对粗体转样式，首个H1不重复、双签区域同页、页码齐全；脱敏手机号星号保留。

## 文件清单

新增：

- `prisma/migrations/202610160019_technical_acceptance/migration.sql`
- `src/technical-acceptance/{controller,pdf,retention,rules,service,signing}.ts`
- `test/technical-acceptance.test.ts`、`test/technical-pdf.test.ts`
- `test/manual/{technical-ui-server.ts,render-technical-sample.ts,verify-technical-migration.cjs}`
- `technical-acceptance-contract.md`、本报告

修改：

- `prisma/schema.prisma`、`src/app.ts`、`src/auth/access.ts`、`src/common/gateways.ts`
- `src/contract/contract-pdf-artifact-writer.service.ts`
- `src/esign/enterprise-seal/signature-policy.service.ts`
- `src/esign/esign.controller.ts`、`src/esign/esign.settings.ts`、`src/esign/fadada/fadada-esign.provider.ts`
- `src/files/files.ts`、`src/operations/admin.ts`、`src/orders/signature-preparation.ts`

## 测试与证据

TDD 已记录初始接口不存在、商业签署开关耦合、共享文件删除、身份变化、审计期间停止竞态、PDF脱敏星号丢失等失败，再完成对应修复。实际HTTP覆盖本人/跨客户、RBAC/CSRF、独立同意、双人审批、重复请求、并发签署、部分签署、归档失败、乱序/重放、关闭与停止、保留期限及文件权限。

- 早期完整 API：216/216，独立 `technical_acceptance_test`。日志 `.runtime/technical-full-test.log`。
- 审阅修复后受影响套件：26/26（technical、PDF、fadada lifecycle、signature recovery）。日志 `.runtime/technical-final-focused.log`。
- 最终停止互斥及外呼后事务失败回归：技术+PDF 16/16。日志 `.runtime/technical-last-races.log`。
- 脱敏星号呈现额外先红后绿：`pnpm exec tsx --test test/technical-pdf.test.ts` 2/2；pypdf 实际提取包含 `199****0001`，3页。
- `pnpm exec prisma generate` 成功；`pnpm build` 成功；`git diff --check -- apps/api` 无错误。
- 固定来源 manifest 的15文件逐一 SHA256，15/15一致，未修改固定复用源码。

最终全套：**223/223，0失败，191.9秒**，日志 `.runtime/technical-final-full-test.log`。通过 dotenv 读取本地测试连接后强制 DATABASE_URL 与 TEST_DATABASE_URL 均指向 `127.0.0.1:55432/technical_acceptance_test`，使用 `node --import tsx --test --test-concurrency=1 test/*.test.ts`（脚本展开文件列表），所有真实渠道开关关闭。该运行包含最终互斥/孤儿清理/FK修复及PDF星号回归；完整日志中包含2项PDF测试。最后 `pnpm build` 也成功。

## 迁移审查修复

审阅发现019草稿误包含018已有六业务外键的DROP；已全部删除，并在 Prisma schema 显式映射018相同 `NO ACTION` 关系，避免以后重新生成DROP。001–018迁移未修改。

`node test/manual/verify-technical-migration.cjs` 已验证：

- 全空 `technical_full_1792158646154_test`：001→019，六个原业务外键全部保留。
- `technical_upgrade_1792158646154_test`：001→018验证六外键，再→019仍六个。
- 仅修复本任务此前使用未发布草稿的 `technical_acceptance_test` / `technical_signing_ui_acceptance` 六外键及本地019校验记录；没有访问生产或旧业务库。

## HTTP夹具与边界

夹具 `test/manual/technical-ui-server.ts` 强制 NODE_ENV=test、UI_ACCEPTANCE_ENABLED=true、127.0.0.1:55432；单独库 `technical_signing_ui_acceptance`、端口3191，与全套库分离。真实 createApp/auth/CSRF/政策/业务；SDK方法只用合成替身。凭据只写被忽略 `.runtime/technical-ui-acceptance.json`，没有进入报告/Git。最终进程 exec session **74082** 保留给两端；已包含最后PDF修复，迁移无pending。两端自行报告真实HTTP证据；API报告不代称浏览器联调已通过。

样张 `.runtime/technical-acceptance-synthetic.pdf` 使用正式获批模板和虚构参与者，不包含真实身份；SHA256 `1ab19c2249f92119ce47e7a4721013b64d5901d6db880839647e6b8618142dbd`。两个签署坐标位于零起始第2页，渲染生成坐标，非猜测。

恢复备份时，运维必须先隔离恢复环境，重放备份时间之后 `TECHNICAL_ACCEPTANCE_PURGED` 删除审计/墓碑，再开放文件访问；不得直接将清理前完整数据库及文件恢复成对外可访问状态。系统已验证单独恢复文件元数据不能绕过资源清理状态；不宣称历史完整备份天然具有最新删除记录。

真实渠道双签、真实管理员用印、真机页面与正式归档尚未验收。生产开关/模板发布/指定客户创建由主控执行，且不得代客户确认或代实际管理员申请批准本份用印。
