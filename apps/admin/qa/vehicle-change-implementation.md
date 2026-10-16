# B2 后台实施与冻结报告

2026-10-16。仅 `apps/admin`；按 `apps/api/b2-contract.md` 定稿实施。**当前为待 API 集成的后台源码，不进入本轮原生签约/登录热修发布。** 本轮没有提交、部署、生产调用、旧库/共享测试库访问、真实付款或签章。H5 冻结包未修改。

## 功能

- 新增“车辆更换”专页及订单详情入口，使用真实 `order-changes.read/write` 权限，按 `kind=VEHICLE_CHANGE` 读取；B1 专页改为 `kind=DELIVERY_DELAY`，不把换车误标成延期。
- 逐单报价包括目标车、预计旧还/新交、客户确认期限、新月费、押金、交接费用、全部原服务期金额/付款日/计算依据、保险责任、无车间隔、资金门槛、交接和取消责任。元输入精确转整数分，日期按上海时区转带时区 ISO。新月费按实际 DTO 必须正数；零额单期减免或交接费用仍可明确填写。
- 外部赔付必须明确选择；本切片不能用负数伪退款或生成系统范围外赔付的可签报价。原期限、原月界、基础里程及里程包不重置；早期月份改价继续服务端拒绝，不做自动分摊。
- 只读展示服务器同一期原款沿用/补收/退款、押金派生补退、真实调整账单/退款原单及阻断。资金门槛明确 BEFORE_RETURN：本次应退、押金调整、交接费用及交付所在期款项核清后还旧车，未来各期仍按约定到期。
- 当前车辆只取实际 assignment，null 明确显示“旧车已交还，换车待交付”，不回退原车辆快照。完整历史分配台账保留各车起止时间和本车仪表；报价展示冻结原/目标身份字符串，不用实时车辆信息覆盖已确认版本。
- 免费来源周期、预占、释放、完成扣减及实际事件/后台登记时刻分开显示；预留不冒充消费，实际完成归周期。付费 B3 不开放，不提供购买、手工加次、标已付或自动扣款。
- 财务独立复核、客户本人确认、AMENDMENT PDF 准备及双人签章、真实资金、旧侧交还、新侧交付分别呈现。后台不代客确认/签署。签署说明采用中性“客户本人签署”，无 H5 服务号入口硬编码，兼容恢复的原生小程序签约入口。
- 两侧交接使用独立实际时间、各车可信仪表基线、7项事实与证据附件；新侧不能沿用旧车读数。完成沿用真实 handover complete；新侧恢复通过 change complete，只有服务端严格 true 能力及角色才显示。已有物理旧还不提供伪取消路径。
- 月台账按 assignment 展示车辆分段及证据；缺端点先补证，不跨车仪表相减。分段月份隐藏旧兼容总起止仪表，避免误导；本期基础/包/费用仍只显示服务端结算结果。OPERATIONS/ADMIN 专有分段补证沿 revision/稳定 key，保留旧证据；财务无此写权限。
- 最终 `recoveryOnly` 已最小适配：完整 DTO 从当前冻结 quote 初值取得，仅旧还/新交日期、交接安排、无车安排、原因和确认期限可改。目标、金额、每期付款日/依据、保险/取消等责任禁改；payload 再逐项校验，不能靠改 DOM 绕过。已完成旧还时间锁定并精确保留服务端秒/毫秒。原资金来源及恢复/前版关联只读展示，不作为客户端资金指令回传。重出仍经独立复核、客户确认、用印和签署；撤回未确认恢复报价明确保留最近已签版本、目标预留与无车事实。`SWAP_ADJUSTMENT` 显示为换车月费补差。

## 模块与必要旧模块适配

新增 `swap.ts`（typed DTO/金额/时间/能力/safe）、`swap-form.tsx`、`swap-facts.tsx`、`swap-ui.tsx`、`swap.css`、`segments-ui.tsx`、`change-list.ts`。`App.tsx` 只接导航/订单入口；`resources.ts` 加权限别名、换车模板选择及严格 SWAP 完成守门；`ui.tsx` 仅导出已有 ReferenceField；`form.ts` 保留 segmentId 月界审核确认；`usage.ts`/`usage-ui.tsx` 接 assignments/segments；`delay-ui.tsx` 只加 kind 过滤。原金额、金融通道、登录与签章核心不改。

每次表单打开只生成一个 idempotencyKey，409/未知重试保留同 key 与草案；写成功后回读真实详情/context/账户。服务端能力必须严格 true，并另查角色与 resource permission；ADMIN 也不能复核自己创建的报价。支持财务/客服只读缺实名正文，未返回历史全文不推断。

## 验证

TDD 已观察红→绿：typed 金额/全原期/日期/外部赔付、strict 能力/双人财务角色、空分配与 safe 投影、ISO 交接不二次转换、真实权限别名/kind过滤、segment-only 月界确认、SWAP 签署完成能力、分段月份不展示跨车兼容端点、新月费正数而其他明确零额允许。

最终验证命令：

- `pnpm --filter @chundian/admin test`：**72/72**（新增 B2 16项，含恢复3项，既有56项通过）。
- `pnpm --filter @chundian/admin typecheck`：通过。
- `pnpm --filter @chundian/admin exec vite build --outDir qa/b2-build/dist`：隔离生产构建通过，不覆盖当前部署 dist 或 `.runtime/admin-login-hotfix/dist`。
- `node apps/admin/scripts/qa-swap-ui.mjs`：**14 组 Chrome 隔离场景，0 JS错误**；390px 无横向溢出。
- `node apps/admin/scripts/qa-delay-ui.mjs`：**8 组既有 B1 隔离浏览器回归，0 pageErrors**。
- `git diff --check -- apps/admin`：通过，仅 Windows 换行提示。

B2 浏览器验证包含三角色动作/隐私正文范围、ADMIN 自审拒绝、24期完整 typed 报价/精确金额与北京时间/默认空期限和赔付回答/409同 key重试、旧还后无车空窗不可取消、新车100→150km独立于旧车80000km并提交7事实、只完成已签侧/409不假消费、两车月段缺终点阻结算、运营独立补证与财务只读、未知渠道阻取消/交接、实际跨周年完成与晚登记时间分开及真实空态。

恢复增量 TDD：先观察缺失 helper 的单测红、浏览器缺少恢复入口红，再实现并通过。恢复初值不采用 live context 改写已签金额；不可变字段篡改会阻断；已还车时间包含秒/毫秒不被分钟输入截断；浏览器核对冻结字段不可编辑、409同 key 重试、撤回恢复报价不认定原换车取消或放车。

证据 `swap-browser-fixtures.json`、`swap-quote-mobile.png`、`swap-recovery-mobile.png`；既有回归证据 `delay-browser-fixtures.json`。截图已人工读取审阅。所有 API 响应被浏览器拦截，合成 QA 标识不是真实签署/支付/车辆/客户状态；没有运行真实后端或供应商成功路径。

本次隔离构建：`qa/b2-build/dist/assets/index-C8zRRLS2.js`，SHA256 `126FC7E6B8C8CC1A7A93BCE3348DC0C7D88B6A5A52CED4D197CB189DA16CD766`；CSS仍 `index-Bjs3Pehh.css`。部署用登录热修 JS 哈希复核仍为 `5411F7C14D8A1F89BB575E205590D76B3FA2CFAD4483DB19C5D5DEA847CD71FF`，未覆盖。

## 待集成事项 / 不宣称完成的边界

只读对齐发现的 `detail.swapAccount` 缺完整投影问题已由 API 同事修复，反馈 detail 与 GET swap-account 逐项 deepEqual 的独立 HTTP 测试先红后绿，包含 orderId/起租锚点/末日/currentAssignment/assignments/能力/阻断。本前端未访问其测试库，也未因此将隔离 UI 验证升格为真实集成完成；仍待统一安排下列本地验收。

API 最终 recoveryOnly DTO 已由实现同事确认固定，准确路径为 `apps/api/b2-contract.md`，恢复增量已纳入上述局部前端验证。尚未与真实 HTTP、原生本人签署或数据库状态变更联合验收，不能把14组 fixture计为真实业务闭环完成。

待真实本地 HTTP 核验：目标 hold 抢占、全部 typed 资金/未知通道、客户确认/真实 AMENDMENT 守门、两侧物理完成事务、按实际日期一次扣次、月段补证/结算竞态、当前分配查询及受控文件读取。不能把本报告的隔离 UI fixture 计为这些业务已验收。正式换车模板必须由主控批准发布，B3 仍保持关闭。

与本轮热修的边界：`.runtime/admin-login-hotfix/dist` 为4653049+单行API默认地址修复，JS `index-BorlHIus.js`，独立冻结且本轮未覆盖。B2 工作只生成 `qa/b2-build/dist`，不得误用于当前旧API静态发布。
