# B2 API 实施与验证记录

2026-10-16；工作目录 `D:/wechat-miniapp-sub`；仅新独立本地 dev/test 数据库。未操作生产、未触发真实支付/短信/实名/签章、未发布正式文案。

## 已实现行为

- 迁移 `202610160017_vehicle_change`：车辆分配、月度逐车分段、目标车库存预留、免费/真实付费来源类型、次数预占和不可变消费流水；数据库部分唯一索引限制同订单/车辆活动分配、车辆预留和次数预占。
- 换车报价保留原期限与订阅月，不重置基础1500公里或里程包。旧车与目标车身份分别冻结；原车仍归属本订单，目标车 hold 同时约束申请确认、后台车辆编辑和上下架。
- 双人报价复核、客户全文确认、独立 AMENDMENT 用印审批/签署/可信归档沿现有服务。正式批准换车模板经解析正文、商业 hash 与四签区 PDF 贯通；没有将模板批准当成单笔同意。
- 月租补差 `SWAP_ADJUSTMENT`、押金补退及交接费对应真实账单/退款和付款分配。未知渠道状态、未核清的当前期或押金/费用阻止交接。未来期仍按期主动付；不自动扣押金，不伪造 paid。
- 旧车归还与新车交付各自确认事实、独立签署，完成旧侧后 `SWAP_RETURNED`、currentAssignment=null；新侧完成原子消耗一次实际完成日所属周期的 FREE 优先次数，再切换真实车辆分配和有效条款。B3付费购买入口关闭。
- 每辆车按自己的仪表累计；分段齐备才结算整月一次基础额度。换车间隔、最终退订和午夜月界保持历史冻结。完整无车月仅由两端真实已签交接/分配证据确认零用量，不推算仪表，也不由零用量推导免租。
- 已签后的最小恢复只允许日期、交接/无车安排、原因和有效期变更。新报价/确认/签署保持不可变历史；已经归还事实不可改。原资金来源复用，不生成第二套账单/退款。取消未确认恢复回到**最近已签**版本，资金来源仍可指向更早已核清版本。改价/换目标等超出恢复边界明确阻断，不能报人工处理完成。
- `detail.swapAccount` 和独立 account 使用同一安全投影，包含锚点/历史/capabilities。金融角色仍不能通过 AMENDMENT 正文或文件入口绕过个人文案权限。

## 测试证据

最终执行：

```powershell
$env:NODE_ENV='test'
pnpm --filter @chundian/api test
pnpm --filter @chundian/api build
pnpm exec vitest run apps/api/test/fadada-api-client.spec.ts apps/api/test/fadada-digest.spec.ts apps/api/test/enterprise-seal-policy.spec.ts apps/api/test/enterprise-seal-signing-plan.spec.ts --reporter=dot
git diff --check -- apps/api
```

- API 全套 **175/175**，0 skip，退出0，178.6秒；日志 `.runtime/b2-api-final.log`。
- 其中换车专项 **15项**：本人归属/幂等、完整账户投影、低仪表换车分段、库存竞争、已填正式模板、真实资金门禁、两侧完成幂等、最终退订、多版本恢复/取消、全月无车事实、异议重出冻结身份、周年实际完成扣次、真实收款重放、午夜已结边界。
- 原 A 里程/交接受影响专项31项通过，日志 `.runtime/b2-compat.log`；原单车旧接口只在唯一原分配时安全转交分段事务，多车月份仍拒绝无segmentId申报。
- 新关键缺陷均先见红再绿：详情缺投影、签后日期恢复、修订身份被替换、补差类型误标、午夜已结月误拒、多次恢复取消退回最早版。红/绿日志位于 `.runtime/b2-*.log`，不含真实身份凭据。
- TypeScript build 退出0；diff whitespace检查无错误。
- 15个固定 Fadada 来源文件 SHA 与 manifest 一致；来源协议 Vitest **51/51**，4文件；日志 `.runtime/b2-fixed-source.log`。最初误用tsx运行Vitest spec导致runner错误，随后使用项目Vitest正确运行，上述51项是有效结果。
- 正式批准换车模板的纯合成 PDF 生成回归已纳入175，四签区、正文无占位、正文篡改拒绝。测试仅合成身份/内存供应商，不是渠道联调证明。

## 文件范围

新增 `src/vehicle-changes/{account,assignments,controller,credits,finance,handovers,quotes,recovery,segments,service,view}.ts`、迁移017、`test/vehicle-change.test.ts`、`b2-contract.md`。

配套修改 `prisma/schema.prisma`、app注册、catalog/application/admin库存守门、order-changes报价/资金/安全详情、operations交接、usage按车分段/退订、billing押金调整记账、customer/H5安全展示、SignatureService状态同步、AMENDMENT模板/PDF适配及必要旧夹具。没有修改15固定源文件或根锁文件。

## 发布和能力边界

- 017仅本地dev/test已应用；生产迁移和部署由主控决定。正式模板虽已批准，仍须主控独立发布；每笔报价必须客户再次确认。
- B3购买仍禁用；仅保留经过真实已付来源校验的PAID类型，不提供手工发次数/余额接口。
- 恢复 UI 需要按 `b2-contract.md` 的 `recoveryOnly` 明确锁定不可改字段和取消语义，不能把普通完整报价表单宣称已完成专门适配。
- 本轮主工作区起点仍为H5版本业务服务；已发布原生签约入口在独立工作区完成。主控合入原生入口代码时需保留B2业务差异并跑受影响接线验证，不能用当前B2工作树覆盖已发布的原生入口。
- 已签后的恢复不支持再次改价或换目标车；必须明确人工财务尚未处理，不结束或伪完成变更。本轮不实现超出实收的赔付自动支付。
- 独立native审阅提出的午夜边界和最新已签恢复基线已修，相关证据已反馈；最后审阅结论由对应报告另记。

- 独立待办（主控决定不扩大本B2）：VIN/车牌标准化与非空唯一约束。当前库存守门以Vehicle.id为准，录入重复实车身份须另补迁移和数据核验。
