# 经营场景分类成本与定价评估

状态：用户已确认，2026-11-13 授权实施。本文件记录本轮决定；与旧方案冲突时以此及用户最新口径为准。

## 页面与输入

顶部经营背景按最多四列展示：名称、预定管理规模 N、出租率 u、产品期限 T（月）、复购率 r（老客户订单占全部预计订单比例）、坏账率 d、每出租月里程、可选目标年化 ROA、依据说明。下方三列卡片分别维护随车辆成本、企业固定成本、业务营销成本，底部自动汇总。数量与期间单位明确，未使用模板不用填写；已添加项目留空是未知，明确 0 是零。

车辆成本：持有月/年（GPS、管理）、出租月或公里（维修轮胎等，同一费用择一）、闲置月（停车）、每订阅周期（订单、交付、回收、整备，单价乘每周期次数）、未来投放一次性（牌照、检测、初始整备）、退出处置一次性。上海新能源牌照模板 12000 元，无法回收，不进资产价值或费率上限；仅逐车明确仍需发生未来投放成本时计入，默认不追计已发生支出。退出处置仅扣退出残值一次。采购价与折耗由资产估值模型处理。

BaaS 缺覆盖月预算、保险缺覆盖年预算单列；保险预算仅补缺失险种/期间，不含已知保费，无已知保单时填写全车年度预算。真实合同/保单按原始覆盖期间取数，预算仅补缺口；逐车预算优先于场景预算。728/1128 是不同电池规格的持有方 BaaS 成本，不擅自映射容量。

企业成本：人员（人数乘综合月人均成本，或数量 1 填月总额）、办公场地、云/软件、财务行政、其他月/年支出。企业一次性投入需发生日期及摊销月数，只分配评估期与该期间的交集。非一次性企业月总额 G / N，闲置也承担。单车停车不重复计场地费。

营销三部分：固定推广总预算 B / 折算周期 L / 覆盖车辆 Nm（默认 N）、每新客订单成本 Cnew、每复购订单成本 Crepeat。固定预算折算月投入持续计入，直至新版本调整，不在 L 月后自动停止。同一费用不同时放入固定推广与每单成本。

## 计算口径

每车年预算周期 q = 12*u/T，剩余 H 月周期 = H*u/T，允许小数。变量营销 = 周期数*((1-r)*Cnew+r*Crepeat)；交付回收等周期成本 = 周期数*单价*次数，复购不自动减少交付回收。此为未来预算平滑分摊，非历史单据重放或精确排程。实际分组产品 months 优先于场景 T；新组默认场景期限，页面显示所用期限。

坏账作用于预计经营主体应收租赁收入：基础、里程、明确归属的其他收入（含经营方收取的客户 BaaS），不含押金、客户直付第三方款项。坏账不降低成本、资产或上限，出租率已经扣过空置损失。展示应收、坏账损失、预计实收。

利润 = H*u*((F+M)*(1-d)-v)-K-(V0-R)。平均资产 A=(V0+R)/2。目标月基础费 = [v+(K+V0-R)/(H*u)+目标年ROA*A/(12*u)]/(1-d)-M。d=1 或 u=0 仍算经营亏损，不能反推价格并给原因。货币整数分，中间精确分数，沿用上限向下取整、反推向上取整规则。基础费上限为定价日残值*3.5%。不引入融资、押金收益或审批阈值。

## 版本和接口约定

旧场景及快照只读兼容。新场景采用 costModelVersion:2；复制旧版本时将各旧总额转换成有名称的独立明细，不能再叠加原总额。旧版本缺少的新参数显式补填，不暗设业务数值。参数仍追加版本，revision/idempotency/RBAC 不变。无需数据库结构迁移。

v2 payload（严格校验）：name, managementVehicleCount, occupancyRate, targetAnnualRoa, expectedMonthlyMileageKm, notes；新增 productTermMonths（3..120整数）, repeatOrderRate、badDebtRate（0..1）, baasMonthlyBudgetCents、insuranceAnnualBudgetCents（可空），vehicleCosts、enterpriseCosts、marketing。不发送旧四类总额与 monthlyManagementBudgetCents。

成本明细：{id,label,basis,amountCents:number|null,quantity:number,allocationMonths?:number,startDate?:YYYY-MM-DD}。每类最多100项，id唯一，quantity为非负有限数。车辆 basis：HOLDING_MONTH、HOLDING_YEAR、OCCUPIED_MONTH、OCCUPIED_KM、IDLE_MONTH、PER_CYCLE、FUTURE_SETUP、DISPOSAL；企业 basis：MONTH、YEAR、AMORTIZED_ONCE，后者必须有 startDate 和正整数 allocationMonths。

marketing：{fixedBudgetCents:number|null,conversionMonths:number,coverageVehicleCount:number|null,newOrderCostCents:number|null,repeatOrderCostCents:number|null}。coverageVehicleCount=null 表示跟随 N。

逐车 override 新增 includeSetupCosts?:boolean（默认false）。已有 oneTimeCostCents/disposalCostCents 覆盖对应合计，保留0语义。结果新增 expectedGrossRevenueCents、badDebtLossCents、collectibleRevenueCents；车辆 input 带 productTermMonths、productTermSource、costBreakdown，包含可读项目/周期/金额/来源，冻结来源附原始预算。

## 验收

T6,u90%,r40%,Cnew500元,Crepeat50元 => 每车年变量营销576元；r0 =>900元。同一场景3/12月分组分别按本组期限计算。固定推广超过折算周期仍有支出。闲置不免除持有及企业费用；已发生牌照费不重计；保险/BaaS实际覆盖不与预算重复。100%坏账和零出租率不崩溃。旧参数/历史快照保持一致。桌面三列，小屏可纵向填报，无页面横向溢出。
