# 后台重做：指定旧仓库规则核对

日期：2026-10-31。来源为 subscription-Saas 固定提交 `db4b48c55890f11f52c4fc52c29242d7c0d150be` 的 Git 对象，只读，不连接旧库。本文件记录可复用设计，不表示本项目已经实现。

## 产品与商品

源路径：`apps/api/src/product/product.service.ts`、`product/dto/product.dto.ts`、`apps/web/src/app/products/page.tsx`、`apps/api/src/vehicle/vehicle-listing.service.ts`。

- 产品有版本、生效时间及启停；已使用版本保留，激活新版本停用旧版。
- 车型年款采用车型主数据，不另设无关联年款文本。
- 车辆使用费支持固定金额、固定费率、现场报价，具有车型范围、租期上下限及可选车辆价格范围。
- 里程包包含月公里、超里程单价、月加价、说明和启停。
- 旧组合月费为基础费、里程月价、补能月价、权益月价之和；费率路径以当前车辆销售价为基数、向下取整到分。
- 商品为具体车辆和套餐的唯一组合，同车多个商品，可见/推荐/排序独立。新项目必须显式组合发布，不能沿用旧目录“无可见组合就回退到所有适配套餐”的行为。
- 旧表单的12–36月、3.5%费率、1500公里、超里程1元、300kWh/10次电量包、洗车1次只是旧默认值，不自动成为宁达条款。现有宁达1.50元/公里和自付能源等已签约定保持。
- 用户已明确补能权益暂缓，只展示充换电自付；换车赠送次数按合同期配置，升级差价另计。旧系统按月续发通用CAR_SWAP次数不可直接继承。
- 换车必须与变更单及实际交接生效关联，预占/释放/核销幂等；不能仅通用次数扣减就宣称换车完成。

## BAAS

源路径：`apps/api/src/vehicle-baas/vehicle-baas.service.ts`。

- 合同字段包括车辆、服务商、合同号、电池套餐/序列号、起止日期、月季年周期、每周期租金、付款日1–31、宽限日、发票/含税标记、备注和私密附件。
- 状态DRAFT/ACTIVE/SUSPENDED/TERMINATED/ARCHIVED；仅BAAS车辆可启用，同车最多一个ACTIVE，移植时用事务并发保护。
- 月季年分别间隔1/3/12个月；每期直接使用该周期rentalAmount，不将季租金再乘3。付款日超过当月天数取月末。contractId+costPeriod唯一，支持预览及跳过已有期。
- 成本计划SCHEDULED→CONFIRMED，可登记人工PAID或VOIDED；不是渠道到账，不自动付款或生成客户账单。
- 旧实现不裁剪合同起止区间且不折算首末期，应明确预览账期再确认；不凭空生成新折算规则。

## 折旧

源路径：`apps/api/src/vehicle-depreciation/vehicle-depreciation.service.ts`。

- STRAIGHT_LINE/MANUAL/NONE。直线法：可折旧额=基数-残值，基础月额=floor(可折旧额/月数)，尾期加余数，全程整数分。
- 第一期间从起算日至月末但为完整一期金额，其后自然月，共指定月数。
- 策略、试算/计划、确认记录、锁定/作废分离。policyId+costPeriod去重；锁定/确认金额不覆写。
- 残值预测不直接改变折旧基数；不额外移入旧完整投资分析模块。

## 残值与估值

源路径：`apps/api/src/residual-market/residual-market.service.ts`、`vehicle-valuation-review/vehicle-valuation-review.service.ts`。

- 样本记录来源/日期、车型主数据、年款、电池/买断或BAAS、里程、登记日期、地区、价格类型/金额、事故车况及来源证据。
- CSV元转整数分，重复跳过，逐行报告错误，作废留历史。
- 按车龄月分组，每点默认至少3样本，以中位数为残值、P25/P75为区间，保存样本来源；没有自动事故扣减公式。
- 同维度新曲线启用后旧曲线SUPERSEDED；单车要求首次登记日，默认0/6/12/24/36月预测，精确点或线性插值，超范围不外推。
- 人工采用预测不改车价；另行估值复核批准才更新当前售价并留历史及3个月复核日期。
- 以实际代码为准，新样本/曲线须提供modelDefinitionId，不按旧说明从品牌车型自动推断。

## 牌照、维修和保养

- 旧提交只有车辆牌照字段，没有独立牌照资产/收费模型。首步实现档案、归属合作商、当前绑定及不可变绑定历史；租赁收费需另有业务依据。
- 事故和保养可复用已注册AssetOperationsModule/AssetAccountingModule的AssetWorkOrder、车辆限制及成本台账设计。
- 处理流为PENDING→IN_PROGRESS→PENDING_ACCEPTANCE→必要时PENDING_COST_CONFIRMATION→CLOSED；允许等待外部/验收退回，需要费用确认的关单至少有一笔未冲正ACTUAL_COST。
- 保险理赔仅人工登记事实，不伪造渠道赔款成功。保养首步人工工单和下次日期/里程，不能把trigger-maintenance建议事件宣称自动保养闭环。
- 统一补齐本项目RBAC、revision、幂等及事务保护，不能原样移植旧普通PATCH的金额/状态绕过或先查后写的并发缺口。
