# 企业平台全量自动签实施计划

> 按 executing-plans 在当前会话实施；用户已确认设计并授权施工，不重复请求开始许可。

**目标：** 在原企业 H5 办理晓浪法大大渠道授权，宁达及企业合作商在有效授权下自动签署平台已有电子合同，客户继续逐份本人签署。

**设计依据：** `docs/superpowers/specs/2026-11-11-enterprise-platform-auto-sign-design.md`。

**架构：** 新 scope v3 与独立授权证据记录；原 OwnerAutoAuthority 作为渠道交易与幂等根，新服务处理 v3 生命周期；电子合同策略消费经过核验的证据。v1/v2 和既有业务依据核验不改语义。沿用文件存储、PDF 验签、原 H5、结果查询与回调。

**技术栈：** TypeScript、NestJS、Prisma/PostgreSQL、React/Vite、法大大 API 2.0。

实施中用户补充：订单相关合同客户手签、双方企业自动签；合作协议类合作商逐份手签、宁达自动签。合作协议不要求合作商自动授权，首次/重新用印授权本身依然本人签。

## 全局约束

- 所有写入仅本项目；不使用旧业务库；测试仅 loopback:55432/chundian_test。
- 工作区包含其他线程大量未提交成果，使用项目内逐文件哈希源快照；仅回填本任务文件，冲突不覆盖。
- 保持企业实名、证书、印章；已有合同正文、小程序隐私调用不变。
- 客户手签；首次/重新授权本人签；历史 MANUAL_ONLY 不扩大。原合作业务范围、审批、客户确认、任务快照、幂等和签后验签不降级。
- 先部署授权准备能力，生产自动执行关闭。真实授权由法人本人完成；实际授权全文范围及新自动签验收未通过不启用。

## Task 1：版本化范围与自动签决策

文件：`owner-signing/platform-scope.ts`、`rules.ts`；`electronic-documents/types.ts`、`policy.ts`；对应 API 单元测试。

接口：v3 scope 固定 platformSubjectId、grantorSubjectId、granteeSubjectId/name、applicationBinding 和 `PLATFORM_CONTRACT_SIGNING`；不接受车辆、金额、期限参数。AutoAuthorityEvidence 使用显式策略版本区分平台与受托方。

1. 写失败测试：新授权支持已有合同种类、合作无订单、客户手签、授权文件手签、双方不足降级、未知类型/过期/错主体拦截、旧权限不扩张。
2. 运行定向测试并记录 RED；实现最小策略，运行 GREEN。
3. 保持旧范围规范化/hash 字节语义，新增策略仅从 v3 可信证据进入。

## Task 2：渠道授权证据与生命周期

文件：Prisma schema/migration；`owner-signing/platform-authorization.ts`、`authorization.ts`、`fadada-owner.client.ts`、`provider-evidence.ts`、`scope-options.ts`、`app.ts`；对应数据库集成测试。

接口：原请求、刷新、查看文件、暂停/恢复和撤销路由；v3 服务持久保存实际签后 PDF、文件 hash、证书/印章/法人材料版本、绑定渠道应用与原授权流水。保留原始核验摘要。授权范围的实际全文核定作为可审计运维核验，不要求企业逐单确认。

1. 测试先行：重入幂等、未完成不等于撤销、绑定错误拒绝、证书更换停用、暂停刷新不恢复、撤销先停用/须原因、重复回调不重复文件、材料变动失效。
2. 实现真实 provider 授权页和查询，保全签后文件并验签。实际全文范围未核定时可办理和归档，不可自动派发。
3. 完整证据核验成功自动启用本记录；不存在企业二次启用表单，显式暂停才需要恢复。
4. 新迁移只增加记录结构，不重置旧身份或授权。

## Task 3：接通业务签署与原 H5

文件：`electronic-documents/authorization.ts`、`integration.ts`、`service.ts`；`owner-h5/service.ts`、`owners.controller.ts`；`signing-h5/src/owner/LegalTechnical.tsx` 及视图辅助；API 合约文档。

接口：resolver 提供当事人本企业的新授权；派发前查询双方当前证据，无订单合作合同同样可解析。H5 仍为原企业详情授权 tab，复用现有 PDF 阅读器和样式。

1. 失败测试：撤销/资料改变阻止派发、全局关闭不调用自动签、原业务约束继续生效，客户签署与未知状态恢复不变。
2. 接入 v3 resolver 和刷新，移除仅对新策略的主合同限制；保留旧策略及冻结任务保护。
3. H5 删除 v3 日期/交易范围表单；未授权办理、处理中原交易继续、已授权文件和状态、暂停恢复、撤销原因确认；保留旧历史记录。
4. 测试 UI 状态/动作并构建 API、H5、admin；小程序无需新增包或隐私权限。

## Task 4：核验、审阅与授权准备发布

1. 定向 API 集成和策略、H5 测试、三端受影响构建；记录命令和真实结果。必要时扩展受影响回归，不无限扩财务范围。
2. 一次独立最终代码审阅：关注授权与平台主体分离、实际证据、权限版本、业务约束、并发撤销和客户手签。
3. 逐文件哈希核对并回填本任务改动，保留他人改动；不整仓提交。
4. 复用本项目既有备份、迁移、镜像发布流程；配置 PROVIDER_AUTO_GRANT/scope v3，保持 OWNER_AUTO_SIGNING_ENABLED=false。
5. 线上核对实名/印章/合同计数及新入口，再给法人办理原 H5 的具体步骤。真实授权和自动签验收完成后才另行启用自动执行。

完成标准：实现和授权准备发布有验证证据；未完成外部授权/签署验收明确列为后续步骤，不能称全量自动签已启用。
