# 模块化产品与可配置里程实施计划

依据10/31主设计与已确认规则；沿用用户计划后直接施工授权。紧接显式商品阶段，不回滚其发布规则。当前已通过的商品与历史v1行为保留。

## 数据与接口

1. ProductVersion增加`configurationVersion Int default 1`、`baseFeeAmount Int?`、`mileageMonthlyFeeAmount Int?`、`swapPolicy Json?`。v2输入显式携带configurationVersion:2，基础费及里程包月费整数分，合成monthlyFeeAmount由服务端计算，不能任意覆盖。基础费与里程包月费可为0，合计须为正且不超过现有金额上限。租期继续12–120月。
2. 每月包含公里数为非负整数，超里程单价为非负整数分。新产品能源固定充换电自付。`swapPolicy={version:2,period:'TERM',includedCount,extraFeeAmount}`：赠送次数非负整数，额外单次服务费为正整数分；缺字段不能推定赠送次数或价格。v1未配置权益不自动新增。
3. v1快照的序列化结构保持原样，避免改变已发布商品摘要；v2快照附带模块配置与总价。已发布条款不可原位编辑，修改生成新版本。
4. 产品仓库增加明确的停用/重新启用动作（SUSPENDED），保留历史RETIRED。停用关闭新售，重新启用仅恢复仍处于PUBLISHED商品的兼容套餐；下架商品不自动重发。不得修改已成立订单。
5. 新用量规则为USAGE_V2，原USAGE_V1继续1500公里/150分。UsageAccount和UsagePeriod增加nullable `pricingSnapshot Json?`；新账户和每期记录冻结`policyVersion,baseAllowanceKm,excessPriceAmount,sourceHash`。v2缺失/错误快照必须拒绝，不能回退1500/150。原v1历史空值按原明确规则解释。
6. v2资格/风控/合同报价继续经原门禁。USAGE_V2的政策附件须由已批准发布的`usage-policy-v2`模板生成；冻结模板版本、原文摘要及代入本单公里/单价后的正文摘要。历史v1文档不得被重写。上线前完成新模板的具体文本审阅与发布，未发布时明确阻断新v2方案。

## 分工

### A 产品API（admin_scope_audit）

只写products目录及对应产品/商品单元测试；可增加配置纯函数。先红测，再实现v2输入/派生总价/快照/旧v1不变/停启。不写schema、catalog、applications、usage或根文件。

### B 用量API（three_end_audit）

只写usage/policy.ts、usage/rules.ts、usage/usage.service.ts及相关新测试；新增冻结用量配置解析辅助文件。实现USAGE_V2模板快照及验证、初始化账户和每期冻结配置、显示和实际结算读取冻结配置。先测非1500/150、自付能源、0基础公里/0超额单价、整数上限与历史v1、缺失/错hash拒绝；后接隔离库真实结算。不得改变支付、读数、归属、月界、退款或幂等门禁。

### C 产品后台（launch_and_reference_audit）

只写products.tsx、新product-model/CSS/tests及必要导航/流程文案；保持goods不动或仅补只读模块摘要。拆产品工作台与仓库，模块化编辑基础费、里程三项、固定自付能源、合同期换车次数和单次服务费，总价预览清晰，服务端重新计算。旧v1明确展示原规则；新版本草稿采用v2，不能原地改旧版本。金额按分校验，适用车辆/车型继续使用真实ID，不把上牌年冒充车型年款。

### D 主控

统一schema/迁移与客户端生成；applications DTO与USAGE_V2调用整合、catalog公开白名单、小程序方案/里程API兼容v2、真实车型年款补充（另行细化，不伪造字段）、新政策模板草案与契约；审阅和分配唯一DB测试时段。新模板保持草稿等待具体审阅，未执行线上业务。

## 验收

重要业务先红后绿；产品总价和报价来源一致，非默认公里数/单价贯穿商品→申请→方案→合同快照→交付→用量→超里程账单；旧订单/v1原值保持。新价不改既有商品/订单；停启不复活已下架商品。后台和小程序完整构建，原样副本哈希一致；独立审阅后进入下一项换车账本和线下变更。
