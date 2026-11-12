# 人工逾期催收增量

依据 20261030 需求、当前账单/渠道收退款及固定参考提交 `db4b48c55890f11f52c4fc52c29242d7c0d150be` 的 finance.service/finance.dto/Collection 模型。承接已授权的“计划后直接施工”，仅当前项目、本机隔离库；不部署旧系统。

## 行为范围

按上海自然日计算逾期，逾期1天即可人工核对：D1=1–3、D2=4–7、D3=8–15、D4=16–30、D5>30。保留 Bill 原有状态，绝不新增 OVERDUE 干扰现有支付。只对实际已发布的 PENDING 账单计算尚未支付金额，DRAFT/REVIEWED 不构成可催欠款；PAID 的已确认退款不自动产生新的应收。

同时检查账单/订单/客户归属、整数分、实收及退款归属、收款对账异常。无法确认的金额标为待核账，不作为已确认欠款，也不允许据“0元”错误结案。支付处理中提示需核对，不伪称已到账。总额溢出明确拒绝，不截断或用浮点近似。

ADMIN/FINANCE 使用专用催收入口。客户联系信息仅用于本案件履约，响应采用显式白名单，不带证件、风控、客户来源、合作商分润或支付请求密钥。SUPPORT/FIELD、客户端和合作商不新增权限。运营角色的客户服务能力保持原范围。

催收是人工记录：电话、短信、微信、邮件、线下及其他方式只记录已发生联系；不发送消息、调用供应商、扣款、生成违约金、利息或新账单。承诺付款仅作跟进事实，不变更 Bill.paidAmount/Payment/Refund。新收费与自动外发不属于本包。

## 数据与事务

新增 CollectionCase、CollectionCaseBill、CollectionAction。每订单最多一个 ACTIVE 案件；关闭后未来又发生逾期可以新建案件，原案不重开覆盖。Case 与 Order 以 orderId/customerId 复合FK绑定，CaseBill 同时绑定本案与同订单同客户的真实 Bill；Action 同案归属，独立sequence和版本。所有金额整数分；状态、非负值、日期有限域、结案元数据及JSON形状有SQL约束。

Case 保存最新一次明确建案/刷新时的来源快照与hash；CaseBill 首次纳入的事实不覆盖。每次刷新和关闭追加不可变动作及规范化摘要，同事务更新版本、来源和审计。读接口另返回当前实际欠款及与最近记录是否变化，读取不写版本或新建案件。即使同一个staff先后办理，也保留明确操作和原因。

写入锁顺序统一 Order → CollectionCase → Bill（按id排序）；与现有收款/退款的Order锁协调。锁内重算当前事实、校验previewHash和revision。当前角色/authVersion先于旧成功键回放，幂等同键同体只回原结果；仅已知唯一竞争可整事务重试。

结案要求：本案已关联账单均已可信结清或明确VOID，当前订单没有新的可催逾期账单，也没有未解决的收款/退款核账异常。不能把人工跟进结果“成功”或客户承诺当结清。付款回调不自动替财务结案；读回显示当前结清候选，财务明确关闭。

## 接口与页面

- `GET /admin/overdue-bills`：分页当前逾期候选，按订单/客户关键词及D1–D5筛选，分别标已确认欠款和待核账阻断，不改变账单状态。
- `POST /admin/collection-cases/preview`：给定orderId，只读核对本订单当前案件/账单/版本/金额及previewHash。
- `POST /admin/collection-cases`：明确建案；输入orderId、revision:0、previewHash、reason、idempotencyKey。
- `GET /admin/collection-cases`、`/:id`：分页及详情；区分最近记录与当前事实，完整动作历史。
- `POST /:id/refresh`：revision、previewHash、reason、idempotencyKey，纳入新出现的本单逾期账单并追加刷新事实。
- `POST /:id/actions`：当前revision/key、联系方式/动作/结果/内容，明确可空的承诺日期/金额及下次跟进；承诺字段成对、正额且不超当前确认欠款，历史动作不可修改删除。
- `POST /:id/close`：revision/key、previewHash和closeReason；锁内重新核账，拒绝未结清与来源变化。

财务工作区新增逾期列表/催收案件，选择真实订单，先预览再建案/刷新。金额显示元、提交分，阶段解释直接展示。所有记录和按钮来自实际状态；未知提交冻结原体原键，成功后读取失败仅重试GET，409保留输入重核。换会话/岗位/案件清除私有事实，桌面和390窄屏验证。

## 施工与核验顺序

1. 根先纯计算红绿：上海日界、D1–D5、已退款不成新债、核账异常不误为可关闭、金额及归属反例。
2. 根统一新增012 schema/migration；fresh隔离schema验证FK/唯一/NULL/形状，生成客户端，再guard迁移本地public，窗口独占。
3. 独立 collections API 包完成专用权限、预览/建案/刷新/动作/结案与HTTP并发测试；锁内付款竞争只保留一个可信结果。无外部供应商调用。
4. 独立后台页面与导航接入，保留原账单/退款/支付入口；验证真实组件恢复、筛选、财务岗位和手机宽度。
5. 主控独立复核限定差异与SHA，更新api契约及阶段证据，再纳入最终四入口联调。

012已在本机隔离库完成生成客户端、53迁移fresh随机schema与public迁移，生产未执行；四文件获独立复核。纯事实3文件17/17通过，当前角色权限专项1/1通过；API和页面仍在施工。具体证据见 `tmp/admin-collections-schema-baseline`、`tmp/admin-collections-facts-implementation-baseline`。本计划不表示催收整体完成，也不替代待确认的可编辑角色权限范围。

并发核对须考虑 Serializable 快照在获取 Order 锁前已建立的情况。先以真实收退款路径构造并发反例；必要时仅在首次催收命令内对 Order 做不改变字段值的更新，以形成序列化依赖并重试整个事务，旧成功键只回放。不能省略实际付款/退款已有的 Order 版本写入来制造反例。依据 [PostgreSQL 应用层一致性说明](https://www.postgresql.org/docs/current/applevel-consistency.html)，单纯等待行锁不会让既有快照自动包含其他事务新提交的数据。
