# 资格资料更新与本单衔接验证记录

日期：2026-11-06。范围：客户资格内容一致性、当前证件审核及原订单资格衔接。

## 发布结果

- 新平台版本：`20261106-qualification-continuity-v1`。
- API 镜像：`sha256:988fec17b2fdda856f2b368b0c6e1d292d4dc95c8859018860c4c042d582d589`。
- 基于原线上 `20261106-bill-refund-state-v1` 冻结源码，发布15文件变更；根目录未发布电子签变更未混入。
- API 健康、配置核验通过、静态50文件一致、77项迁移完成、维护模式关闭。
- 发布前数据库备份保存在服务器 `/opt/ninda-platform/deploy/20261106-qualification-continuity-v1/execution/database-before.dump`。
- 仅增加资格快照列和订单资格核对表；无真实付款、退款、签署或人工审核替代操作。无需更新小程序。

## 验证证据

所有运行证据在 `.runtime/qualification-continuity-20261106/reports/`。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 资格、风险及有效期回归 | 29/29通过 | qualification-regression.log |
| 后台实际浏览器交互及有效期UI | 2/2通过 | admin-regression.log |
| admin类型检查及构建 | 通过 | admin-typecheck.log、admin-build.log |
| API生成Prisma客户端及完整构建 | 通过 | docker-build.log |
| 独立PostgreSQL迁移与事务集成 | 77项迁移；并发幂等、事务回滚、并发资料变化、旧快照和同内容重传通过 | migration.log、db-integration.log |
| 发布后健康与产物检查 | 通过 | production-deploy.json、production-after.json |
| 目标订单原始记录一致性 | 通过 | order-before.json、order-after.json |
| 根工作树合并 | 15文件CAS校验通过，无冲突 | root-merge-applied.json |
| 根工作树资格回归 | 9/9通过 | root-regression.log |
| 根工作树浏览器交互 | 1/1通过 | root-admin-regression.log |

独立复核发现的三个问题均增加反例并修正：当前证件变化时提交旧附件、同内容重传后的新风控与旧资格原始哈希不一致、文件规范化后跨分类重复。原始合同和风控依据不被修改。

验证边界：初次扩大运行57项旧用例时32通过、25失败，涉及旧夹具缺少既有资产查验接口，以及与冻结线上版本不同的产品/交接行为。没有为适配过期夹具修改业务；仅隔离测试副本补齐相关既有接口后核验29项，借用夹具未发布、未合并。本记录不宣称全仓库测试通过。根共享Prisma客户端旧于线上schema，API类型结论来自隔离Docker生成客户端后的完整构建。

## 目标订单的当前状态与后续办理

订单 `cmw4mr6ti0029s601e103meh3` 发布前后，原订单、风控、客户以及全部资格记录哈希一致。当前资格仍为 `RECHECK_REQUIRED`，明确原因是“驾驶证附件内容已更新，请核对新资料并提交审核”。身份证正面属于相同文件内容重复上传，已不再导致误报。原审核没有被撤销或改写。

在本单“客户资料”中，沿用当前已上传证件提交新资格资料并由工作人员审核；审核通过后，“核对本单更新证件”会提供同一承租人确认及说明，保存本单核对记录即可衔接原订单。该核对绑定当前资格版本、资料内容和原订单依据；身份主体改变、证件失效、旧版本或并发变化均不能放行。订单其他交付条件仍独立校验。
