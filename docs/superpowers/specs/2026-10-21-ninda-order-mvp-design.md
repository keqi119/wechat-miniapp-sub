# 宁达订单履约 MVP 设计基线

> 2026-10-26 更新：本文件保留为 v1.1 历史基线。当前三端及签约履约方案以 [v2.0 线下签约、线上履约设计](2026-10-26-ninda-offline-contract-mvp-design.md) 为准；新业务不再按本文件的电子签主路径施工。人员管理细则仅在新文档明确引用时继续适用。

日期：2026-10-21（Asia/Shanghai）  
版本：1.1  
状态：依据本聊天已确认规划形成开发基线；本轮交付文档，不表示功能已施工、已上线或真实业务已验收。  
执行入口：[可执行开发计划](../plans/2026-10-21-ninda-order-mvp.md)。

本次修订：补齐人员与权限管理的 MVP 范围、角色与数据矩阵、账号生命周期、服务端校验、员工离岗交接及验收要求；保留已配置的服务号员工入口。新增内容为待实施要求，未据此修改产品代码、账号或线上配置。

## 1. 目标、来源与范围

一套业务底座、三个角色入口，以订单为主线，使运营通过界面完成申请、报价、签约、收款、交付、月度履约、还车、结算与退款。客户和企业法人能在各自入口完成应做动作；任何阻断均有原因、下一责任人和恢复入口。

经营关系：实际企业车主是出租方；宁达提供托管运营及交接服务；个人客户是承租人。平台主体、出租主体、收款主体分别记录和展示，不能相互代用。

依据：

- 本聊天的三端 MVP 规划及用户“按照这版规划形成可执行开发文档”的指令。
- 来源聊天：`codex://threads/01a1547a-f3ae-7301-a4f5-7d24e8e262f1`，标题“切换宁达公司与线上环境”。
- [原独立平台设计](2026-10-16-miniapp-independent-platform-design.md)、[法人 H5 设计](2026-10-20-owner-legal-h5.md)、[现场交接设计](2026-10-17-field-handover.md)。
- [API 契约](../../api-contract.md)、[法人 H5 接口](../../api-owner-h5.md)、[宁达交付记录](../../handover-ninda.md)。现有接口以这两份 API 文档为准；本文新增接口是待实施增量，T01 先同步权威契约。

### 1.1 开发基线

读取的 Git HEAD 为 `cc8c5bd`，工作树存在其他线程的未提交变更；执行时必须重新核对工作树，不把 HEAD 当成全部当前实现，也不覆盖他人变更。

2026-10-21 19:52 交付记录已更新为 `20261021-owner-authorization-v1`：本人短信登录、企业实名/证书/选章及授权办理已有进展；`owner-auto-sign v1`、`owner-rental-contract v2`、`owner-data-sharing v1` 已有发布记录。H5 授权启用/停用界面和独立 `OWNER_AUTHORIZATION_ENABLED` 已实现。以上作为已有能力复用，不重复开发或重复发布文案。

交付记录同时说明正式签署、企业车主合同及自动用印执行开关仍关闭。本次未连接线上系统复核；开关、真人验收和部署事实以实施时最新证据为准。历史测试数量不能作为本版通过证据。

### 1.2 首版边界

| 纳入 MVP | 后续版本，不从代码中删除 |
| --- | --- |
| 受邀企业车主、法人本人办理、个人承租人 | 代理经办人、企业承租人、自助开放入驻 |
| 一单一车、固定月租、押金、客户主动支付 | 自动扣款、促销、组合套餐 |
| 人工审核与现有申请级信用核验 | 新信用评分引擎、自动授信 |
| 独立托管协议、租赁主合同、交还确认单 | 自动盖章作为正式标准路径 |
| 基础里程证据、异常费用审核、取消、退车、退款 | 自助复杂换车、延期产品、里程包购买 |
| 已有历史变更记录的查询与受控处理 | 车主自动清分、提现、收益核算 |
| 五种固定后台角色、人员启停/改角色/改密/撤销会话、操作留痕 | 自定义角色、权限编辑器、组织架构树、门店分权、多角色叠加 |

交付延期影响合同或账期时，保留现有受控变更处理；不能因为隐藏自助延期产品就允许直接改合同日期。

## 2. 不可削减的约束

- 仅在本项目写入。旧仓库和旧数据库作为只读来源；禁止连接旧业务库做开发测试。
- 金额整数分；客户归属、后台 RBAC、版本冲突、事务幂等、支付/签署回调校验不可省略。
- 小程序原样副本不改写；真实版保持页面视觉，生产不回退 Mock。
- 法大大结构复用来源提交 `453da778dcfefd3727813179382490903644ef26`，不读取落后的旧工作树替代它。
- 密钥禁止输出/入 Git/入前端。真实交易和签章测试需主控确认明确范围。
- 并行人员只写分配目录；依赖声明可编辑本包 package.json，根 pnpm 安装和锁文件由主控统一处理。
- 不单独提交别人文件、不推送、不部署旧系统。重要业务行为先测试，再实现和核验。
- 采用现有 NestJS、Prisma/PostgreSQL、React/Vite、原生小程序；不引入微服务或新消息中间件。
- Node.js 为 `>=22 <25`，包管理器为 `pnpm@11.7.0`；依赖保持项目已锁定版本。
- 时间存储 ISO8601，业务日期与展示使用 Asia/Shanghai；分转元仅用于展示。
- 测试库必须为本项目独立本地 `_test` 数据库；同一测试库同一时刻仅一个 API 测试进程。

## 3. 三端信息架构与权限

### 3.1 入口与身份

| 端 | 导航及页面 | 主动作 | 不允许 |
| --- | --- | --- | --- |
| 客户小程序 | 首页、选车、用车、我的；新增订单详情，既有合同/账单/交接页承接动作 | 申请、补件、确认方案、实名、签署、付款、核对/异议、查看退款 | 选择归属客户、修改收费、代车主用印 |
| 车主 H5 | 待办、车辆、合同、企业；企业页承载认证、选章、托管及授权 | 本企业合同全文阅读、逐单签署、归档查询；认证与授权管理 | 代客户确认、改账单、看其他企业记录、把实收显示为可提现余额 |
| 平台后台 | 工作台、订单、车辆与车主、资金、设置 | 审核报价、复核合同、派交接、发布账单、审核退款、处理异常 | 通过通用 PATCH 改订单/资金/签署事实 |
| FIELD 员工 | `field.html` 中本人交接任务 | 采集照片/读数/清单、保存草稿、发布 | 查看普通后台、通用私密文件、代客户签署、确认资金到账 |

客户、企业车主是业务身份，不加入后台 Role 枚举。内部人员复用 AdminUser，一个账号只分配一个固定角色：ADMIN / OPERATIONS / FINANCE / SUPPORT / FIELD。一人一账号，禁止共享账号或以重复账号规避审批分离；同一自然人另有客户/法人身份时仍使用对应入口、关系校验与独立会话，不能从前端切换成其他身份。

2026-10-21 入口落实：用户已在“宁达汽车订阅”服务号配置 **员工入口 → 车辆交接**，跳转 `https://admin.evsub.ndacar.com/field.html`。这就是规划中的员工工作台常规入口，无须为统一文案重复改菜单。主控已通过服务号接口只读回查；公开页面 HTTPS/200 及登录页可访问已核验，未代员工登录或操作任务。现场员工使用管理员开通的 FIELD 账号及密码登录。证据：[服务号员工入口](../../evidence/ninda-field-menu.json)。

客户 Bearer、后台 Cookie、车主 H5 Cookie 三套会话独立。每次敏感访问重新检查当前法人关系/企业归属/任务归属。后台及 H5 写入执行 Origin、CSRF；前端隐藏按钮不构成授权。

### 3.2 固定角色与数据范围

| 身份/角色 | 可见数据范围 | 本版可执行动作 | 明确禁止 |
| --- | --- | --- | --- |
| 客户 CUSTOMER | 本人申请、订单、应签文件、账单及交还车材料 | 确认方案、本人实名/签署、付款、核对/异议 | 读取他人记录、改金额或签署事实 |
| 企业车主 OWNER | 当前有效法人关系关联企业的车辆、托管协议及以本企业为出租方的订单/合同 | 企业认证、逐份阅读签署、查询归档及已有授权管理 | 读取其他企业数据、代客户确认、改账单、平台账号管理 |
| 管理员 ADMIN | 本平台业务与系统管理数据；私密附件仍按用途授权，凭据不返回 | 人员与权限、模板审定、业务管理及符合审批规则的操作 | 代客户/法人签署、人工改到账/已签、绕过双人规则 |
| 运营 OPERATIONS | 本平台申请、客户履约资料、车辆/车主、合同、交接及必要资金进度 | 审核/报价、准备复核合同、托管管理、指派/改派、交还车完成 | 管人员、正式模板审定、财务发布/退款审批、修改支付事实 |
| 财务 FINANCE | 本平台订单必要摘要、账单/支付/押金/退款/结算及对应财务证据 | 账单发布、可信支付查询、退款申请/审批、结算；审批须不同人 | 信用核验资料、完整实名证件、完整合同源文件/签后 PDF、派交接、管人员 |
| 客服 SUPPORT | 本平台订单履约摘要、脱敏联系方式、合同/支付/交接进度及已有客服事项 | 查询进度、按既有受控动作跟进客服事项、引导责任人处理 | 修改订单/合同/资金/交接事实、信用核验资料、完整证件/合同文件、管人员 |
| 现场 FIELD | 当前指派给本人的有效交接任务、该材料批次和必要交接联系方式 | 采集、保存草稿、上传证据、发布交接材料、修改本人密码 | 普通后台、其他员工任务、通用文件库、定价/退款、代客户确认/签署、最终完成交车 |

首版内部运营/财务/客服的数据范围是“本平台内符合职责的数据”，不虚构尚未实现的部门或门店隔离。现场人员严格限定本人任务。联系人原始字段仅在确有交接/履约需要的接口返回；列表、日志及通知默认脱敏。

权限分三层：资源/动作许可、记录归属、字段与文件投影。白名单同时覆盖工作区和原有通用列表/详情/文件接口，避免旧地址绕过裁剪。列表先授权过滤再计数分页；未知资源、未知动作及未声明角色默认拒绝。服务端返回 capabilities/permissions 供界面展示，但写入仍重新鉴权。

退款保留现有申请/审批分离；平台用章保留现有双人审批和审批内容绑定。ADMIN 不能批准本人发起的退款或用章申请；切换角色、重新登录、重发请求不改变原发起人记录。人员角色不自动取得用章授权。车主租赁合同的运营 PDF 复核不冒充平台用章审批，也不代替车主本人签署。客服处理限于既有服务事项的允许字段与动作，不通过通用 PATCH 修改交易事实。

### 3.3 人员与权限界面

入口为 **平台后台 → 设置 → 人员与权限**，仅 ADMIN 可进入。沿用 `#users` 深链和既有账号，提供人员列表及“角色说明”；角色说明从服务端固定矩阵生成，只读展示，不提供自定义权限勾选器。

- 列表支持姓名/登录名搜索、角色与启用状态筛选，显示姓名、登录名、角色、状态、更新时间；详情展示本次变更版本、相关审计及未完成现场任务数量。
- 创建填写姓名、唯一登录名、显式选择固定角色、初始密码；不默认授予 ADMIN，初始状态为启用，页面提交前明确显示。保持现有密码长度 16–256。登录名创建后不可修改；人员不物理删除，停用后保留历史经办人和操作记录。
- “编辑姓名”“调整角色”“停用/启用”“重置密码”“退出全部设备”是独立动作。调整角色、启停、重置和撤销会话均需填写原因，并在提交前展示目标人员、影响及未完现场任务。
- 重置密码由管理员输入新密码；响应不返回密码，界面不持久化密码，不自动通过短信、通知或日志分发。员工收到账号后使用本人改密入口；ADMIN/OPERATIONS/FINANCE/SUPPORT/FIELD 均具备本人改密及退出入口。首登强制改密不列为本版已具备能力。
- 改角色、停用、重置密码或退出全部设备后，目标人员所有旧会话失效；管理员本人退出全部设备后回到登录页。启用不会恢复旧会话。409 时刷新人员信息，让管理员重新确认，不能自动重放旧编辑。

### 3.4 账号生命周期、并发与离岗

现有实现已具备五角色、通用账号增改、本人改密、停用/改角色/改密码时删除会话，以及当前管理员自我停用/降级保护。本版补齐专用交互、账号版本、显式最后管理员保护、登录并发保护和覆盖测试，不重复创建账号体系。当前宽泛读权限不能视为上表已全部实现。

1. `AdminUser` 增加 `revision Int @default(0)`、`authVersion Int @default(0)`、`updatedAt DateTime @updatedAt`；`AdminSession` 增加 `authVersion Int @default(0)`。存量 updatedAt 以 createdAt 初始化并记录为迁移初值，不伪造历史编辑时间。既有账号角色/状态保留，不自动扩大权限或重置密码。一般资料修改递增 revision；角色/启停/密码/撤销会话操作同时递增 authVersion 并删除旧会话。
2. 人员写入在同一事务内重新确认操作者当前仍是有效 ADMIN、会话安全版本有效，校验目标 revision，完成修改、会话撤销与审计。本人改密沿用旧密码验证并应用同一并发保护。新密码哈希不得进入响应、审计、幂等结果或可恢复页面草稿。
3. 不允许当前管理员停用或降级自己；不允许停用/降级最后一个有效 ADMIN。以可重试 Serializable 事务及必要行锁保证两个管理员相互停用/降级的并发请求至少保留一个有效管理员，事务重试不得沿用过期操作者权限。
4. 登录验证密码后，在创建会话事务中重验 active、密码版本及 authVersion，避免旧密码登录与重置/停用交错后留下有效会话。每次访问比对当前人员状态、角色和会话 authVersion；不能只相信登录时的角色快照。
5. 退款、用章、派单等关键动作在提交业务意图的事务内重验操作者和目标人员。人员撤权与这些动作须使用一致的锁定/版本校验顺序：已先提交的业务意图保留审计；撤权提交后不得新建有效意图。已向供应商发出的交易继续原交易核验，不能因人员停用删除事实或声称撤回签章。
6. 停用 FIELD 或将其改为其他角色时仍可完成停用，但未完任务进入运营“待改派”待办并标明原因；不自动转给管理员、不取消订单、不完成任务。原发布材料及历史采集人保留。指派/发布事务重验员工 active、FIELD 角色、任务版本及材料批次；改派后旧员工的任务/附件/上传/发布权限失效。
7. 人员审计记录动作、操作者/目标 ID、变更前后角色/状态/版本、原因、发生时间、撤销会话数量和关联待改派任务；不记录密码、密码哈希、Cookie、CSRF 或供应商凭据。审计仅 ADMIN 可查，记录不可由通用编辑接口修改。

### 3.5 人员权限验收底线

- 五个后台角色分别验证导航、列表、详情、动作、私密文件、直接 HTTP 请求；客户端改 role/capabilities、复制 URL 或换资源 ID 不能提权。
- 普通管理员仍受退款/用章申请审批分离约束；无论重新登录或改角色都不能批准自己原有申请。
- 验证多设备停用、改角色、重置、本人改密、撤销会话后旧会话全部拒绝，重新启用旧 Cookie 仍拒绝；旧密码并发登录不能绕过撤销。
- 验证陈旧人员 revision、两个管理员互相停用/降级、非 ADMIN 直接调用人员接口、失权操作者在途写入及旧通用 PATCH 绕过均被阻断。
- 验证 FIELD 停用/转岗与派单竞态、运营改派、历史证据保留及新员工接续；客户/车主独立身份和权限不受员工角色选择影响。

## 4. 订单生命周期与共同工作区

### 4.1 主状态与进入条件

| 阶段 | 底层状态 | 推进条件/下一步 |
| --- | --- | --- |
| 申请中、待方案确认 | 现有 Application 状态 | 审核、补件、独立信用授权与核验、发布带 revision/commercialHash 的方案 |
| 待签约 | AWAITING_SIGNATURE | 客户确认当前方案，事务冻结快照并占车；准备/复核 PDF，双方签署且签后文件归档 |
| 待付款 | AWAITING_PAYMENT | 主合同已核验归档；发布押金及首期应付账单，客户主动支付 |
| 待交付 | AWAITING_HANDOVER | 首期及适用押金足额到账、无相关退款在途；进入交接 |
| 用车中 | ACTIVE | 交接事实确认、独立交接签署与归档、运营完成交付 |
| 还车待结算 | SETTLING | 还车交接完成；核清里程、费用、争议及退款 |
| 已完成 | COMPLETED | 应收已结清或依规则作废、应退已退、无未知支付/退款与未决争议 |
| 已取消 | CANCELLED | 通过现有取消动作；已签合同按现有终止规则处理，已收款完成应退处理 |

订单阶段是展示汇总，合同、支付、退款、交接仍保留独立状态。不能新建一张“工作区状态表”绕过真实领域记录。

### 4.2 工作区字段

`OrderWorkspace`：`orderId`、`version`（工作区摘要，非通用写入版本）、`stage`、`stageText`、`vehicle`、`parties`、`commercialSummary`、`nextAction`、`blockers`、`contracts`、`billing`、`handovers`、`timeline`、`capabilities`。

- `stage` 采用上表 OrderStatus；申请待办使用独立 Application 记录，不创建虚假订单。
- `nextAction`：`code,label,responsibleRole,resourceType,resourceId,enabled,disabledReason?`。`responsibleRole` 为 CUSTOMER/OWNER/OPERATIONS/FINANCE/FIELD/SUPPORT/SYSTEM。
- `blockers`：`code,message,responsibleRole,resourceType,resourceId`。无权读取的细节不进入响应。
- `contracts` 仅含授权范围内的类型、版本、双方状态、归档状态及文件入口；不返回供应商身份、交易凭据或原始响应。
- `billing` 汇总 `receivableAmount,receivedAmount,refundableAmount,refundedAmount,pendingPaymentAmount,pendingRefundAmount`，均为整数分。各金额名称固定；押金与租金分列。
- `timeline` 为既有业务事件的白名单投影，不直接发送 AuditLog 的 data 全文。
- `capabilities` 由服务端计算；动作提交仍复核领域版本、归属、权限与门禁。
- 客户仅本人；车主仅冻结出租方属于本企业的订单；FINANCE/SUPPORT 不返回信用档位、核验 ID/规则、身份证件全文、运营专属附件。
- 排序：未决阻断优先，其后是本角色可处理的到期待办；同级按应处理时间、资源 ID 稳定排序。多订单列表不以“最近一单”替代全部订单。
- 工作区 GET 只读，不调用可能自动用印的 `query(..., true)`，不创建支付、签署或授权。

## 5. 合同、模板与托管关系

### 5.1 模板固定

新报价只选当前审定发布模板；客户确认时冻结 ID、版本、正文摘要、审定/发布时间和交易条件摘要。已确认订单生成 PDF 时验证冻结证据，允许该模板随后正常 RETIRED；禁止回退最新模板、接受未曾发布的草稿或摘要不匹配正文。

旧订单不回填伪造的批准快照：沿用原有模板 ID/版本/摘要，核对原 LegalDocument 的 confirmedBy/confirmedAt/publishedAt 及其早于订单确认的时间证据。缺少足够历史证据时返回明确阻断，人工核对原批准记录，不猜测版本或自动替换为新模板。

模板正文发布后不可修改。重新生成未进入渠道的文件遵循既有换章/换证规则，更新文件与复核记录；已有渠道尝试的文件只能沿原交易核验。所有新操作继续受当前执行开关约束。

后台补齐草稿编辑、完整预览、记录正式审定依据、发布版本、查看历史版本与关联订单。正式文本和审定人来源不得由模型猜测；缺少审定依据时只能保存草稿。已有已批准文本复用，不重新发布覆盖历史。

### 5.2 独立车辆托管协议

新增 `owner-management-agreement` 文案类型及独立领域，不伪造客户订单承载平台与车主的协议。

- 签署双方 OWNER / PLATFORM；车辆列表、有效期、服务范围、服务费说明、收款安排、结算安排、终止条件及双方身份冻结在完整正文和快照中。
- 首版服务费、收款/结算条款为必须填齐并审定的文本，系统不据此计算车主收益或执行分账；不默认生成费率或把未知费用写为零。
- `OwnerManagementAgreement`：`id,ownerId,revision,status,documentId,templateVersion,templateHash,ownerSnapshot,platformSnapshot,termsSnapshot,sourceFileId,sourceSha256,documentHash,reviewedBy,reviewedAt,signedFileId,signedPdfHash,archivedAt,createdBy,createdAt`。
- `OwnerManagementVehicle`：`agreementId,vehicleId,bindingId,bindingRevision`，联合唯一；车辆归属证据固定在 termsSnapshot。
- `OwnerManagementParty`：`agreementId,role,providerCustomerId,providerSignatureId?,certificateSerialNo,transactionId,status,attemptedAt,verifiedAt,queryEvidenceHash`；`agreementId+role` 和渠道交易号唯一。
- 状态 DRAFT → PREPARED → SIGNING → ARCHIVED；另有 REJECTED/EXPIRED/CANCELLED。上传/请求未知和租约单独记录，不能冒充业务失败后重新建交易。
- 运营准备并复核完整 PDF；企业法人逐份签署；平台签章必须使用宁达主体已核验账号及既有用章策略/双人审批。不得借用晓浪身份，也不得用手动点击“已签”替代渠道证据。
- 平台与车主的签署顺序固定为车主先签、平台审批后执行；双方证据及签后 PDF 完整才归档。
- 新 MVP 正式方案必须引用已归档、未过期且覆盖车辆与拟租赁期限的托管协议；`managementAgreementId`、摘要和范围版本进入出租方快照。发布方案和客户确认均重验。
- 对既有已确认订单不追写托管关系、不重新定价、不强制重签；旧订单按原快照履约。未确认方案遇新增前置条件时重新报价并让客户确认。
- 托管协议不自动赋予自动用印权限。`OWNER_AUTO_SIGNING_ENABLED` 在本版正常业务验收中保持 false。

### 5.3 客户租赁合同与 H5 手签

复用 `OwnerContractPreparation`、`OwnerContractAccess`、`OwnerContractGateway`。H5 新增契约适配，以本人法人会话调用 `runOwnerH5`，不能复用小程序签署门禁、返回地址或 Bearer 凭证。

签署请求绑定 `accepted=true,documentHash,sourceSha256`；在途按原 taskId/transactionId 恢复。租赁主合同采用客户先签、车主后签；客户尚未签署时车主只可预览。H5 返回页只触发核验并恢复原待办，不接受 URL 内的成功断言。查询接口不自动盖章。

## 6. 账单、交接与异常规则

1. 账单计划按已确认的起租日、付款日和条款生成；首付款页聚合展示押金与首期，首版沿用逐账单支付，不增加合单支付或代扣。
2. 标准押金继续使用本申请的独立信用授权、人工核验及规则；实名成功不等于信用已核验。验收专属 1 分报价维持既有隔离，不出现在普通报价选项中。
3. 支付成功仅来自可信验签回调/渠道查询，并校验金额、币种、商户、应用及交易归属。支付/退款不明时保留原交易查询，不重复扣款或重复退款。
4. 退款保留双人复核、部分退款累计上限、渠道结果核验；客户看到审核中/退款中/已退款，不能在受理时显示到账。
5. 交付前校验归档、首付及当前车辆批次；现场员工仅收集本人任务。附件按任务和材料批次授权，改派/取消/重启后旧权限失效。
6. 清单包含实际时间、地点、里程、电量、车况、配件、遗留问题和处理方案；客户确认绑定 manifestHash；异议必须形成新修订，不能覆盖已确认事实。
7. 事实确认、交接单签署、运营完成分开。客户待办随之显示“核对车况”“签署交接单”“等待完成交付”。
8. 还车后进入结算，保留里程审核、费用证据和客户争议入口。未来未发生应收按规则作废/退款；全部核清后关闭订单。
9. 付款或签署取消页面只表示用户退出操作，不自动取消业务订单。缺章、证书过期、供应商不可用均显示可恢复阻断。

## 7. 待实施 API 增量

基地址 `/api`。新增列表采用 `{items,total,page,pageSize}`；现有接口保持兼容，人员敏感写入按本节明确收口。`pageSize` 最大 100。新增动作幂等键同主体/资源/动作唯一，同键异参返回 409；版本不匹配返回 409，不自动替用户重做确认。

| 方法/路径 | 输入与输出 | 权限/行为 |
| --- | --- | --- |
| GET `/customer/workbench` | 分页 WorkItem | 本人申请、订单待办 |
| GET `/customer/orders/:id/workspace` | OrderWorkspace | 本人订单，只读 |
| GET `/admin/workbench` | queue,keyword,page,pageSize → WorkItem 列表 | 按当前角色投影；FIELD 拒绝 |
| GET `/admin/orders/:id/workspace` | OrderWorkspace | ADMIN/OPERATIONS/FINANCE/SUPPORT，字段分权 |
| GET `/owner-h5/owners/:id/workbench` | 分页 WorkItem | 当前本人法人及本企业 |
| GET `/owner-h5/owners/:id/vehicles` | 分页车辆摘要 | 仅本企业审核通过车辆，不含其他订单资料 |
| GET `/owner-h5/owners/:id/orders/:orderId/workspace` | OrderWorkspace | 冻结出租方等于本企业 |
| GET `/owner-h5/owners/:id/contracts` | 分页租赁签署任务 | 保留 taskId 与 contractId 的不同含义 |
| GET `/owner-h5/owners/:id/contracts/:taskId` | 任务、双方进度、摘要、允许动作 | 每次校验当前法人 |
| GET `/owner-h5/owners/:id/contracts/:taskId/files/:kind` | kind=source/signed，PDF | 鉴权读取，no-store；未归档无 signed 文件 |
| POST `/owner-h5/owners/:id/contracts/:taskId/sign` | accepted,documentHash,sourceSha256,idempotencyKey → SignEntry | 原交易恢复，不接收供应商账号或印章 ID |
| POST `/owner-h5/owners/:id/contracts/:taskId/sync` | `{}` → 签署/归档状态 | 仅查询和归档，不自动用印 |
| GET/POST `/admin/owner-management-agreements` | 分页 / ownerId,vehicleIds,documentId,terms,idempotencyKey | ADMIN/OPERATIONS；新建草稿 |
| GET/PATCH `/admin/owner-management-agreements/:id` | 详情 / revision,terms,vehicleIds | 仅 DRAFT 可编辑 |
| GET `/admin/owner-management-agreements/:id/files/:kind` | source/signed PDF | ADMIN/OPERATIONS；完整复核或归档查看，no-store |
| POST `/admin/owner-management-agreements/:id/prepare` | revision,idempotencyKey | 固定身份、正文、车辆和 PDF |
| POST `/admin/owner-management-agreements/:id/review` | revision,accepted,documentHash,sourceSha256,idempotencyKey | 全文复核，不等于用章审批 |
| POST `/admin/owner-management-agreements/:id/platform-sign` | revision,approvalId,documentHash,idempotencyKey | 平台既有用章审批通过后执行 |
| POST `/admin/owner-management-agreements/:id/sync` | `{}` | 查询双方并归档，不触发平台签章 |
| POST `/admin/owner-management-agreements/:id/cancel` | revision,reason,idempotencyKey | 仅未发出任何渠道签署请求的草稿/准备态；其他状态拒绝 |
| GET `/owner-h5/owners/:id/management-agreements` | 分页摘要 | 仅本企业 |
| GET `/owner-h5/owners/:id/management-agreements/:agreementId` | 完整业务详情及摘要 | 当前法人、最小字段投影 |
| GET `/owner-h5/owners/:id/management-agreements/:agreementId/files/:kind` | source/signed PDF | 按当前法人和企业授权 |
| POST `/owner-h5/owners/:id/management-agreements/:agreementId/sign` | 同租赁签署输入 → SignEntry | 逐份签署，固定 OWNER 角色 |
| POST `/owner-h5/owners/:id/management-agreements/:agreementId/sync` | `{}` | 查询/归档 |
| POST `/callbacks/fadada-owner-management` | 供应商正式回调 | 验签、任务/主体/交易绑定、幂等；不依赖登录 |
| POST `/admin/legal-documents/:id/confirm` | contentHash,approvalReference,revision | ADMIN 记录用户正式审定依据；操作人/时间取服务端 |
| GET `/admin/roles` | 固定角色说明、数据范围和允许动作 | 仅 ADMIN，只读，不接受角色定义写入 |
| GET `/admin/users`、`/admin/users/:id` | 原分页形态；新增 role,active 筛选 / StaffUserView | 仅 ADMIN，保留原搜索，不返回密码/哈希/会话凭据 |
| POST `/admin/users` | username,name,role,password,idempotencyKey → StaffUserView | 仅 ADMIN，统一人员服务，初始启用 |
| PATCH `/admin/users/:id` | name,revision,idempotencyKey → StaffUserView | 仅改姓名；禁止通过此入口改用户名/角色/状态/密码 |
| POST `/admin/users/:id/role` | role,revision,reason,idempotencyKey → StaffUserView | 仅 ADMIN，角色变化撤销全部会话；FIELD 转岗提示待改派 |
| POST `/admin/users/:id/disable`、`/enable` | revision,reason,idempotencyKey → StaffUserView | 仅 ADMIN，自锁/最后管理员保护；启用不复活旧会话 |
| POST `/admin/users/:id/reset-password` | newPassword,revision,reason,idempotencyKey → StaffUserView | 仅 ADMIN 重置他人密码；本人使用现有 auth/password |
| POST `/admin/users/:id/revoke-sessions` | revision,reason,idempotencyKey → StaffUserView | 仅 ADMIN，撤销目标全部会话，本人操作后须重登 |

`StaffUserView={id,username,name,role,active,revision,createdAt,updatedAt,pendingFieldTaskCount}`，role 为上述五种固定值；pendingFieldTaskCount 为未完任务数量，不携带其他人员材料。列表不返回 authVersion。人员动作响应均只含该投影；退出全部设备的结果通过审计记录，前端不获取会话令牌。

人员 POST/PATCH 及专用动作全部进入同一人员服务；旧通用 `users` 写路径不再直接执行 ORM 更新。旧 PATCH 携带 role/active/password/username 返回 409 `STAFF_ACTION_REQUIRED`，不得静默忽略或绕过专用动作。现有 `POST /admin/auth/password` 保持原输入，补齐并发版本保护并清 Cookie；后台本人重置引导该入口。账号敏感接口变更须与 T17 新界面配套交付，权威 API 契约在 T01 先标记这一兼容性例外。回滚旧界面也不能重新开放绕过入口。

人员动作沿用现有“数据库唯一约束＋事务”的幂等方式，新增 `StaffCommand={id,actorId,targetKey,targetId,action,idempotencyKey,requestDigest,digestKeyVersion,responseSnapshot,createdAt}`，唯一约束为 actorId/targetKey/action/idempotencyKey。创建时 targetKey 固定为 `users:create`，其他动作为目标人员 ID；targetId 在成功后记录。与人员写入/审计同事务保存，responseSnapshot 仅为 StaffUserView，不包含密码或密码哈希，不开放此表的通用 CRUD。

请求摘要为规范化输入的 HMAC-SHA256；仅服务端新增 `STAFF_COMMAND_DIGEST_KEY`（至少 32 随机字节，经安全环境配置注入），不放前端、日志或仓库，不复用支付/签署密钥。缺失时阻断人员管理写入，保持本人改密/退出和既有业务查询；测试只用合成密钥。记录密钥版本，轮换时保留历史版本用于既有幂等键核验。验证当前权限在幂等结果返回前执行，不能用旧键读取已失去权限的结果。原因去空白后 1–500 字；登录名 3–100 字且唯一，密码保持 16–256 字符；重复登录名返回 409 `STAFF_USERNAME_TAKEN`，自锁沿用 `SELF_LOCKOUT`，最后管理员保护为 409 `LAST_ACTIVE_ADMIN`，摘要配置缺失为 503 `STAFF_COMMAND_NOT_READY`，版本和幂等冲突沿用现有码。非 ADMIN 无论目标是否存在均拒绝，不能借查询枚举人员。

`SignEntry={taskId,status,url?}`；只返回精确允许的 HTTPS 供应商地址，浏览器不持久化 URL 或签署凭据。

`WorkItem={id,resourceType,resourceId,orderId?,title,stageText,dueAt?,responsibleRole,nextAction,blockers}`。`resourceType` 为 APPLICATION/ORDER/OWNER_MANAGEMENT_AGREEMENT/HANDOVER_TASK；ID 由类型、资源、动作稳定派生。离岗待改派使用 HANDOVER_TASK、原 taskId 和关联 orderId，只对 ADMIN/OPERATIONS 返回，nextAction 为 REASSIGN_HANDOVER。所有队列都从真实业务记录查询，不把“消息已读”当作“业务完成”。

`queue` 固定为 ALL/APPLICATIONS/SIGNATURES/PAYMENTS/HANDOVERS/SETTLEMENTS/EXCEPTIONS，默认 ALL；非法值返回 400。先按角色过滤，再筛选/计数/分页。工作台主动作 code 固定为 VIEW_APPLICATION/SUBMIT_INFO/CONFIRM_PLAN/COMPLETE_IDENTITY/PREPARE_CONTRACT/REVIEW_CONTRACT/SIGN_RENTAL/SIGN_MANAGEMENT/SYNC_SIGNATURE/PAY_BILL/COLLECT_HANDOVER/REASSIGN_HANDOVER/CONFIRM_HANDOVER/OBJECT_HANDOVER/SIGN_HANDOVER/COMPLETE_HANDOVER/REVIEW_SETTLEMENT/REVIEW_REFUND/VIEW_ORDER；前端用本地明确映射处理，不能执行服务端返回的任意 URL。待改派任务进入 HANDOVERS/EXCEPTIONS，ALL 队列按稳定 ID 去重。

订单/托管新增错误码固定为：409 `MANAGEMENT_COVERAGE_REQUIRED`（无有效托管覆盖）、409 `PINNED_TEMPLATE_MISMATCH`（冻结模板证据不符）、409 `CUSTOMER_SIGNATURE_REQUIRED`（车主租赁签署前客户未签）、503 `MVP_WORKSPACE_DISABLED`、503 `OWNER_MANAGEMENT_DISABLED`；人员错误码见上文。沿用现有 `REVISION_CONFLICT`、`DOCUMENT_MISMATCH`、`IDEMPOTENCY_CONFLICT`、`UNAUTHENTICATED`、`CSRF_DENIED` 等错误格式；越权对象统一404，角色/会话入口不允许为403/401。阻断文案不泄漏对象存在性。

托管协议 `terms` 固定字段：`validFrom,validUntil,serviceScope,serviceFeeDescription,collectionArrangement,settlementArrangement,terminationTerms`；日期 YYYY-MM-DD，文本去空白后非空、每项最多 10000 字，起止时间有序。不含自动清分或自动用印开关。

`LegalDocument` 增加 `revision`（默认 0）和 `approvalReference`。confirm 仅 ADMIN、仅 DRAFT，内容哈希和版本一致才记录；文案修改后清除旧审定记录。既有已发布文案只读保留，不伪造新的审定来源。

## 8. 页面验收规则

- 客户“用车”显示全部未完成订单卡片，默认展示最近更新的一单但提供明确切换；“查看订单”直接携带 orderId。
- 订单页最多突出一个本角色主动作；等待其他角色时显示角色和原因，合同/账单/交接仍可查看。
- 车主入驻向导在完成后收起，日常默认待办；合同列表区分托管协议与租赁合同，显示车辆、相对方、版本、状态、更新时间。
- 全文必须可打开；阅读确认绑定当前源文件摘要。切企业、切合同、换版本、会话失效后清除旧确认。
- 后台以客户姓名、车辆名称、订单号定位，编号可复制；关联记录能返回同一订单，列表保留筛选条件。
- 资金动作仅财务/管理员可用；客服看到有限进度；FIELD 不因新工作台获得任何普通后台权限。
- 设置内“人员与权限”只对 ADMIN 展示，固定角色说明、账号状态、变更后退出设备的影响清楚可见；改派入口属于运营交接管理，FIELD 不看全员列表。
- 各后台角色均能修改本人密码/退出；401 清除敏感界面与旧请求结果并回登录页，409 保留非敏感上下文后刷新重确认。浏览器后退不能恢复可操作的旧授权页面。
- 320/375/430 像素移动宽度及桌面 1280 像素下无横向遮挡；按钮有忙碌态，失败保留非敏感草稿，重开页面能恢复真实进度。
- 中文文案不用 providerId、hash、租约等实现词汇；确需核对模板时明确显示模板编号和版本，摘要作为详情。

## 9. 通知与恢复

MVP 以三端站内待办为可靠入口，复用客户 Notification；车主待办直接从企业任务投影。短信/服务号业务提醒仅接入已有明确可用的消息能力，不把登录验证码模板当业务通知模板。

如具备已审定消息模板，由发送适配器记录幂等键、渠道、发送结果及失败原因；失败不改变订单。尚无合适模板时站内待办正常，后台显示“外部提醒未配置”，不伪报已通知。查看/刷新不得发送短信。通知只能带受控站内路径和脱敏摘要，不能携带供应商签署 URL 或私密文件。

## 10. 迁移、验收与交付边界

数据库使用增量迁移，新增托管表、文案审定字段、人员/会话版本及 StaffCommand；不重建旧订单/客户/签署任务。已有人员保留账号、角色与历史归属，人员/会话 authVersion 初始均为 0；发布时先部署兼容迁移，再切换匹配的 API/后台。已存在交易号、文件摘要和版本保持可回溯。新前端开关先部署但关闭，验证新接口后再开放；回滚关闭新入口并保留新增表及渠道在途处理，不逆向删除迁移。

本版新增 `ORDER_MVP_WORKSPACE_ENABLED=false` 和 `OWNER_MANAGEMENT_ENABLED=false` 默认门禁。两个只控制新工作区/新托管操作；已有签署与授权开关独立。开关关闭不得阻断已存在任务的查询、回调或文件归档。创建/签署新托管协议另受正式签署及当前平台主体就绪限制。

人员/RBAC 安全门禁独立生效，不能随工作区开关关闭而恢复宽读或旧敏感 PATCH。发布清单包含实际人员角色核对、至少一个有效管理员、双人审批所需独立人员、各角色真实入口及离岗/改派流程；不批量创建默认密码账号。旧版本若不识别 authVersion 或人员写入约束，不作为可直接回滚版本；准备兼容修复或暂停人员敏感写入，保留会话撤销和审计能力。

上线前必须取得：正式托管文本及逐单商业条款、适用信用和交接文案、宁达平台签署身份/证书/用章审批、车主与车辆真实权属、渠道配置、实际微信小程序包版本及消息配置。已满足项引用当前证据，不重复认证；未满足项明确阻断对应真实操作，合成开发继续。

最终验收需完成一笔“企业托管归档 → 客户申请 → 方案确认 → 双方租赁签署 → 首付 → 交付 → 月账单 → 还车 → 结算退款”的业务旅程，并覆盖取消、异议、越权、版本变化、重复回调和断网恢复。真实测试需事先明确主体、车辆、金额、文档摘要、退款范围及操作人；本开发文档不授予代法人签署或无限额交易授权。
