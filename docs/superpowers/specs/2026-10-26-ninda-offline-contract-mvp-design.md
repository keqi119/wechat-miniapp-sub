# 宁达线下签约、线上履约 MVP 三端设计基线

> 2026-10-27 更新：模块结构、企业/个人合作商、保单、产品权益及人工分润结算以 [v2.1 七模块设计基线](2026-10-27-ninda-seven-module-mvp-design.md) 为准。本文件继续提供线下档案、付款、交还车和历史电子签隔离细则；与新版范围冲突的条款不再适用。

日期：2026-10-26（Asia/Shanghai）  
版本：2.0  
状态：按用户本轮要求重设计；本次交付设计与开发文档，不表示已修改代码或线上配置。  
执行文档：[开发计划](../plans/2026-10-26-ninda-offline-contract-mvp.md)。

## 1. 本轮决定与基线优先级

用户明确：因客户、企业车主、宁达构成三方关系，本版剔除电子签，采用线下签署、人工上传审核；线上完成订单、车辆查验交接、支付。系统不以平台已开通法大大 API、电子章、签署证书或自动用印授权为上线前提。

本文件替代 [MVP v1.1](2026-10-21-ninda-order-mvp-design.md) 中的电子签主路径、独立电子托管签署任务和签章门禁，并替代本版新增订单适用的 [法人工作区逐单手签](2026-10-22-owner-workspace-design.md)、[交接单法人手签](2026-10-25-platform-manual-handover-design.md)。上述文件保留为历史设计，不能继续作为新订单的施工目标。原系统代码、历史合同、授权及电子签证据保留，不伪造撤销或删除。

实际企业车主仍是出租方，客户是承租人，宁达是平台服务方；三方名称、证件/企业标识和职责进入本单快照及正式纸质合同。宁达不冒充车主，不使用其他企业的 API 身份代签。

本轮的具体设计选择：由运营统一收集并上传合同，另一名 ADMIN/OPERATIONS 审核；客户和车主在线查看已归档副本、反馈问题；FIELD 上传本人交接任务的纸质交接单。首版不开放客户/车主自助上传合同，减少文件混用和重复审核。这些是为落实用户方向采用的实现默认值。

### 1.1 方案选择

| 方式 | 评估 |
| --- | --- |
| 上传附件后人工改“已签” | 无法区分电子签证据、线下材料和审核责任，也无法保证三方齐签；不采用 |
| 独立线下档案、版本及审核记录，统一驱动履约门禁 | 采用；保留现有订单/支付/交接模型，能追溯原文件、审核人及适用版本 |
| 为本版继续建设三方电子签 | 不在本轮范围内 |

### 1.2 保留与剔除

保留：一单一车、个人客户、受邀企业车主、报价确认、占车、客户/企业资料人工核验、固定五角色、分期账单及主动支付、押金、车辆查验、客户核对/异议、退车结算和退款。原四 Tab、品牌及主要视觉保持。

本版不提供新电子签发起、签署链接、选章、自动用印、签章授权办理、平台用章审批、电子签待办或签署短信。车主合作/授权需要的文件统一线下办理，历史授权仅查询。延期、换车、提前终止等产生新文件的变更不进入首版自助功能；已有记录保留查询，确需处理时走受控线下补充文件与原有金额/账期变更规则，不能直接改订单事实。

没有自定义角色、门店组织树、自动扣款、车主自动分账/提现、营销套餐或新的授信引擎。

## 2. 不可削减的约束

- 仅在本项目写入。旧仓库和旧数据库作为只读来源；禁止连接旧业务库做开发测试。
- 金额整数分；客户归属、后台 RBAC、版本冲突、事务幂等、支付回调校验不可省略。历史签署回调仍须验签和绑定原任务。
- 小程序原样副本不改写；真实版保持页面视觉，生产不回退 Mock。
- 法大大历史结构复用来源提交 `453da778dcfefd3727813179382490903644ef26`；本版不新增电子签执行，不读取落后的旧工作树替代历史来源。
- 密钥禁止输出/入 Git/入前端。真实支付、退款及历史签署处理需明确操作范围；本轮不执行。
- 并行人员只写分配目录；根安装、锁文件、schema、迁移、鉴权与应用注册由主控统一处理。不单独提交别人文件、不推送、不部署旧系统。
- 重要业务行为先测试，再实现和核验。采用现有 NestJS、Prisma/PostgreSQL、React/Vite、原生小程序，不引入新中间件。
- Node.js 为 `>=22 <25`，包管理器为 `pnpm@11.7.0`；依赖保持项目已锁定版本。
- 时间存储 ISO8601，业务日期与展示使用 Asia/Shanghai；分转元仅用于展示。
- 测试库仅本项目本地 loopback:55432/chundian_test；同一时刻一个 API 测试进程，不输出连接串。

## 3. 三端设计与现场员工入口

### 3.1 客户小程序

保留“首页 / 选车 / 用车 / 我的”。首页突出当前待办；用车页展示全部未完成订单，可切换订单。

| 页面 | 内容和主动作 |
| --- | --- |
| 申请及方案 | 填资料、补件、查看三方及完整报价、确认当前版本；确认后占车并创建待线下签约订单 |
| 订单详情 | 进度、车辆、三方、合同资料、账单、交还车、服务记录；最多一个当前主动作 |
| 合同资料 | 待线下签署时显示运营联系方式和安排；待审核时显示等待审核；通过后查看/下载完整归档副本、反馈文件问题 |
| 账单支付 | 明确租金、押金、额外费用及到期日；合同归档后开放首付，逐账单微信支付；付款未知先查原交易 |
| 交还车查验 | 逐项查看车况、照片、里程、电量、配件和遗留事项；“确认查验结果”或“提出异议”，确认绑定本次材料版本 |
| 我的 | 本人资料、历史订单/合同、服务联系、协议隐私及退出 |

移除“去电子签”“电子章”“刷脸签合同”“签署成功回跳”等新订单入口。页面明确“合同线下签署，审核后可查看副本”；查验确认仅记录事实确认，不显示“电子签署完成”。等待人工处理时提供联系方式和进度，不用无效按钮。

### 3.2 企业车主 H5

常规入口沿用服务号企业入口及 `https://sign.evsub.ndacar.com/owner/`，导航调整为“待办 / 车辆 / 订单 / 企业”。菜单文案调整属于实施发布清单，本轮不调用服务号菜单写接口。

| 页面 | 内容和主动作 |
| --- | --- |
| 待办 | 待配合线下签约、待补企业/车辆资料、资料反馈处理结果；显示对应车辆/订单、联系运营 |
| 车辆 | 仅本企业车辆，上下架/预订/用车/归还状态及关联订单；车主不直接改已确认权属或在租交易资料 |
| 订单 | 本企业作为出租方的订单摘要、客户必要信息、租期、租金、押金、交还进度；查看本单已归档三方合同并反馈问题 |
| 企业 | 企业资料、登记法人、资料核验状态、线下合作文件、联系人；历史电子签/授权档案折叠只读 |

不要求车主为本版注册法大大账号、获取签章证书或选章。沿用本人手机号短信和企业邀请，业务访问校验当前有效企业成员/法人登记关系及资料人工核验记录；短信通过或拿到邀请码不能自动获得已核验法人身份。已核验关系可沿用其历史证据，新/变更关系由运营录入证明、另一名管理员复核，变更立即撤销旧成员访问；不重写原电子认证结果。业务角色核验与历史电子签文件授权分别判断。

车主无代客户确认、改账单、确认到账、上传后自行审核的权限。实收进度不展示成车主可提现余额；首版不做收益核算。

### 3.3 平台后台与 FIELD

后台导航：“工作台 / 订单 / 车辆与车主 / 资金 / 设置”。合同资料归入订单详情及工作台审核队列，减少人员往返模块查找。

| 工作区 | 日常操作 |
| --- | --- |
| 工作台 | 待审申请、待线下签约、待上传、待审核/退回补件、待付款、待交车、待还车、待结算、异常 |
| 订单详情 | 方案 / 合同资料 / 资金 / 交接 / 记录；冻结方案生成带订单号及版本的打印件，上传签署件，逐项审核，定位缺项 |
| 车辆与车主 | 车辆资料和权属审核、企业关系人工复核、线下合作档案及覆盖范围；查看在租/待改派任务 |
| 资金 | 账单审核发布、渠道到账查询、退款申请/审批、还车结算；无人工标记“微信已到账” |
| 设置 | 人员与权限、已审定模板版本、审计；不展示新业务电子章/签署渠道配置向导 |

FIELD 仍从服务号 **员工入口 → 车辆交接** 进入 `https://admin.evsub.ndacar.com/field.html`，用独立 FIELD 账号登录。该入口已由用户配置，见 [菜单证据](../../evidence/ninda-field-menu.json)。工作台仅有“我的交车 / 我的还车”，按任务采集照片、读数、配件、车况、异常，发布客户核对，并上传纸质交接单。员工不能代客户确认、审核自己上传的文件、确认付款或最终完成交车。

## 4. 权限与资料范围

| 角色 | 合同与交接资料 | 业务权限 |
| --- | --- | --- |
| CUSTOMER | 本人已归档租赁/交还文件及已发布查验；未审草稿不对外展示 | 方案确认、本人付款、查验确认/异议、文件反馈 |
| OWNER | 本企业已归档合作/租赁文件及必要交还摘要；不见其他客户证件/信用记录 | 查看进度、联系运营、文件反馈 |
| ADMIN | 按用途查看、上传、提交、独立审核/作废；不能审核自己提交/参与上传的版本 | 人员、模板审定及管理动作；退款仍申请/审批分离 |
| OPERATIONS | 上传、提交、独立审核线下档案、处理反馈和异议 | 申请/方案、车辆/车主、派单/改派及交还完成；无资金写入 |
| FINANCE | 合同审核状态、金额/期限摘要和财务证据；无完整合同/身份证件/信用材料 | 发布账单、查款、退款与结算，不能批准合同 |
| SUPPORT | 脱敏订单/审核/付款/交接进度，不返回私密全文文件 | 客服跟进，不写交易事实、不审批 |
| FIELD | 本人有效任务和对应材料批次，纸质交接文件可上传不可审 | 采集、发布、补件；停用、改派即失去旧任务访问 |

所有列表、详情、总数、文件和旧通用接口都执行服务端记录与字段授权；不能仅隐藏按钮。客户 Bearer、后台 Cookie、车主 H5 Cookie 继续隔离，写入校验 Origin/CSRF及当前身份。

保留 v1.1 人员管理要求：五固定单角色、ADMIN 管人员、独立启停/改角色/改密/撤销全部会话、自锁及最后管理员并发保护、revision/authVersion、无密码审计、FIELD 离岗待改派。人员权限不会因关闭电子签而放宽。线上资料审核采用两名独立内部账号，提交人及该版本内部上传参与人均不能审批；ADMIN 无特例。

## 5. 线下文件与审核流程

### 5.1 文件类别和适用条件

| kind | subjectType | 默认签署/核对要求 | 作用 |
| --- | --- | --- | --- |
| OWNER_COOPERATION | OWNER | 车主、宁达；有效期、车辆覆盖、委托及服务安排 | 新正式方案的合作关系前置；线下授权条款随正式合作文件归档，不再要求电子授权流程 |
| RENTAL | ORDER | 客户、车主、宁达三方；主合同和费用附件 | 该订单首付及交车的合同前置 |
| DELIVERY_RECEIPT | HANDOVER | 客户、宁达经办人；三方合同要求车主签的，模板中列为必需 | 交车查验、纸质签字与操作证据 |
| RETURN_RECEIPT | HANDOVER | 同上；实际归还读数/时间/车况 | 正常完成还车及进入结算的证据 |
| TERMINATION | ORDER | 客户、车主、宁达；终止日期、应收应退及责任安排 | 已线下签署订单的取消/提前终止依据，不代替实际退款 |

三方主合同固定要求 CUSTOMER/OWNER/PLATFORM 齐签。其他文件必签人按已审定模板冻结，员工不可临时删减。纸质签署人可为有文件依据的合法经办人，审核记录核对其授权证明；不以电子签账号代替身份和授权核验。本文件规定产品流程，不代替正式文本审定。

合作文件覆盖指定车辆及拟租期，审核后可供多个订单引用，不每单重复签。单方历史授权不自动等价为完整合作协议，若既有线下资料已满足正式模板要求，可录入并审核为合作档案，无需为系统重复签同份文件。

### 5.2 业务流程

1. 已批准模板结合三方及商业快照生成可打印待签件；保存模板版本、源文件摘要、订单/车辆编号。打印和下载不创建供应商任务。
2. 三方线下签署完整纸质合同及附件；运营收集扫描件，记录签署日期、合同编号、原件保管人和位置。现场交接单由 FIELD/运营收集。
3. 上传并按页排序，核对文件类别、对应订单/交接单、版本和必签方；提交后文件清单不可变。
4. 另一名 ADMIN/OPERATIONS 查看全文及附件，核对三方身份/签章、授权依据、车辆、租期、金额、页数、修改处及附件齐全；审核通过或逐项退回。系统能校验身份/版本/金额快照等结构数据，不能声称自动识别纸面签章真伪。
5. 通过后标为“线下签署文件已审核归档”，客户/车主可读授权副本；记录真实上传人、审核人、时间及文件 SHA-256。归档动作与业务就绪判断原子完成，不直接伪造付款/交付完成。

文件版本状态：DRAFT（待提交）→ SUBMITTED（待审核）→ ARCHIVED（通过）或 REJECTED（退回）；已归档作废为 INVALIDATED。退回后新增版本，原审核记录只读。已归档版本不可覆盖，必要时 ADMIN/OPERATIONS 提出更正并由独立人员审核新版本。重大错误须先按专用 invalidate 动作记录原因、使原版本不再满足门禁；此动作不擦除历史签署或业务事实。

新版本草稿不会自动废止原有效归档；一旦商业条款或查验 manifest 变化，旧版本因摘要不匹配不能用于新动作。批准替代版本须核对当前业务快照，并在同一事务切换有效版本。确认方案后改条款必须重新出方案/受控变更、重新线下签署及审核，不能只换扫描件。

草稿阶段允许签署日期、原件保管信息和签署件为空，便于先生成打印件；提交审核时上述资料及完整文件清单必须齐全。正式三方模板须独立审定发布，不能直接把历史双方法律正文套用成三方合同。

### 5.3 文件与反馈规则

- 文件仅 PDF/JPEG/PNG，沿用内容魔数验证；每个不超过 10 MiB，每版最多20个、合计不超过50 MiB。保存原文件与排序清单；可生成预览，预览不替代原件。提交声明总页数，审核人工核对清晰完整。
- 上传必须绑定档案及当前版本/任务。后台泛用 adminId 或 customerId=null 不能当作文件可跨订单复用的授权；即使内容存储去重，逻辑归属仍独立。FIELD 上传仅当前任务专用接口。
- 客户、车主只读当前有效归档及本人/本企业历史版本，已作废版本标明不可用于履约。草稿、退回材料、审核人内部意见只对有权员工可见；客户补件说明另用白名单文案投影。
- 文件通过鉴权接口读取并 no-store，不发公开 URL，不在日志或提醒中包含证件/原件全文。
- 客户/车主可对具体版本提交问题反馈，状态 OPEN/RESOLVED。交付前未解决反馈阻断新支付意图和交车；不回滚已到账款。ACTIVE/SETTLING 时保留既定账单，但阻断新合同变更、争议部分结算和结单，运营核查并留处理证据。任何反馈不自动作废合同或直接退款。

## 6. 订单、查验交接与支付门禁

```mermaid
flowchart LR
 A[申请与资料审核] --> B[确认报价并占车]
 B --> C[三方线下签署]
 C --> D[上传及独立审核归档]
 D --> E[押金及首期支付]
 E --> F[员工查验与客户核对]
 F --> G[纸质交车单归档与运营完成]
 G --> H[用车及月账单]
 H --> I[还车查验与纸质归还单归档]
 I --> J[结算退款并结单]
```

新增订单阶段 `AWAITING_CONTRACT_REVIEW`，页面细分为待线下签约/待上传/待审核/待补件；之后沿用 AWAITING_PAYMENT、AWAITING_HANDOVER、ACTIVE、SETTLING、COMPLETED/CANCELLED。原 AWAITING_SIGNATURE 仅历史电子签订单使用。

| 动作 | 服务端条件 |
| --- | --- |
| 发布正式方案/客户确认 | 客户资料与适用信用审核合格、车主及权属有效、合作档案覆盖、报价版本正确、并发占车校验 |
| 发布首付账单/新建或复用支付参数 | 本单三方合同当前有效归档、商业快照匹配，无交付前未决文件反馈；所有 pay 入口检查，不能靠按钮或账单状态保证 |
| 交车查验发布 | 合同就绪、首期及适用押金足额净到账，无相关退款在途，当前车辆批次与派单有效 |
| 完成交车 | 上述条件仍成立＋客户确认当前 manifest＋纸质交车单同版归档＋无异议，由 OPERATIONS/ADMIN 操作 |
| 正常完成还车 | 当前车辆归属、读数不倒退、客户确认当前查验、同版纸质归还单归档、无未决异议；不要求先付清欠款才接收车辆 |
| 最终结单 | 未来未履约账单按规则处理，应收/应退核清、退款成功、无未知交易与未决争议 |

实物已归还但客户不确认/材料不齐时，员工仍记录实际收车时间、读数和保管位置，建立“已收车待核验”事件；不得抹掉收车事实或继续按尚未归还生成后续月账单。运营处理差异，车辆保持不可售；该事件不等于完成交接/结清。首版通过专用 received 动作实现，不能由备注猜日期。租金截止及最终应收仍按已签条款和审核后的结算计算。

账单生成、发布和新支付请求都检查当前实物收车事件；收车后未来未履约期间的账单暂停处理，过去已履约无争议账单仍可支付。在途付款仍按真实渠道结果入账再核对，不用删账单隐藏实际款项。归还日期核实前不自动减免已发生费用。

取消不能仅检查旧电子签 SIGNED 字段。申请未成单仍按原规则取消；已确认OFFLINE订单先登记取消审核，核对纸质签署及在途资金。签署情况 UNKNOWN 时只受理申请，不释放占车或结束订单；独立审核证明 UNSIGNED 且无未知/待退资金才允许直接取消；SIGNED 或已经有有效/历史租赁归档的订单须三方 TERMINATION 档案通过，再完成资金处理。已交车订单先走还车/结算。合同资料退回不代表线下从未签署，不能据此绕过终止文件。

支付继续微信渠道回调验签、金额/币种/商户/AppID/订单核对、幂等及原交易查询；支付成功来自渠道证据。合同归档在支付请求后被作废时，迟到可信到账仍如实记账，订单进入人工异常处理，不能丢弃回调、重复扣款或自动交车。退款保持独立申请/审批，不因合同退回自动退钱。

交接事实确认、纸质单归档、运营完成三个动作独立；所有修改创建新材料版本，旧客户确认失效。无手机/拒绝确认属于异常收车/待处理，不提供员工代点确认入口。

## 7. 数据与 API 契约增量

权威契约仍为 [api-contract.md](../../api-contract.md) 和 [api-owner-h5.md](../../api-owner-h5.md)，实施 O01 先同步，本轮不标记新增接口已可用。

### 7.1 模型

- `FinalPlan.contractMode`、`Order.contractMode` 与 `Contract.executionMode`：ESIGN / OFFLINE；历史记录迁移为 ESIGN，新方案服务端显式冻结OFFLINE并纳入commercialHash，客户确认按该方案模式创建订单，并保存三方及所引用合作档案版本。Contract.offlineArchiveId关联本单RENTAL档案，Handover.executionMode 从订单冻结；旧任务不得因开关变化改模式。
- 新增 `DocumentArchive{id,kind,subjectType,subjectId,ownerId?,orderId?,handoverId?,revision,currentApprovedVersionId?,createdBy,createdAt}`。同 subjectType/subjectId/kind 唯一；OWNER_COOPERATION 的车辆覆盖、有效期存于版本快照。
- 新增 `ArchiveVersion{id,archiveId,version,status,templateId,templateVersion,sourceFileId?,businessSnapshotHash,partiesSnapshot,requiredSigners,signedOn,contractNumber,originalCustodian,originalLocation,declaredPages,scopeSnapshot,submittedBy?,submittedAt?,reviewedBy?,reviewedAt?,reviewChecklist?,partyChecks?,reviewReason?,invalidatedBy?,invalidatedAt?,invalidationReason?,createdAt}`；同 archiveId/version 唯一。
- 新增 `ArchiveFile{versionId,fileId,position,uploadedBy,uploadedRole}`，版本内顺序及 fileId 唯一。SUBMITTED 及终态不可修改；所有内部上传参与人都纳入自审限制。
- 新增 `ArchiveFeedback{id,versionId,actorType,actorId,message,status,resolvedBy?,resolution?,createdAt,resolvedAt?}`。审批及反馈/作废/支付/交付以同一订单锁顺序串行校验。
- 新增 `OwnerBusinessVerification{ownerId,revision,status,legalRepresentativeId,profileRevision,evidenceFileIds,submittedBy,reviewedBy,reviewedAt}`，status=PENDING/APPROVED/REJECTED/REVOKED；不写入原电子认证/证书结果。法人档案或成员关系变更即失效，当前申请人与审核人分离。
- 新增 `VehicleReceiptEvent{id,handoverId,orderId,assignmentId?,revision,previousEventId?,isCurrent,receivedAt,readingKm,storageLocation,evidenceFileIds,correctionReason?,createdBy,createdAt,idempotencyKey}`；同handoverId/revision唯一，数据库部分唯一索引保证一张归还单只有一个isCurrent=true事件。FIELD只能初次登记；更正仅ADMIN/OPERATIONS带原revision、previousEventId及原因创建新修订，原事实留存。写入后暂停未履约未来账单生成并标为待核验。
- 新增 `OfflineCancellationReview{id,orderId,revision,paperStatus,reason,evidenceFileIds,submittedBy,reviewedBy?,reviewedAt?}`，paperStatus=UNSIGNED/SIGNED/UNKNOWN；独立运营复核，只允许一个当前审核版本。与已记录归档事实矛盾的 UNSIGNED 不接受，UNKNOWN 不放行取消。
- 幂等沿用项目唯一约束与事务模式，为档案动作增加 `ArchiveCommand{actorId,resourceId,action,key,requestHash,resultSnapshot,createdAt}`，联合唯一；不存文件正文/秘密。角色和当前访问资格先于幂等回放校验。

OFFLINE 合同对外投影 `executionStatus=OFFLINE_PENDING/OFFLINE_APPROVED/OFFLINE_INVALIDATED`；内部旧 `Contract.status`、`signatureStatus`、`providerTaskId` 和 `signedFileId` 不被改成伪造的电子签成功。OFFLINE 状态以关联有效归档为准，所有旧列表及门禁调用统一适配器；不能只修改新工作区。

### 7.2 API 与行为

均在 `/api` 下，列表统一分页 `{items,total,page,pageSize}`，pageSize最大100。除反馈、上传外的新写动作均带 revision、idempotencyKey；反馈带 versionId 和 idempotencyKey，上传带 archiveId/versionId 或 fieldTaskId/taskVersion。409不自动重做确认。

| 路径 | 行为与权限 |
| --- | --- |
| GET `/admin/offline-archives`、`/:id` | ADMIN/OPERATIONS 查询审核队列/详情；其他内部角色经各自工作区只取安全摘要 |
| POST `/admin/offline-archives` | 创建主体/类别档案及首个版本；校验 subject、模板和三方快照，幂等 |
| POST `/admin/offline-archives/:id/versions` | 新增草稿或退回后的版本，不覆盖已提交版本 |
| POST `/admin/offline-archives/:id/versions/:versionId/prepare` | revision,idempotencyKey；从已批准模板和当前业务快照生成本版打印件，返回sourceFileId/sourceSha256；不调用供应商 |
| POST `/admin/offline-archives/:id/versions/:versionId/files` | multipart `file`、position；绑定本草稿并返回受保护文件引用 |
| PATCH `/admin/offline-archives/:id/versions/:versionId` | 更新草稿签署元数据/排序；版本校验，非DRAFT拒绝 |
| POST `/admin/offline-archives/:id/submit` | versionId,revision,idempotencyKey；冻结文件清单和快照，提交待审 |
| POST `/admin/offline-archives/:id/review` | versionId,revision,decision=APPROVE/REJECT,checklist,partyChecks,reason,idempotencyKey；仅独立审核人，原子生效 |
| POST `/admin/offline-archives/:id/invalidate` | versionId,revision,reason,idempotencyKey；使指定归档不再满足新动作，保留文件及审计 |
| GET `/{audience}/offline-archives/:id/versions/:versionId/files/:fileId` | audience=admin/customer；服务端按记录/版本/文件三重归属；无裸文件下载绕过 |
| GET `/customer/orders/:id/workspace`、`/customer/workbench` | 本人订单/待办，合同、账单、交接分别投影 |
| GET `/owner-h5/owners/:ownerId/workbench`、`/vehicles`、`/orders`、`/orders/:orderId/workspace` | 当前经核验企业关系、本企业出租订单，必要字段 |
| GET `/owner-h5/owners/:ownerId/offline-archives/:id/versions/:versionId/files/:fileId` | 当前关系＋本企业档案，未归档版本不可访问 |
| POST `/customer/offline-archives/:id/feedback`、`/owner-h5/owners/:ownerId/offline-archives/:id/feedback` | versionId,message,idempotencyKey；本人/本企业合同问题，不修改合同事实 |
| POST `/admin/offline-archives/:id/feedback/:feedbackId/resolve` | revision,resolution,idempotencyKey；运营记录核查结果；事实有误须更正归档后解决 |
| POST `/admin/vehicle-owners/:id/business-verification/submit`、`/review` | 登记证据/独立复核当前法人和企业资料；不创建供应商账号 |
| POST `/admin/field-tasks/:taskId/offline-receipt/files`、`/submit` | FIELD 本人任务纸质单上传/提交；绑定 taskVersion/handoverId/manifestHash，由运营独立审核 |
| POST `/admin/handovers/:id/received` | FIELD 本人归还任务或OPERATIONS/ADMIN记录实物接收；receivedAt/readingKm/storageLocation/evidenceFileIds/revision/idempotencyKey |
| POST `/admin/handovers/:id/received-corrections` | OPERATIONS/ADMIN以previousEventId/revision/correctionReason及更正事实新建修订；不覆盖原事件或直接改已结算账单 |
| POST `/admin/orders/:id/offline-cancellation/submit`、`/review` | paperStatus、证据及原因提交；另一名运营复核。供既有cancel动作检查，不直接取消/退款 |
| 既有方案、支付、客户查验、改派、交还完成、退款接口 | 保持入口，内部按冻结模式调用新归档门禁；资金流程不换接口 |

后台工作台 GET `/admin/workbench` 和订单 GET `/admin/orders/:id/workspace` 统一返回 `mode,stage,stageText,nextAction,blockers,parties,contracts,billing,handovers,timeline,capabilities`。`nextAction={code,label,resourceType,resourceId,enabled,disabledReason?}`；code 固定 VIEW_PLAN/CONFIRM_PLAN/CONTACT_OPERATIONS/UPLOAD_OFFLINE_DOCUMENT/REVIEW_OFFLINE_DOCUMENT/VIEW_ARCHIVE/PAY_BILL/COLLECT_HANDOVER/CONFIRM_INSPECTION/OBJECT_INSPECTION/REASSIGN_HANDOVER/RECORD_VEHICLE_RECEIPT/COMPLETE_HANDOVER/REVIEW_SETTLEMENT/REVIEW_REFUND。不包含签署动作或任意外部URL；GET无副作用。`stage`为订单状态；申请待办保持独立Application资源。

ArchiveSummary 固定 `{id,kind,revision,executionMode:'OFFLINE',status,currentApprovedVersionId,pendingVersionStatus?,canRead,blockers}`；有匹配当前业务事实的有效归档时status=ARCHIVED，候选新版状态单独显示，不覆盖原有效结论；否则按最新版本或INVALIDATED展示。内部审核字段不外发。审核 checklist 固定 `partiesComplete,authorityChecked,pagesComplete,vehicleMatches,termsMatch,annexesComplete,legible,originalRecorded`；partyChecks逐方记录 `{role,partyId,signerName,signedOn,signaturePageRefs,authorityFileIds?,passed}`，每个必签方均需passed=true且页码引用属于本版，签署身份匹配冻结主体。批准时全部检查项为true且有非空核查说明；人工勾选不能替代服务端结构校验。

错误：沿用 UNAUTHENTICATED/FORBIDDEN/REVISION_CONFLICT/IDEMPOTENCY_CONFLICT；新增409 OFFLINE_ARCHIVE_REQUIRED、ARCHIVE_SNAPSHOT_MISMATCH、ARCHIVE_SELF_REVIEW、ARCHIVE_FEEDBACK_OPEN、OWNER_BUSINESS_UNVERIFIED；403 ESIGN_INITIATION_DISABLED；400 ARCHIVE_FILE_INVALID。越权对象统一404，角色入口拒绝403，避免枚举记录。

## 8. 旧业务兼容与发布

本轮只核对本地代码与交付记录，未读取生产当前配置/订单数量。2026-10-22记录的法人手签能力、2026-10-25的手签设计不能推定线上无在途任务。

新增 `NEW_ORDER_CONTRACT_MODE=OFFLINE` 与 `ESIGN_NEW_REQUESTS_ENABLED=false`：前者只影响新订单冻结，后者统一阻断所有新业务签署/授权/证书与印章办理、打印即上传供应商、提醒重试及自动任务发起。现有细分签署开关即使误开，也不能越过总门禁；历史查询/验签回调/文件归档走显式恢复路径，必须保证零签章派发。

OFFLINE部署缺失法大大凭据时API仍须正常启动；供应商适配器采用延迟初始化或明确不可用实现，不能用Mock成功代替。历史恢复缺少原渠道配置时返回明确不可用并保持原状态，不阻断新线下订单、人工企业资格或微信支付。

未确认申请在切换后重新出带OFFLINE模式的方案并由客户确认。已确认订单保留原模式：已电子归档按原证据履约；未完成电子签不静默改成OFFLINE。上线前逐笔列清，无在途才可直接切换；发现遗留在途则须先形成明确人工处置清单，禁止新签署，保留查询/回调，未解决的订单不得宣称本版已全量覆盖。跨模式转换不列本版常规入口。

历史签署回调仅推进匹配的历史ESIGN任务，不能解锁OFFLINE订单。关闭发起不关闭可信回调接收；不能因客户端已隐藏入口而放过旧API。旧签署系统/授权资料不物理删除。

先部署兼容迁移和API，再切三端；回滚关闭新订单/新写入，恢复理解两种模式的兼容版本。不能回滚到忽略人工审核与合同模式的旧门禁，不能把已归档线下文件转换成电子签证据。

## 9. 验收与交付

1. 不配置法大大API凭据、注册或印章，仍能在隔离环境完整跑通：企业资料/合作文件审核→客户确认→三方线下文件上传→独立审核→押金首付→查验确认→纸质交车单审核→交车→月账单→还车→归还单审核→结算退款。
2. 三方缺签、缺附件、文件不清、自己审批、旧版本、跨单文件、并发审核/作废/付款、客户异议均有明确失败与恢复路径。
3. 查验确认不变成签署成功；退款受理不变成到账；文件归档不直接变成车辆已交付；所有电子签发起请求/后台任务计数为0。
4. 实物已收车但客户未确认时，保留事实、暂停未来账单、不可售，补齐证据后继续结算；欠费不会阻止记录收车。
5. 回归五角色、客户/车主归属、FIELD改派/停用、私密文件、支付回调、未知结果恢复、旧ESIGN回调及在途归档；全量验证不能只覆盖新的“无变更条款”分支。
6. 客户/车主/员工手机375与430宽度及后台1280宽度可完成关键操作；空态、补件、401/403/409、重复点击和断网恢复均可用。
7. 正式模板由用户审定；真实支付/退款按明确范围验收。线上页面和微信包分别核对版本，合成检查不代替真机或真实渠道验收。
