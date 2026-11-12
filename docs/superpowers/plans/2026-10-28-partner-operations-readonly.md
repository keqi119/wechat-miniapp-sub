# 合作商运营维护与只读入口开发计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development 或 superpowers:executing-plans，按下列依赖和验收推进。未勾选项均未实施，旧v2.1通过记录不得当作本轮完成。

**Goal:** 运营依据线下协议独立完成合作记录、车辆及分润维护；合作商仅凭后台授权手机号从服务号查看，不依赖客户小程序账户。

**Architecture:** 分离合作业务资格、外部只读授权、内部操作权限。保留原主体/车辆/档案/账本ID和历史快照，兼容迁移后将合作商H5改为明确的只读接口集合。

**Tech Stack:** 现有Node/NestJS/Prisma/PostgreSQL、React/Vite；不引入新认证供应商，复用短信通道及严格会话/CSRF机制。

**Spec:** [v2.2设计基线](../specs/2026-10-28-partner-operations-readonly-design.md)。接口目标见[API增量v2.2附录](../../api-seven-module-mvp.md)。

## 全局约束

- 只在本项目和宁达独立环境工作；旧库只读，生产不得重做空库切换。主控维护schema、迁移、依赖锁及发布清单。
- 金额整数分、比例整数bps；归属、权限、版本冲突、事务幂等、真实资金及回调检查保留。
- 用户已确认平台20%，计提基础仍留空；实现草稿可留空，不自动猜计提口径或激活不完整规则。
- 合作商业务写入口关闭；认证短信/登录/退出例外必须逐项列明，不能按HTTP方法或前端按钮粗略判断权限。
- 运营经办/复核分权且不同实际人员复核，权限配置变化立即撤销相应旧会话；管理员不能绕过自审。
- 本轮不改变客户小程序1.1.5已验收的页面；除有必要客户端接口兼容变更并完成验证外，不重新上传小程序。
- 不执行真实短信、支付、签章或人工审批来代替测试；真实验收需对应实际参与人及范围。

下文新测试文件均位于`apps/api/test/`。从项目根目录执行安全测试入口时，参数使用`test/<文件名>.test.ts`；该入口校验本项目独立测试库并串行运行，不能直接拿生产连接执行。前端命令也从根目录执行。

## 审阅重点

1. 合作资格不得间接继续依赖Customer、手机号验证或PartnerPortalAccess状态。
2. 查看手机号改动不得触发owner业务版本、已签PDF摘要、权属或分润失效；旧会话和旧验证码却必须失效。
3. 同手机号跨多家仅能读明确授权范围；逐单客户资料共享和文件权限不得因“只读”而放宽。
4. 新只读用户和旧链接不能继续调用claim、认证、反馈、签署、同步、修改等旧H5业务接口。
5. 运营财务授权须覆盖后端、前端、文件及旧接口，不能只开放菜单；编制/提交/上传人自审、重复结算及晚到到账仍需拒绝。

## R1：合作资料与客户账户解耦

**文件：** `apps/api/prisma/schema.prisma`及新兼容迁移；`apps/api/src/partners/{types,admission,identity,vehicle-binding,revenue-rules}.ts`；`apps/api/src/offline-documents/{readiness,archive.service,context,snapshot,partner-access}.ts`；`apps/api/src/owner-signing/lessor.ts`；`apps/api/src/orders/business-gates.ts`；`apps/api/src/vehicles/application-eligibility.ts`。

**接口：** `approvedPartner(tx,owner)`改为验证当前纸质合作资料核对版本；`PartnerAdmissionService.submit/review`不再要求`identityBindingId`。保存签署代表资料与依据，不以`customerId`为业务必填。合作资料的已审核版本、车辆及协议引用仍由服务器读取。

- [x] 先写 `test/partner-offline-cooperation.test.ts`：没有Customer、没有查看手机号时可建草稿并按真实合成材料完成合作；缺协议/出租权限仍拒绝生效；个人无需企业代码。
- [x] 写“查看手机号变更不改变可申请资格／业务摘要”“主体实质变化仍复核”“同车并发转绑失败”“合作草稿与费率口径空白不可激活”回归，运行确认RED。
- [x] 扩展独立合作资料版本/审核依据，拆除账户前置；区分主体法定信息、普通联系信息和访问授权版本。保留旧identity记录及审计，旧已核准资料必须有明确、可验证的迁移映射。
- [x] 版本化新出租方快照及合作摘要，保持旧`lessorIdentityHash`、已签字节、旧客户单独同意原样有效；新增和迁移路径均不能生成占位identityBinding或重算旧哈希。
- [x] 修正合作协议草稿建立与权属准备的依赖：可保存待补草稿，只有当前审核、协议和规则齐备才可用于新订单；不得因“允许草稿”放行生效。
- [x] 运行新测试及既有 `partner-admission`、`partner-identity-isolation`、合作资格和线下档案相关套；构建API，审阅新旧订单快照、合同摘要和迁移回滚边界。

定向命令：`node scripts/run-mvp-api-tests.mjs test/partner-offline-cooperation.test.ts test/partner-admission.test.ts test/partner-identity-isolation.test.ts test/offline-cooperation-hash.test.ts test/offline-owner-consent.test.ts test/offline-owner-access.test.ts`；构建`pnpm -C apps/api build`。新增文件创建后执行，结果需记录实际通过数。

## R2：运营经办与复核能力

**文件：** `apps/api/src/auth/{role-policy,staff.types,staff.service,access}.ts`、schema/人员权限迁移；`partners/{types,revenue-types,settlement-controller,settlement-payments,settlements,revenue-rules}.ts`及专用文件路由；`apps/admin/src/{core,staff,partner-finance,domain-ui}.ts(x)`。

**接口：** 在固定岗位角色之外提供服务端可校验的合作资料、查看授权、规则、账户、结算、实付等动作能力；`requirePartnerCapability(tx,actor,capability)`集中读取当前授权。保留`revision/idempotencyKey`及独立审核检查；不以角色名FINANCE作为唯一门禁。新能力清单见API目标附录。

- [x] 写 `test/partner-operations-permissions.test.ts`：运营经办能提交不能擅自复核，运营复核能审核他人不能审核本人/上传材料，ADMIN同样不绕过；撤权后旧会话立即拒绝。
- [x] 增加内部稳定人员标识/账号归属及“同一实际人员的两个账号互审失败”测试，复核校验覆盖编制、提交、上传人员映射；迁移归属由管理员核实，不靠姓名/手机号推断或补造人员，不扩大证件采集。
- [x] 覆盖规则复核、收款账户、结算编制与复核、实付登记和实付核对的完整动作矩阵，包含旧通用接口和专用附件。
- [x] 实现最小能力授权、人员配置和审计；旧FINANCE保留历史，迁移不给任意员工自动全部权限。未知能力拒绝，最后管理员保护和FIELD边界保持。
- [x] 前后端统一用服务端能力决定入口，复核界面显示当前提交版本及真实经办人，完整账户仅向相应权限开放。
- [x] 新测试＋既有staff、partner-revenue/settlement/payments相关套通过；检查客户资金权限是否受影响，若受影响补对应到账/退款回归，不能用合作分润测试代替。

## R3：手机号只读授权及登录

**文件：** 新建 `apps/api/src/partners/portal-access.ts`、`portal.controller.ts`；schema新增`PartnerPortalAccess`、`PartnerPortalSession`及登录挑战记录；修改 `owner-h5/{auth.controller,access,offline-access,legal-representative,service,config}.ts`，路由注册按现有模块机制接入。

**接口：** `/admin/partners/:ownerId/portal-access`及submit/review/disable；`requirePartnerReadAccess(tx,session,ownerId)`逐次核对授权版本。H5沿用`/owner-h5/auth/sms/request`、`/auth/login`、`/auth/logout`，新session不含Customer外键前置。短信挑战须带不可推断的`challengeId`并绑定发码时的手机号与授权版本。

- [x] 写 `test/partner-portal-access.test.ts`：后台登记未注册客户手机号、独立启用后正常登录；未分配/停用手机号不泄露合作商列表，不获得会话。
- [x] 写授权范围变更、改号后旧验证码、改回原号、发码与登录之间撤权、验证码重放/过期/限频、同手机号多主体以及撤销其中一家等测试，确认RED。
- [x] 实现访问授权独立版本和审计；手机号受保护存储与脱敏，登录前统一响应；验证短信后事务内再次比对挑战及当前授权，再一次性消费挑战并签发会话。
- [x] 仅明确授权的只读主体可读取合作数据；客户Bearer/后台Cookie/旧客户依赖会话不能成为新只读会话，更新账号不改变业务owner版本或合作就绪。
- [x] 使用现有短信网关合成替身跑新测试和`owner-h5-auth`等回归；无真实发码或自动邀请。验收退出、撤权、错误主体、文件与下载权限。

## R4：H5服务端业务只读与安全投影

**文件：** `apps/api/src/owner-h5/{access,owners.controller,contracts.controller,handovers.controller,service,offline-access}.ts`；`apps/api/src/offline-documents/{archive.controller,workspace.controller,archive.service,workspace.service,projection,partner-access}.ts`；`apps/api/src/partners/{identity,settlement-controller}.ts`；`apps/api/src/orders/seven-module-views.ts`；全体现有`owner-h5`路由和旧自动签署入口逐项清点。

**接口：** 保留明确的GET业务投影与只读文件接口。认证POST白名单之外的外部业务写请求返回403；不存在路径仍404。历史反馈只读，运营端处理；供应商回调隔离保留，不允许H5读取触发refresh/sync。

- [x] 写 `test/partner-portal-readonly.test.ts` 参数化路由矩阵：资料修改、claim、身份刷新、签章授权、合同/交接sign/sync、档案/结算feedback全部拒绝，大小写/尾斜杠/编码路径不绕过。
- [x] 测试GET也不越权：草稿结算、完整收款账户、客户证件/风控、其他合作商文件、未获逐单共享同意等不可读；缺配置不回退到旧写权限。
- [x] 改各业务投影使用`requirePartnerReadAccess`，显式DTO白名单；保留历史账本、原PDF、未解决争议和回调事实。
- [x] 移除只读请求中的供应商/审批副作用，业务写入口在guard和服务层覆盖；运行新旧H5/文件隔离/回调相关回归。

## R5：后台连续办理与合作商只读页面

**文件：** `apps/admin/src/{partners,partner-finance,domain-ui,staff}.tsx`及必要字段模型；`apps/signing-h5/src/owner/{App,Login,OfflineWorkspace,OfflineArchive,PartnerProfile,PartnerSettlements,PartnerPolicies}.tsx`、`client.ts`、`workspace.ts`、样式和对应测试。

- [x] 用真实组件和合成接口先覆盖：合作商详情不出现已注册客户/已核验身份关系选框；支持没有查看账号的合作草稿；缺项、退回和下一步明确；切换记录不串输入。
- [x] 保持车辆详情式双页签抽屉。新增“管理查看账号”独立表单；经办/复核自动取内部员工，合作签署代表为人工资料；后台资金按钮按R2能力显示。
- [x] H5改为合作概览、车辆、订单、分润结算；无修改、反馈、上传或签署按钮，客户端不保留可直接调用的业务写方法；手机号登录不出现客户小程序注册提示。
- [x] 同一手机号多合作商可切换，仅展示获授权且已发布资料；查询失败保持清晰状态，撤权时清理旧显示；联系电话可拨打，资料更正交运营线下办理。
- [x] `pnpm -C apps/admin test`、`pnpm -C apps/admin build`、`pnpm -C apps/signing-h5 test`、`pnpm -C apps/signing-h5 build`通过；本地真实组件检查桌面、390/320窄屏、只读权限、空态、返回位置及二次打开。

## R6：合成全流程、迁移和受控发布

- [x] 新 `test/partner-operations-readonly-journey.test.ts` 串联：无Customer→运营建立纸质合作草稿、准备车辆范围和未生效规则→提交完整合作资料→另一位运营复核各关联版本、全部就绪→可申请→合成收退款来源→两名运营完成结算与实付核对→授权手机号登录只读。缺任一领域审核仍不可申请；同人换账号自审及H5写口均拒绝。
- [x] 按R1–R5运行受影响API全量范围、完整后台和H5测试；测试目标通过 `node scripts/run-mvp-api-tests.mjs ...` 安全入口确认独立测试库，禁止生产业务测试。主控核对基线全部10项验收证据。
- [x] 在项目独立环境验证迁移及恢复：旧主体/车辆/文件/订单/分润快照、历史身份记录与争议保留；当前三家没有身份绑定不应被迁移自动批准，也不要求先补客户账号绑定。
- [x] 单独冻结API/后台/H5候选及精确源码清单，检查权限变化与兼容读取；preserve备份恢复验证后受控发布，不复用空库初始化入口。旧版本回退若会重启H5写口，应先禁用外部H5，不能静默扩大权限。
- [ ] 验证服务号合作商入口、本人短信登录、只读页面、运营经办/复核和即时撤权；真实短信及实际参与范围由当事人配合，不能以合成结果声称已完成。
- [x] 更新API契约、办理指引及发布证据，明确源码、服务器、菜单、真机与真实业务分别完成到哪一步。仅基线调整不解除现网门禁、不改变真实合作和审批事实。

依赖：R1与R2可分文件并行；R3依赖schema协调但可与合作业务逻辑并行；R4依赖R3；R5按稳定接口分后台/H5并行；R6等全部通过。schema、人员授权模型及锁文件由主控统一处理，禁止并行覆盖。

## 2026-10-28实施结果

v2.2已发布并完成技术验收，API254/254、后台153/153、H555/55，独立审阅问题全部关闭；保留迁移校验110张原业务表一致。详见[发布记录](../../evidence/ninda-partner-operations-v22.md)。唯一未勾选的实际参与人步骤保留：管理员核实内部人员并配置权限、实际手机号授权及本人短信登录、真实材料审核。这些不能由合成测试或自动迁移代替，不表示仍需开发客户注册或经办绑定功能。
