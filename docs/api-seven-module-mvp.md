# 七模块 API 增量：v2.2 与历史兼容

本文件属于 `api-contract.md`，全部路径基于 `/api`。**v2.2已实现并通过独立审阅及254项API回归，生产状态以[实施与发布记录](evidence/ninda-partner-operations-v22.md)为准。** 接口依据[合作商运营维护与只读查看设计](superpowers/specs/2026-10-28-partner-operations-readonly-design.md)及[实施计划](superpowers/plans/2026-10-28-partner-operations-readonly.md)，集中列于本文末尾“v2.2接口附录”。历史说明不恢复旧身份办理或签署入口。

从“共享规则”至“历史换车账户的展示边界”为2026-10-27起的 **v2.1当前实现/历史兼容参照**：其中现有路由已注册，不代表均已在生产开放；实际 DTO 以当前各域 `types.ts` / `schemas.ts` 为准。v2.2明确替代其中的Customer经办绑定前置、合作商业务写入口和合作流程FINANCE硬角色要求；其他领域不因此改变。不要把附录里的新增路由当作已可调用接口，也不要用旧实现中的反馈/签署写能力解释v2.2“只读”。

## 共享规则

- 后台 Cookie + Origin + CSRF；人员每次变更重新校验 `active/role/authVersion`。客户 Bearer；合作商独立 `owner_h5_session`，重新读取有效身份关系和资料版本。不能把客户会话转换为员工或合作商权限。
- 金额为非负整数分，分润比例 `rateBps` 为0–10000整数。退款和冲正沿原账本；人工结算可含有来源的负调整，不由客户端改写现金事实。
- 变更传 `revision,idempotencyKey`（上传端点使用 multipart 字段）。同一命令重试保留键和原内容。409后保留用户输入，读取当前版本，由用户核对后创建新命令；禁止自动重试覆盖。
- 列表使用 `{items,total,page,pageSize}`；历史数组接口（合作商列表、分润规则、合作商结算）保留数组，不虚构总数。页大小不超过100。
- 上传只接受真实类型匹配的 PDF/JPEG/PNG，单文件不超过10MiB；业务文件必须走对应档案/保单/结算/交接权限路径。通用文件下载不能绕过版本、主体和任务分配校验。
- 冻结快照用于已确认订单；已发布产品、已提交档案和保单不得原地改写。新版本不改写旧订单事实。审核拒绝保留原版本，补件产生可追溯新版本。

## 客户与风控

| 方法 | 路径 | 关键约束 |
| --- | --- | --- |
| GET/POST | `/admin/customers/:id/qualifications` | 资格版本列表/提交身份及驾照文件、有效期；只能 ADMIN/OPERATIONS |
| POST | `/admin/customers/:id/qualifications/reviews` | 独立审核，绑定资格版本及资料摘要 |
| GET | `/customer/qualifications` | 当前本人的安全状态、补件说明；不含内部风险细节 |
| GET/POST | `/admin/applications/:id/risk-reviews` | 当前候选方案、资格、信用授权版本；`decision=APPROVED/NEEDS_INFO/REJECTED` |
| GET | `/customer/applications/:id/risk-review` | 当前客户本人申请的安全结论 |
| POST | `/admin/applications/:id/final-plan` | 先生成 DRAFT 候选方案，不直接发布给客户；报价调整需原因 |
| POST | `/customer/applications/:id/confirm` | `revision,commercialHash,ownerSharing:{accepted,lessorHash,noticeHash}`；重新核验当前准入/规则/风控/产品并原子占车 |

确认后创建 `OFFLINE / AWAITING_CONTRACT_REVIEW` 订单、未生效权益和账单草稿。客户 DTO 不包含 `riskSnapshot/revenueRuleSnapshot/creditBand`，也不直接输出内部产品版本实体。

## 合作商与车辆权属

> v2.1实现参照。下述Customer身份关系及`identityBindingId`准入链由v2.2目标替代；历史身份记录保留，不能据本文更新自动转为已审核合作资料或只读访问授权。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET/POST | `/admin/partners` | 查询/创建企业或个人主体 |
| GET | `/admin/partners/:id` | 资料、当前准入、身份关系、车辆及待审权属申请 |
| POST | `/admin/partners/:id/profile` | 修改资料并使旧资料审核失效 |
| POST | `/admin/partners/:id/submit`、`/review` | 提交/独立审核准入版本 |
| POST | `/admin/partners/:ownerId/identities` | 企业代表关系或个人本人关系证据 |
| POST | `/admin/partners/:ownerId/identities/:bindingId/review`、`/revoke` | 独立审核/撤销身份关系 |
| POST | `/admin/partners/:ownerId/vehicles/:vehicleId/submit`、`/review` | 逐车权属证据及独立审核，不允许占用车辆静默换主体 |

`subjectType=INDIVIDUAL` 不传 `creditCode`，关系为 SELF；企业为 ENTERPRISE，必须填写统一社会信用代码并核验代表关系。线下合作协议与身份准入分开；旧 `vehicle-owners` 变更在 MVP 模式下拒绝，指向新合作商模块。

## 产品、组合和权益

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET/POST | `/admin/products` | 列表/新产品草稿 |
| GET | `/admin/products/:id`、`/versions` | 产品版本与组合明细 |
| POST | `/admin/products/:id/versions` | 新建版本 |
| PATCH/DELETE | `/admin/products/:id/versions/:versionId` | 仅草稿可编辑或删除 |
| POST | `/admin/products/:id/publish` | `versionId,revision,idempotencyKey`；验证组合、适用车辆/车型 |
| POST | `/admin/products/:id/versions/:versionId/retire` | 停用后拒绝新确认，已确认订单不变 |
| GET/POST | `/admin/benefit-definitions` | 说明型或次数型权益定义 |
| POST | `/admin/benefit-definitions/:id/versions` | 新权益定义版本 |

组合恰好包含一个 BASE_SUBSCRIPTION，可含 BENEFIT。COUNT 必须指定正整数 `totalQuantity/unit`，DESCRIPTION 不伪造次数；首版整单额度，无月度自动重置。里程及换车沿用专用账本。客户权益状态为 PENDING/ACTIVE/EXPIRED，余额从预占、核销、释放和冲正流水计算。交付生效，实际收车后停止新预占；未完成服务继续有据处理。

`POST /customer/services` 支持 `type=benefit,entitlementId`。后台服务 `status/assign` 需当前工单 revision 及幂等键；运营接单/分派预占一次，完成核销，取消释放。客服不得代替运营完成或取消次数权益工单。

## 保单

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET/POST | `/admin/insurance-policies` | 列表/草稿 |
| GET | `/admin/insurance-policies/:id` | 历史版本与保障信息 |
| POST | `/admin/insurance-policies/:id/versions`、`/renewals` | 批改/退保版本，或关联原保单的新续保单 |
| PATCH | `/admin/insurance-policies/:id/versions/:versionId` | 编辑草稿；退回补件形成新版本 |
| POST | `/admin/insurance-policies/:id/versions/:versionId/submit`、`/review` | 双人审核；逐车、逐要求、逐险种绑定文件核验 |
| POST/GET | `/admin/insurance-policies/:id/files[/:fileId]` | 私有附件上传/授权下载 |
| GET/POST | `/admin/coverage-requirements` | 车型/产品保障要求与版本 |
| GET | `/admin/coverage-requirements/check` | `vehicleId,productVersionId,at?`，缺配置返回 blocker |
| GET | `/admin/coverage-requirements/review-tasks` | 要求变更后的待复核任务 |
| GET/POST | `/admin/insurance-policies/renewal-reminders[/refresh]` | 到期提醒查询/刷新 |

退保审核 `checks=[]`，不能虚构“退保后仍满足保障”的检查。交付按实际时间重新验证生效区间 `[startAt,endAt)` 和当前要求；产品停用不抹去已成立订单的约定，保单失效会阻止新交车。客户仅 `GET /customer/orders/:id/insurance-summary` 读取本人保障摘要；合作商按本人车辆范围读取，不能查看其他投保人的资料或原件。

## 线下档案与工作区

档案种类 `OWNER_COOPERATION/RENTAL/DELIVERY_RECEIPT/RETURN_RECEIPT/TERMINATION`，打印模板相应为 `OFFLINE_*`。生命周期 DRAFT → SUBMITTED → ARCHIVED/REJECTED；独立作废保留历史。纸质租赁合同与终止协议要求 CUSTOMER、OWNER、PLATFORM 三方核验，合作协议要求 OWNER、PLATFORM；交接以实际种类的签署方规则为准。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/admin/workbench`、`/admin/orders/:id/workspace` | 聚合阶段、档案、账单、交接与下一步 |
| GET | `/customer/workbench`、`/customer/orders/:id/workspace` | 本人订单聚合 |
| GET/POST | `/admin/offline-archives` | 查询/建立档案 |
| POST | `/admin/offline-archives/:id/versions` | 新版本 |
| POST | `/admin/offline-archives/:id/versions/:versionId/prepare` | 已审定模板生成中文 PDF；未审定/占位符/主体缺失拒绝 |
| PATCH | `/admin/offline-archives/:id/versions/:versionId` | 草稿元数据 |
| POST | `/admin/offline-archives/:id/versions/:versionId/files` | 上传扫描件并计算摘要、页序 |
| POST | `/admin/offline-archives/:id/submit`、`/review`、`/invalidate` | 提交、逐项逐方独立审核、作废 |
| GET | `/{admin,customer}/offline-archives/:id` | 本角色可见版本详情 |
| GET | `/{admin,customer}/offline-archives/:id/versions/:versionId/files/:fileId` | 绑定档案/版本的私有文件 |
| POST | `/customer/offline-archives/:id/feedback` | `versionId,message,idempotencyKey` |
| POST | `/admin/offline-archives/:id/feedback/:feedbackId/resolve` | 记录处理依据与结论 |

审核绑定主体、车辆、条款摘要、上传字节摘要、文件页序和签章页；上传者/提交者不能自审。租赁档案通过才到 AWAITING_PAYMENT，不将电子签状态伪造为 SIGNED。支付入口及返回缓存参数前均重新检查合同；可信迟到支付通知仍记录真实到账，异常设 `reconciliationRequired/reconciliationReason`，不得顺带放行交车。财务可 `GET /admin/payments?reconciliationRequired=true` 查询完整队列，工作台 `counts.paymentExceptions` 提供计数。

| 方法 | 异常到账路径 | 用途 |
| --- | --- | --- |
| GET | `/admin/payments/:id/reconciliations` | 独立核对记录及 `allowedResolutions`，仅 ADMIN/FINANCE |
| POST | `/admin/payments/:id/reconciliations` | `revision,idempotencyKey,resolution,note,evidenceFileIds`，冻结原到账事实 |
| POST | `/admin/payments/:id/reconciliations/:reviewId/review` | `revision,idempotencyKey,decision,note`；提交人和材料上传人不得复核 |

`APPLY_TO_BILL` 只支持押金、订阅账单，要求原账单与未退实收完全匹配、没有未解决的重复到账、订单和合同仍可履约。其他费用必须完整原路退款后选择 `REFUNDED`，不通过简单清标记冒充补发里程或换车权益。`REFUNDED` 仅确认渠道已全额退款的事实，不发起退款。审核和退款仍使用已有独立权限与回调校验；已全退且核对完成的额外到账不永久阻断正常保留款项的交车就绪。

车辆创建、修改、上下架及线下交接创建、修订、发布、完成均携带 `revision,idempotencyKey`。新建车辆版本为 0；交接创建使用订单版本，其余使用交接版本。VIN 统一大写、去首尾空格并验证 17 位，数据库对规范化 VIN 唯一约束；过期版本返回 409，原请求重试返回原结果。合作商详情的 `vehicleBindingRevisions` 提供逐车权属版本，供独立转绑复核使用。

FIELD 固定 `/field.html`，原任务分配、改派、取消保留；纸质回执上传和下载走 `/admin/field-tasks/:taskId/offline-receipt/*`，受当前 assignee、任务 generation、查验版本限制。实际收车使用车辆收回事实命令，与正式还车确认及财务关单分开；收车立即阻止未来未履行期的新收费，不清空真实已付金额。实际交车仍要求客户确认查验、当前纸质回执审核、资金及保障门禁全部通过。

## 分润与人工结算

> v2.1实现参照。当前部分操作仍受ADMIN/FINANCE硬判断；v2.2目标改为运营具体业务能力和独立复核，不自动为既有FINANCE或OPERATIONS账号扩权。金额、来源、退款及冻结版本规则继续保留。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET/POST | `/admin/partner-revenue-rules` | 按 ownerId 查询/新规则 |
| POST | `/admin/partner-revenue-rules/:id/versions` | 规则新版本 |
| POST | `/admin/partner-revenue-rules/versions/:id/submit`、`/review` | 提交/财务独立审核 |
| GET/POST | `/admin/partner-settlements/accounts/:ownerId` | 收款账户版本 |
| POST | `/admin/partner-settlements/accounts/:id/review` | 账户独立审核 |
| GET | `/admin/partner-settlements/sources?ownerId=&start=&end=` | 真实收入/退款来源、已使用额度、冻结 ruleVersionId |
| GET/POST | `/admin/partner-settlements` | 列表/人工对账草稿 |
| POST | `/admin/partner-settlements/:id/submit`、`/review` | 对账提交/独立审核，冻结账户及明细 |
| POST | `/admin/partner-settlements/:id/payments` | 登记实际线下付款及证明，不执行付款 |
| POST | `/admin/partner-settlements/:id/payments/reconcile` | 独立核对付款证明 |

规则含 RATE/FIXED_MONTHLY/CUSTOM、范围/有效期、计提基数、扣减、退款规则、周期与费用责任。押金不得作为分润收入；同来源跨周期不得超额使用。退款负调整关联原已付结算，不能直接改历史正数。合作商异议未解决不得冒充已完成。

## 合作商查询及反馈入口与人员（v2.1当前实现）

合作商前缀 `/owner-h5/owners/:ownerId`：`GET workbench,orders/:id/workspace,offline-archives,offline-archives/:id,vehicles,policies,revenue-rules,settlements,settlements/:id`。文件路径 `offline-archives/:id/versions/:versionId/files/:fileId`。v2.1当前仍注册 `POST offline-archives/:id/feedback` 和 `settlements/:id/feedback`，允许反馈本人范围内已发布资料，**因此当前实现并非v2.2要求的严格业务只读**。v2.2目标在服务端关闭这些合作商业务写入口，旧会话和旧链接也不能继续调用；客户本人的反馈接口不在此次关闭范围。当前身份关系校验将由独立的只读访问授权版本校验替代，逐主体隔离继续保留。

订单及逐单文件读取还必须匹配确认方案时冻结的 `ownerDataConsent`：客户、实际出租方、出租方身份摘要、告知文本摘要及同意时间。合作协议不替代逐单资料共享告知。对合作档案的未处理反馈按车辆范围阻断新履约，历史已开始订单的正常应付款仍按专用资金规则处理。

后台固定 ADMIN/OPERATIONS/FINANCE/SUPPORT/FIELD。ADMIN 管理 `/admin/users`：列表、创建、详情、PATCH姓名，以及 `POST /:id/role|disable|enable|reset-password|revoke-sessions`。人员命令绑定版本和幂等键，使用服务端专用 HMAC 摘要；密码不入审计和响应；禁用、改角色、重设密码、撤销会话提升 authVersion。禁止降级/停用最后一个管理员，不能锁死自身。

财务只读已审核合作协议用于对账，不能读客户身份证明、风控底稿或替运营审核合同；客服只读脱敏摘要；FIELD 无全局订单搜索、财务和合同审批。真实支付/退款与渠道签署验收另需明确范围，本地合成验收不得描述为真实交易成功。

通用 `/admin/files/:id` 同样检查材料的领域归属：FINANCE/SUPPORT 不可通过 `evidence` 别名读取交接原图、客户确认附件或实际收车凭据。客服工作区不返回账单金额；客户和合作商只看到已发布或已付账单，没有实际待付账单时不显示付款主动作。

## 客户方案确认的公开字段

客户申请 `finalPlan` 投影包含 `usagePolicyVersion`、`creditRevision`、`creditRuleVersion`，供页面核对已冻结规则及当前核验版本；客户不读取 `creditVerificationId`、`creditBand`、内部调价理由或候选方案审核字段。确认页使用客户信用接口的 `verificationCurrent`、`canConfirmFinalPlan` 以及公开版本匹配，仍须独立同意出租方资料提供并确认完整商业方案；确认写接口继续重新检查归属、版本、信用授权和风控，不信任客户端就绪提示。

## 历史换车账户的展示边界

`GET /customer/orders/:id/swap-account` 返回只读 `contractMode`（旧无模式记录为 ESIGN）。OFFLINE 的 `cycle.freeAvailable=0`，不隐含赠送新换车次数；`canRequest` 和 `canPurchase` 与写操作共同使用订单模式及 `MVP_V2_ENABLED` 门禁。既有预占、已消费、实付购买及流水事实仍返回，不因关闭新增业务而清空。客户入口按当前订单及账户模式隐藏 OFFLINE 新换车入口，服务调用也先核对最新能力；历史记录查询保留客户归属校验。

## v2.2接口附录：合作运营与手机号只读查看

> 实施进度更新（2026-10-28）：本附录对应代码已实现，独立审阅修复已通过；最终API回归254/254通过。生产切换另见[实施与发布记录](evidence/ninda-partner-operations-v22.md)。

本附录于2026-10-28依据用户确认基线细化路径、DTO和能力键。新增路径和修改后的现有路径已按R1–R6实现并完成本地验证；真实人员、短信和业务资料验收另行记录，不从合成测试推断。

### A. 数据主体、版本与共同约束

- `VehicleOwner`及原车辆、档案、分润、结算、订单ID继续使用。合作资料中的联系人/签署代表是线下业务事实；`Customer`是租车客户；`PartnerPortalAccess`是外部只读范围授权，三者不能因同手机号自动关联权限。
- 新合作资料不接收`customerId/identityBindingId`作为准入条件，也不要求H5登录、网上实名或查看账号已开通。保留主体、签署代表及必要授权、车辆出租权限、协议范围和条款的真实材料核验；个人主体不强制企业代码。
- 商业主体版本、合作资料草稿/提交批次版本、只读访问`accessVersion`分别管理。纯查看手机号/查看授权变化不改变合作就绪和商业摘要；普通联系资料与合同中冻结的出租方联系方式应区分。真正修改文书内联系方式按新业务版本处理，不倒改已签文件、旧订单或旧同意。
- 后台写命令均为严格DTO，携带当前资源`revision`和`idempotencyKey`；未知字段/未知能力拒绝。同键同内容重放原结果，同键不同内容409。部分更新省略字段保留原值，显式`null`仅用于可空字段；不能由schema默认值清空未提交字段。
- 仍使用当前有效员工、逐资源归属、权限版本、事务锁/隔离、独立复核和文件用途检查。前端就绪/权限显示不代替写事务重验；材料上传人、经办/提交人均不得复核同一事项，ADMIN也不豁免。以内部稳定人员标识及账号归属执行回避，同一实际人员不能借另一员工账号自审；映射由ADMIN核实维护，不根据姓名或手机号推断，不为此额外采集身份证。历史归属未确认先核对，不能仅以两个staffId不同放行。

### B. 后台合作资料目标API与DTO

目标仍复用各域档案、车辆和规则ID，由后台统一办理页关联，不要求经办人手工寻找内部ID。下表`cooperation-draft`是本附录新增的聚合目标路径；其余标为“复用”的路径仍需修改实现。

| 方法/目标路径 | 目标输入及输出 | 能力 |
| --- | --- | --- |
| `GET /admin/partners`、`GET /admin/partners/:ownerId`（复用） | 主体及合作资料状态；详情新增`cooperation,portalAccessSummary,allowedActions`，不再以已注册客户候选作为办理下一步 | `partner.cooperation.read` |
| `POST /admin/partners`、`POST /admin/partners/:ownerId/profile`（复用） | 保留企业/个人主体字段及命令版本；法定资料、普通联系资料、查看账号分别保存；不得附带伪造审核状态 | `partner.cooperation.write` |
| `GET /admin/partners/:ownerId/cooperation-draft`（新增目标） | `CooperationDraftDTO`，含缺项、领域草稿引用、当前提交批次及逐项完成状态 | `partner.cooperation.read` |
| `POST /admin/partners/:ownerId/cooperation-draft`（新增目标） | `{revision,idempotencyKey,patch}`；保存待补业务资料，缺协议/规则/查看手机号均可保存草稿 | `partner.cooperation.write` |
| `POST /admin/partners/:ownerId/submit`（复用并替换旧身份前置） | `{revision,idempotencyKey}`；读取该草稿并冻结服务器验证后的领域版本/摘要；返回`submissionId,submissionRevision,submissionHash,status` | `partner.cooperation.write`及本次实际执行领域提交所需的各域write能力 |
| `POST /admin/partners/:ownerId/review`（复用） | `{revision,idempotencyKey,submissionId,submissionHash,decision,reason,domainReviews}`，`decision=APPROVE|REJECT`；按冻结批次独立复核 | `partner.cooperation.review`及批次内各项审核所需的领域review能力 |
| `/admin/partners/:ownerId/vehicles/:vehicleId/submit|review`及原档案/规则命令（复用） | 可由统一办理页调用；继续保留各域证据/版本/事务与审核记录。分步完成时不能提前宣称整套合作已就绪 | 相应领域经办/复核能力 |

`CooperationDraftPatch`允许字段为：

普通联系资料更新使用 `contactKind=ORDINARY` 时必须带当前 `contactRevision`；该版本与合同业务 `revision` 分离，缺失或过期不会覆盖当前资料。合作批次中的规则引用由服务器额外冻结所属规则的版本及当前已批准版本指针，规则被替代后须重新提交批次。退回核验允许如实填写 `false`，批准仍须全部适用核验项通过。

```ts
{
  representatives?: Array<{
    name: string;
    role: 'SELF' | 'LEGAL_REPRESENTATIVE' | 'AUTHORIZED_SIGNER';
    authorizationEvidenceFileIds: string[];
  }>;
  subjectEvidenceFileIds?: string[];
  vehicles?: Array<{ vehicleId: string; evidenceFileIds: string[] }>;
  cooperationVersionId?: string | null;
  revenueRuleVersionIds?: string[];
}
```

这些字段可为空保存草稿；非空文件和领域ID必须来自本合作商、正确用途且当前员工有权读取的记录。代表人角色来源于真实材料，`SELF`只适用于个人主体；不能因选择某角色自动认定授权已核验。草稿保留真实协议附件、范围、规则版本，关联引用不等于已归档/已批准。依设计第3节及计划R1，合作尚未整套APPROVED时可准备车辆提案、合作协议和规则草稿；草稿命令不能继续以旧`approvedPartner`或已归档合作协议作为循环前置。草稿仅为准备资料，最终生效及可申请仍须各领域核验齐备。

复用的`POST /admin/partner-revenue-rules`及`POST /admin/partner-revenue-rules/:id/versions`目标草稿输入为`{ownerId,revision,idempotencyKey,terms,evidenceFileIds}`。`terms`使用原规则字段集合，但草稿阶段`cooperationVersionId,vehicleIds,validFrom,validUntil,method,rateBps,fixedMonthlyAmount,customAgreement,basis,deductions,refundRule,cycle,expenseResponsibility`均允许缺省/可空，`evidenceFileIds`可为空；已经填写的ID、枚举、整数分/bps、日期和文件仍严格校验。返回草稿版本及`missingFields:[{code,section,message}]`。这明确替代v2.1创建规则时全部必填及必须先有归档协议的校验，支持已知20%而basis留空；不是让提交/复核接受缺项。提交及生效复核恢复完整规则DTO、当前协议/车辆范围、全期覆盖及证据校验，不完整版本不能成为`currentApprovedVersionId`或订单规则快照。

`CooperationDraftDTO`为`{ownerId,revision,status,representatives,subjectEvidenceFileIds,vehicles,cooperationVersionId,revenueRuleVersionIds,missingFields,submission,allowedActions}`；`missingFields`项为`{code,section,message}`；`submission`为空或`{id,revision,hash,status,submittedBy,submittedAt,domainVersions,completedActions}`。`domainVersions`是服务器冻结的主体/权属/档案/规则ID、revision和内容摘要。`domainReviews`是与该冻结集合一一匹配的复核输入：`{domain:'SUBJECT'|'VEHICLE'|'ARCHIVE'|'RULE',resourceId,revision,review}`；各`review`使用对应领域的严格核验DTO，档案仍要求真实逐方/签章页检查。客户端不得上传`APPROVED/ARCHIVED`状态代替复核命令，不能漏项或加入批次外对象。

聚合入口不能扩权：例如批次含RULE审核时除cooperation.review还必须具备`partner.rules.review`，不能用合作审核能力替代规则审核；实际执行规则创建/提交还需要rules.write。所有领域均保留自身材料、经办/上传人回避和版本检查。按主体/车辆/协议/规则依赖推进，原子处理或分步处理均不得在完整批次成功前返回整体已就绪；未知结果重试沿用原键，已完成步骤不重复写入。

目标`approvedPartner(tx,owner)`读取当前纸质合作资料核验版本；不再读取Customer绑定来证明合作资格。只读授权未开通、未登录或停用不影响业务就绪。可申请仍检查主体核验、车辆权属、当前有效归档协议和核准规则覆盖车辆及完整拟租期、产品有效和无占用；保险仍在交车时检查。缺项草稿不得通过审核或产生虚假可申请状态。

原`/identities`及其`/review|revoke`是v2.1账户绑定流程，不是目标办理步骤；现有记录/审计保留。v2.2合作业务命令不得通过旧身份路由间接获得新准入或只读授权，也不能要求先补一条Customer身份关系。

### C. 合作运营动作能力目标

固定岗位角色保留，但下列**目标能力键**由ADMIN逐员工明确配置，服务端通过`requirePartnerCapability(tx,actor,capability)`读取当前授权。角色名称、前端按钮、历史FINANCE岗位或能登录后台均不能代替能力；未知键拒绝。读能力不隐含写或复核，复核能力不隐含经办或停用。

| 业务域 | 目标能力键 | 范围 |
| --- | --- | --- |
| 合作资料/车辆/合作档案 | `partner.cooperation.read`、`.write`、`.review` | 读取必要合作资料；草稿/上传/提交；独立复核，保留原领域门禁 |
| 只读查看授权 | `partner.portal.read`、`.write`、`.review`、`.disable` | 掩码读取；登记/更换/提交；独立启用；紧急停用，四者独立 |
| 分润规则 | `partner.rules.read`、`.write`、`.review` | 已有规则/版本接口及本域附件；编制/提交与审核分离 |
| 收款账户 | `partner.accounts.read`、`.write`、`.review` | 完整账户及账户凭据读取；账户提交；独立复核 |
| 结算单/来源 | `partner.settlements.read`、`.write`、`.review` | 真实来源及结算读取；编制/提交；独立复核 |
| 实际线下付款 | `partner.payments.read`、`.record`、`.review` | 实付记录/凭据读取；登记已经发生的付款；独立核对，均不发起银行付款 |

表内省略前缀的`.write/.review`须拼接同一行完整前缀，例如`partner.accounts.review`；不支持通配能力。上传、下载及通用旧文件入口也必须读取对应领域能力：RULE对应rules，ACCOUNT对应accounts，SETTLEMENT对应settlements，PAYMENT对应payments。仅获结算read不自动取得完整账户号，缺accounts.read时账户必须脱敏。普通OPERATIONS、SUPPORT、FIELD和外部查看账号不能因看见合作菜单而读取完整财务原件。

员工目标接口新增`POST /admin/users/:id/partner-capabilities`，仅ADMIN可用，输入`{revision,idempotencyKey,capabilities:string[],reason}`；能力为精确全量集合，空数组为撤销，未知/重复值拒绝。现有员工详情及本人`/admin/auth/me`新增`partnerCapabilities`用于UI，服务端不信任请求携带的该数组。变更提升`authVersion`并撤销旧会话；保持最后管理员保护。旧FINANCE历史操作和账号保留，只有管理员明确配置后才取得目标合作能力，不自动映射到OPERATIONS或赋全权限。ADMIN参与业务也须具备相应能力且不能自审。

原规则、账户、结算、付款路径继续复用；目标替换`requireFinance/reviewer()`等硬角色判断，并在旧入口、专用附件和实际服务命令全部执行同一能力规则。非合作的客户支付、退款、异常到账等专用授权与真实渠道事实不因本表扩大。

运营承接线下反馈的新增目标路径为`POST /admin/offline-archives/:id/feedback`和`POST /admin/partner-settlements/:id/feedback`：输入`{revision,idempotencyKey,message,source:'PHONE'|'OFFLINE'}`，档案另必填`versionId`。前者需要cooperation.write且限合作协议，后者需要settlements.write；记录实际内部经办人及来源，不伪造外部客户/合作商在线提交。处理历史反馈仍走现有`/resolve`命令及相应业务能力，不因外部写口关闭自动解决争议。

### D. 查看手机号授权目标API

每家首版仅一个当前主要查看授权；同一手机号可经分别批准拥有多家范围。管理路径以ownerId精确限定一家，不能提交额外ownerId扩权。未配置状态为`current:null`，不阻断合作草稿或已满足条件的新订单。

| 方法/新增目标路径 | 严格输入 | 输出/语义 |
| --- | --- | --- |
| `GET /admin/partners/:ownerId/portal-access` | 无写参数 | `PortalAccessDTO`；需要portal.read |
| `POST /admin/partners/:ownerId/portal-access` | `{revision,idempotencyKey,displayName,mobile,reason}` | 保存候选，手机号规范化/受保护存储；需要portal.write，不发短信、不赋权 |
| `POST /admin/partners/:ownerId/portal-access/submit` | `{revision,idempotencyKey,candidateId}` | 冻结候选为SUBMITTED；需要portal.write |
| `POST /admin/partners/:ownerId/portal-access/review` | `{revision,idempotencyKey,candidateId,decision:'APPROVE'|'REJECT',reason}` | 需要portal.review；独立批准后原子更新当前授权并提升accessVersion，退回保留依据 |
| `POST /admin/partners/:ownerId/portal-access/disable` | `{revision,idempotencyKey,reason}` | 需要portal.disable；立即停用当前授权并提升accessVersion，留审计，无须等待复核 |

`PortalAccessDTO`：

```ts
{
  ownerId: string;
  revision: number;
  current: null | {
    id: string; accessVersion: number; status: 'ENABLED' | 'DISABLED';
    displayName: string; maskedMobile: string;
    reviewedBy: string; reviewedAt: string;
    lastLoginAt: string | null; disabledAt: string | null;
  };
  candidate: null | {
    id: string; revision: number; status: 'DRAFT' | 'SUBMITTED' | 'REJECTED';
    displayName: string; maskedMobile: string;
    createdBy: string; submittedBy: string | null; reviewReason: string | null;
  };
  allowedActions: Array<'SAVE' | 'SUBMIT' | 'REVIEW' | 'DISABLE'>;
}
```

保存/提交候选不替换当前有效授权、不改变当前accessVersion、不撤销当前挑战或会话；换号批准才原子切换并撤销旧号码对应范围。若旧号码不可信，有停用能力的运营应直接停用，无需等待新号码审核。停用后没有直接enable接口，重新启用须建立/提交候选并独立复核，使用更高accessVersion。生效替换、停用、重启或有效范围变化不可重置/复用旧accessVersion；改回原号码也如此。复核绑定当前候选版本及其经办人，人员/版本已变时拒绝。已提交候选不可原位编辑。手机号明文仅出现在获授权的写入请求和受保护存储/短信处理，不进入普通日志、导出或公开响应；只读DTO始终掩码。

### E. 独立portal认证、挑战与会话目标

新增`PartnerPortalSession`及登录挑战，独立于CustomerSession、AdminSession和旧OwnerH5Session。可以复用现有Cookie名称及`/owner/`路径，但不得将旧Customer依赖会话解释为新portal会话；目标上线时旧会话须重新认证或返回401。存储仅令牌摘要，使用Secure/HttpOnly/SameSite及期限限制。服务号入口和认证不赋予企业签署、实名或后台权限。

| 方法/复用目标路径 | 输入/输出 |
| --- | --- |
| `GET /owner-h5/config` | `{enabled,entryUrl,mode:'PARTNER_READONLY'}`；不得返回手机号或企业范围 |
| `GET /owner-h5/legal` | `{documents:Array<{id,type:'terms'|'privacy',version,title,content,contentHash}>}`；不恢复企业电子签同意要求 |
| `POST /owner-h5/auth/sms/request` | 输入`{mobile}`；统一输出`{accepted:true,challengeId,expiresInSeconds,resendAfterSeconds}`，无ownerId、企业名或授权存在标志 |
| `POST /owner-h5/auth/login` | `{challengeId,mobile,code,consents}`；consents沿用当前terms/privacy版本主动同意结构，记录到独立portal主体，不挂伪Customer；成功输出`PortalSessionDTO`并设置独立会话Cookie |
| `GET /owner-h5/auth/me` | 重新核对当前授权范围，输出`PortalSessionDTO`；无剩余有效范围时401 |
| `POST /owner-h5/auth/logout` | 严格空对象`{}`，当前会话+Origin+CSRF；撤销本次会话并清Cookie |

`PortalSessionDTO={mode:'PARTNER_READONLY',viewer:{maskedMobile:string},scopes:Array<{ownerId:string,accessVersion:number}>,csrfToken:string,expiresAt:string}`。不包含Customer ID、OpenID、供应商身份、后台角色或业务写能力；scopes只在认证成功后返回。各合作商显示名从被授权列表读取，不能把一家联系人姓名当作多家共同签署人。

挑战规则：

1. `challengeId`为不可推断句柄，绑定规范化手机号、短信通道挑战及**发码时**获准范围`[{accessId,ownerId,accessVersion}]`的排序摘要、有效期、尝试次数和单次消费状态。未授权号码仍返回同形状随机句柄和中性响应，不发业务邀请短信、不暴露企业信息；该句柄不能登录成功。
2. 复用现有短信通道及频控，验证码不写日志，失败次数须实际计入。登录必须同时携带challengeId、mobile、code，不能以“该手机号最新验证码”代替对应挑战。验证码跨challenge、重放、过期、超尝试次数均拒绝。
3. 短信验证后，在事务内再次检查挑战未消费、手机号一致及发码时整组授权版本仍一致，再一次性消费挑战并签发会话。换号、停用、重启、范围变化以及发码后新增授权，均不能凭旧挑战取得新的有效范围；版本不符返回中性登录失败并重新发码，不恢复原挑战。
4. 会话保存认证时的范围/访问版本快照；`requirePartnerReadAccess(tx,session,ownerId)`每次读取当前授权并比对。撤销A时立即拒绝A，B仍有效则会话只保留B；不能从动态同号查询给旧会话自动加C。若无有效范围则401，禁止把任意授权异常降级为旧模式。
5. 短信请求/登录仍要求精确Origin，登录成功后的认证写操作要求CSRF；所有响应no-store。客户Bearer、后台Cookie、OpenID或手机号相同不能换取portal会话。GET及会话续读不发送短信、不调用签署供应商。

### F. 合作商严格只读路径白名单目标

下表是**完整业务GET白名单**；每项均须当前portal会话和逐owner授权。E节另允许匿名GET config/legal用于登录引导，auth/me必须有当前有效会话。H5客户端使用同一列表，不保留可直接调用的业务写方法。HEAD若支持，仅等同相同GET的授权且不输出主体；OPTIONS仅作受限协议协商，不读取业务，不能绕过业务方法白名单。

| 允许GET路径（`/owner-h5`之后） | 白名单输出边界 |
| --- | --- |
| `/owners` | 获授权合作商`{ownerId,name,subjectType,status,admissionStatus,accessVersion}`；业务状态为真实值，不因可登录变为APPROVED |
| `/owners/:ownerId` | 主体公开合作信息、平台联系电话、真实合作状态、`mode:'PARTNER_READONLY'`；不返回旧实名/证书/用印能力对象或完整银行账户 |
| `/owners/:ownerId/workbench` | 本范围已发布订单/合作概览、状态统计与只读资源导航；不提供可执行付款/上传/审核/反馈的nextAction |
| `/owners/:ownerId/orders/:id/workspace` | 该出租方项下、客户逐单共享同意有效的必要订单/已发布账单摘要；不返回客户证件、风控、完整内部计划或其他合作商信息 |
| `/owners/:ownerId/vehicles` | 本合作范围已批准车辆关系下的车辆摘要；不得用任意vehicleId扩大范围 |
| `/owners/:ownerId/policies` | 本车辆范围已批准保单的保障摘要、有效期间及状态；无原始保单/投保人隐私原件 |
| `/owners/:ownerId/offline-archives` | 本范围可读档案摘要；不返回草稿材料 |
| `/owners/:ownerId/offline-archives/:id` | 可读已归档及失效历史版本的安全投影，失效明确标识；不是重新批准 |
| `/owners/:ownerId/offline-archives/:id/versions/:versionId/files/:fileId` | 同时绑定owner/档案/版本/文件和客户共享条件的私有已发布文件；原始证照、内部offline-source及存储路径不开放 |
| `/owners/:ownerId/revenue-rules` | 本范围已批准约定摘要、适用车辆和期间，不返回待审草稿/内部复核备注；不将比例自行解释成应付金额 |
| `/owners/:ownerId/settlements` | 本范围APPROVED/PAYMENT_RECORDED/PAID/OFFSET_REQUIRED状态摘要；草稿、待复核金额不可读 |
| `/owners/:ownerId/settlements/:id` | 已复核金额、可见明细、实际付款/核对状态、掩码账户和已有反馈/处理结果；不返回完整账户及内部凭证 |

列表分页及允许的vehicleId/orderId/kind筛选沿原严格范围校验；不能传内部审核状态来扩大可见集合。业务DTO不提供可写capability；复用字段时所有`canUpload/canReview/canPay/canFeedback/canSign`均为false，安全导航仅表示可读资源。GET不得触发refresh、sync、供应商查询、签章、付款、审批或“已读即确认”。

唯一允许的POST为E节`sms/request`、`login`、`logout`。其余已存在合作商H5业务写路径对**新旧会话和旧链接**均拒绝，包括：

- `/owners/claim`、`/owners/:id/verification|refresh|seal`。
- `/owners/:id/authorities`及`/:authorityId/refresh|resume|switch|revoke`。
- `/owners/:id/contracts/:taskId/sign|sync`、`/handovers/:taskId/sign|sync`。
- `/owners/:ownerId/offline-archives/:id/feedback`、`/settlements/:id/feedback`，以及任何资料/账户更新、材料提交、审核、付款登记或提现入口。

认证有效且命中既有禁止业务写路径返回403 `PARTNER_READ_ONLY`；无有效认证仍按401处理，不存在路径404。大小写、尾斜杠、路径编码及旧代理别名应执行相同规则；不能把POST改用其他HTTP方法绕过。未列入GET白名单的旧印章/授权/电子签任务查询不由新portal自动开放；历史任务/PDF保存在原领域，仍可通过既有受控后台读取和独立供应商回调核对。不得为保留历史而重新开放合作商签署/sync。

### G. 资金、历史与迁移不可变条件

- v2.2仅改变合作办理/访问关系，不改真实收退款、押金、已付结算、人工应付和来源引用事实。账户不是建合作商/客户申请的登录前置；编制结算和登记实付仍须当前有效已复核账户、冻结摘要、整数金额及独立复核。
- RATE中的`rateBps`是约定比例字段，方向须由明确条款说明。首批可记录平台服务费20%（2000bps），但计提基础保持待双方确认，不能自动选择应收/实收/退款后口径；80%只是其他调整前算术余量，不是已确定净应付。基础、扣减、退款、周期、费用责任或有效期未明确，可留草稿，不能激活为新订单适用规则或计算虚假应付。
- 三家合作期2026-10-28至2031-10-27含当日，仅为已确认合作范围候选；不得自动填为查看授权期、分润规则期、客户租期，或当作已经签署/归档。已有真实协议直接上传，不强制重签或重生成。
- 兼容迁移保留PartnerIdentityBinding/PartnerVerification历史、Customer/OwnerMember、旧会话审计、反馈、主体/车辆/档案/规则/订单ID。历史审核只能经有据的显式映射复用；无材料不自动通过，旧账号关系不自动转成只读授权，现存三家DRAFT不自动变为有效合作。
- 新出租方快照显式版本化；旧`lessorIdentityHash`按旧快照原算法解释，保留旧PDF、noticeHash和`ownerDataConsent`的customerId/ownerId/acceptedAt绑定，不重算、补写或代同意。只读访问授权不能替代客户对实际出租方的逐单共享授权。
- 旧未解决反馈保留并继续影响相应履约/资金门禁，关闭外部反馈写口不等于争议已解决。供应商回调继续按原交易/执行模式验签记录事实，与H5查询隔离；不可因新门户关闭而丢失可信迟到事实。
- 发布须兼容迁移和preserve方式，保持当前业务数据。旧版本回退若可能恢复H5业务写口，应先禁用外部H5并确认兼容边界，不能静默恢复旧权限。代码/后台/H5/API及真实参与范围验收分别记录，本文档完成不等于R1–R6或真实短信/服务号菜单验收完成。
