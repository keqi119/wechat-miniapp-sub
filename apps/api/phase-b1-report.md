# B1 延期交车 API 冻结报告

2026-10-16。范围为已签主合同、未实际交车的延期闭环；未实施 B2/B3 换车。仅本地新数据库及合成供应商测试，未部署、提交、执行真实支付或签章。

## 行为与边界

- 新增 `order-changes` 独立模块及迁移 `202610160015_delivery_delay`：追加报价、服务期义务、真实支付分配、有效条款版本。车辆、订阅月数、押金和原始合同/已付账单/支付记录不被覆盖。
- 逐期整数分金额、到期日及计算依据必须明确；延期整体使用新起租日和原月数，恢复原日号的月底锚点。服务期区间截止日不含，整体最后服务日含。
- 报价经不同人员财务复核，客户确认商业 hash 和已填完整正文；独立 AMENDMENT 策略、准备租约、供应商既有任务恢复、可信归档后进入资金处理。报价有效期仅限制首次确认。
- `externalCompensationRequired` 必填且无默认值；需要系统范围外赔付时返回人工财务处理，不能假设已核清或表达为负租金。
- 同期真实净收款沿用并保留分配历史，差额经真实补收/原路退款闭环。未知支付/退款阻断；失败或拒绝退款可重新提交未退余额供独立复核，不能重复创建未知退款。财务阶段可支付原未改价押金，避免循环阻塞。
- 生效仅在协议归档、必要退款和首期实际资金/押金满足后发生。未来服务义务正常保留；早退时按当前有效服务期映射判断未来调整账单，不能把调整单编号误当服务月份。
- 原未完成交接单生效时审计并替代，重新记录真实交车事实；原事实及签署归档不覆盖。未产生供应商任务/租约的 DRAFT 协议正文失配可新报价重新复核确认；未知签署不重开。
- 列表仅摘要。本人及 ADMIN/OPERATIONS 可读已填全文； FINANCE/SUPPORT 的变更详情、通用合同入口及归档文件入口均限制新增 AMENDMENT 个人正文。

## 文件范围

- 数据：`prisma/schema.prisma`、新迁移 `prisma/migrations/202610160015_delivery_delay/migration.sql`。
- 业务：`src/order-changes/{context,quotes,service,finance,obligations,signing,controller}.ts`。
- 文档：`src/contract/delay-template.ts`、现有 PDF writer/render-model/renderer 的 AMENDMENT 扩展、`src/contract/pdf-font.ts` 的生产 TTC 显式字体选择。
- 必要集成：`src/app.ts`、`auth/access.ts`、`billing/billing.ts`、`common/gateways.ts`、可扩展的 esign provider/controller/policy、files、operations、orders、usage 的有效条款/资金/交接/读取守门。
- 回归：`test/delivery-delay.test.ts`、`test/fadada-template.test.ts`、`test/pdf-layout.test.ts`；HTTP 测试监听 helper 及其单测，五处原测试启动点使用 helper。
- 固定 Fadada 复用来源 manifest 中 `adaptation: none` 的 15 个文件 SHA 逐个核对无变化；扩展只在适配层，不改固定来源文件。

## 验证证据

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @chundian/api exec prisma generate` | exit 0 |
| `pnpm --filter @chundian/api db:migrate` | 本地 dev 应用新迁移成功 |
| `pnpm --filter @chundian/api db:migrate --test` | 独立 test 库应用新迁移成功 |
| `pnpm --filter @chundian/api exec tsx --test --test-concurrency=1 test/delivery-delay.test.ts test/fadada-template.test.ts` | 23/23，B1 HTTP/PostgreSQL 16 项 + PDF/template 7 项 |
| `pnpm --filter @chundian/api test` | 业务冻结全套 141/141，0 failed，0 skipped，约 115 秒，串行独占测试库；在下述纯 PDF 排版/字体修复之前 |
| `pnpm --filter @chundian/api exec tsx --test --test-concurrency=1 test/pdf-layout.test.ts test/fadada-template.test.ts test/signature-recovery.test.ts` | 排版/字体最终修复后 18/18，0 skipped；环境变量仅为本次命令指定从本地生产镜像提取的实际 `NotoSansCJK-Regular.ttc` |
| `pnpm --filter @chundian/api build` | exit 0 |
| `git diff --check -- apps/api` | 无 whitespace 错误；仓库现有 LF/CRLF 转换提示 |

先红后绿覆盖了缺失入口、未发布模板、hash/版本/角色/归属、并发报价与幂等、实际退款未完不能生效、首期/押金补收、延期后的早退未来账单、两次延期沿有效日期和实收、失败退款重提、旧交接重出、完整正文及文件 ACL、报价过期后重新复核、签署中断恢复不创建第二供应商任务、DRAFT 正文失配重新报价。PDF 回归使用完整根草稿及合成个人资料，检查同一已确认正文与商业快照，不代表真实法大大签署。

全套首次暴露 `fetch failed: bad port` 的根因是此 Windows TCP 动态端口范围实际为 1024–15000，`listen(0)` 能获得 WHATWG Fetch 禁用端口。最小测试 helper 保留首次系统分配，发现禁用端口后仅关闭测试 HTTP listener 并选择 20000–59999 的可用端口；单测强制 6000 验证恢复，不关闭 Nest/数据库。未修改生产端口或操作系统配置。修复后最终全套通过。自建 `schema-before-b1.prisma` 已移除，临时测试日志不纳入交付。

独立 PDF 视觉复核发现并修复了通用主合同标题、签署区标题跨页孤立及客户文书中的 `Offset intent`。新增回归先重现错误标题与 18 行边界孤立，再验证标题与双方实际坐标所在页一致。writer 显式传 `DELIVERY_DELAY_AMENDMENT`；坐标仍依据实际 PDF 绘制位置生成，不沿用旧页码。

镜像字体复核还真实重现了 PDFKit 直接载入 TTC 时 `this.font.createSubset is not a function`。公共字体 helper 读取字体 magic，仅 TTC 选择镜像中核实存在的 `NotoSansCJKsc-Regular`；独立 TTF/OTF 行为不变。主合同/补充协议与交接均使用该 helper，实际 TTC 下 18 项专项通过。Windows SimHei 缺 U+00A5 与生产 Noto 字体情况不同，不作为生产字形证据。主控要求此纯排版修复只跑相关专项，未伪称修复后重跑完整 141 项。

独立样张代理使用本地镜像 Noto 字体再次生成 12 期合成样张：5 页、142522 bytes、SHA-256 `5d3f1ff636a406ca9291016ea948c76ce184a3994edc1de04b1cf48fb17915ab`。逐页核对标题、人民币符号、12 期服务/资金清单、4 个不重叠签署位置，正文提取与已填正文一致；未访问数据库或网络。本人另复看第 4 页确认正文签署区标题及双方签署线同页。证据留在不提交的 `.runtime/delivery-delay-pdf-qa/`。仍有一个非阻断排版观察：正文第四章标题在第 3 页底、其段落在第 4 页，不影响内容完整或签署位置；未进一步扩大排版改动。

## 发布前提

实际延期模板仍是根提供的未批准、未发布草稿；测试数据库中的发布记录仅合成 fixture。生产启用须由主控取得批准并发布独立 `delivery-delay-amendment` 文案、配置 AMENDMENT 策略及相应授权，应用迁移并部署。生产 provider flags 本轮未更改。

发布时冻结签署主合同归档 SHA 元数据；PDF prepare 阶段再读取原归档 bytes 核验 SHA，并检查原身份/正文绑定是否仍一致。不一致安全拒绝，不能把重新生成的正文当作已经确认。真实供应商、真实退款/付款及客户签章联调不在本次本地证据中。
