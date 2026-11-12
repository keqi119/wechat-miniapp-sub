# 客户资料与订单审核实施计划

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 个人资料、独立实名认证、申请及订单审核贯通，并保持协议阅读和换牌后的关联连续。

**Architecture:** 沿用 NestJS/Prisma、原生小程序、React后台。明确分类的个人资料存入既有JSON；申请/订单使用服务器快照，实名复用供应商可信结果与加密绑定。无必要不新增数据库迁移。

**Spec:** `docs/superpowers/specs/2026-10-28-customer-profile-order-design.md`

## 约束与分工

- 仅本项目修改，保留现有未提交成果；不提交、推送、改旧系统或生产Mock。
- 根依赖、发布、生产只读诊断由主控。数据库测试只用经守卫验证的本机测试库，测试运行由主控串行调度。
- API资料代理只写 customers、applications、orders/customer.ts、operations/admin.ts及相关测试；主控只写 esign、vehicles/commands.ts及对应测试/必要注册。双方对共享文件先协商。
- 小程序代理独占 apps/miniprogram；后台代理独占 apps/admin。不改reference原样副本。

## 风险关注

1. 旧附件未分类，不猜证件类型；旧申请不冒充历史快照。
2. 仅恢复实名能力，不重新开放电子签；query/callback保持任务和加密身份绑定。
3. 客户更改档案、退出登录或请求迟到，不覆盖新会话或原审核依据。
4. 业务幂等重试读取原结果；私密附件及证件只给授权审核员。
5. 换牌继续引用同一vehicleId，VIN不可复用或普通编辑更换。

## 任务

### 1. 资料接口和服务端审核资料

- [x] 先写并运行失败测试：缺实名/缺证件申请拒绝、完整档案快照、外人文件拒绝、版本/幂等、旧申请补件及角色隔离。
- [x] 实现 `GET/PUT /customer/profile`，GET返回revision/name/mobile/drivingYears/三个分类FileId/files/readiness；PUT含revision/idempotencyKey并允许暂存缺项。
- [x] 申请提交/补件和确认从服务端读档案及可信实名，冻结快照；普通请求不接受伪造快照。保持原幂等语义。
- [x] 实现 `/admin/applications/:id/customer-profile` 与 `/admin/orders/:id/customer-profile`，明确来源、快照和当前补充资料；文件继续校验归属。
- [x] 运行相关API测试及构建，补充独立审阅。

### 2. 独立实名与 VIN

- [x] 失败测试覆盖OFFLINE实名可独立启用、签署仍禁用、独立隐私同意、证书接口不调用、可信姓名匹配及未知状态关闭。
- [x] 主控实现 `/public/identity-config` 和 `/customer/identity/{readiness,register,verify,refresh}`，导出 `readCustomerIdentityEvidence(tx,customerId,expectedName)`，不用前端传入成功结论。
- [x] 先测试后强化VIN创建/修改规则及换牌关联稳定性；复用已有唯一索引，不转换内部外键。
- [x] 运行实名/原签署隔离/VIN及业务回归。

### 3. 小程序流程

- [x] 用真实Page行为测试重现当前缺少的三类证件、实名门槛及账户设置分流问题。
- [x] 合并个人资料/登录/协议/客服/退出，设置路由兼容跳转；更新实名独立能力及返回流程。
- [x] 申请前读取readiness、缺项引导、完整后手动提交；保留车辆/套餐及返回位置。
- [x] 协议页面排版，主流程大段文案改逐项链接，保留冻结文档和已有同意约束，移除账户设置按钮。
- [x] 小程序全量测试、源码检查、模板构建和320/390宽视觉核验。

### 4. 后台资料与排版

- [x] 先测试申请/订单读取新DTO、旧单当前补充标记、文件权限错误和换记录防迟到响应。
- [x] 申请及订单客户资料统一显示基本信息、证件与实名；只读受保护预览/下载。
- [x] 通用长文本正确分段，VIN字段/查询标识明确。
- [x] 后台全量测试、构建和窄宽抽屉视觉核验。

### 5. 集成发布

- [x] 更新接口文档/操作指引，交叉审阅各端真实契约与安全边界。
- [x] 固定源码清单及工件，保留当前生产数据备份/恢复核验，检查精确差异再发布独立API和后台。
- [x] 线上只读检查指定申请的客户资料来源、文件数量、角色边界、服务健康及数据保留。
- [x] 上传独立小程序1.1.6，记录官方CLI成功结果；未自动设体验版或正式发布。
- [ ] 体验切换与本人实名真机验收单独确认，不宣称自动测试代替本人核验。线上浏览器目视因Windows URL安全检查拒绝已停止，API/工件核验通过。

2026-10-28 发布前状态：任务1–4及文档/交叉审阅已完成，证据见 [本轮实施与验证记录](../../evidence/ninda-customer-profile-order.md)。目前仅冻结441个服务器源文件和111个小程序源文件，尚未完成本轮正式上线、线上验收或小程序上传；上方发布复合任务保持未勾选，真实执行结果由主控补录。
