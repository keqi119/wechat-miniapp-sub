# 独立技术签署验收实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Task owners work in disjoint directories and request the shared Git commit window.

**Goal:** 让指定已实名客户与上海晓浪网络科技有限公司签署已批准的技术验证文件，真实同步双方签署及归档结果，不创建商业订单。

**Architecture:** 新增独立 `TECHNICAL_ACCEPTANCE` 资源，复用现有法大大任务、原生签署入口、PDF及双人用印策略；明确分派回调及结果归档。独立开关仅开放此类文件，正式合同签署开关继续关闭。

**Tech Stack:** 现有 NestJS、Prisma/PostgreSQL、React/TypeScript、微信原生小程序、法大大原 API。

**Spec:** `docs/legal/drafts/technical-signing-verification-v1.md`（用户2026-10-16批准完整文本）、`docs/superpowers/specs/2026-10-16-miniapp-independent-platform-design.md`（既有授权及双人用印要求）。接口细节由 Task 1 写入 `apps/api/technical-acceptance-contract.md` 后，Task 2/3 据此实现。

## Global Constraints

- 用户此前批准生成计划后直接施工；本次新增确认是文本批准。本人签署、本文件企业用印分别由实际人员操作，不能由程序或主控代替。
- 沿用现有独立项目开发分支，分配 API/后台/小程序目录避免并行覆盖；旧系统和数据库只读，禁止旧库测试。生产变更由主控统一执行。
- 不创建 Order、Bill、Payment、UsageAccount、交接、库存、信用或权益变化；不使用零元/虚构租赁订单承载验证。
- 保持15份固定来源文件及109×2 Mock文件哈希；密钥、证件、会话、短签署URL不入日志、聊天、Git或本地持久前端缓存。
- `TECHNICAL_ACCEPTANCE_SIGNING_ENABLED` 默认 false；启用后也不打开 `FADADA_SIGNING_ENABLED`、普通支付和换车购买开关。
- 按持久记录 customerId 限定参与者；每份已解析正文和PDF冻结hash，版本变动重新确认及审批。正文只用实名姓名、脱敏手机、验证编号、生成时间及双签位置。
- 180天清理只处理本验证独立记录与文件，不能误删共享实名/证书/授权；保留未结争议及法定必要证据并审计。

## Review Focus

- query 可能自动用印，开关关闭及停止参与必须禁止新的签署/章调用，仍可核对迟到结果；不能把停止当渠道撤销成功。
- 部分签署、归档失败、重复/乱序回调、过期lease不能误标完成或重复章。
- 客户换号/登出、重复点击、旧异步响应不得泄露或覆盖其他会话的记录、正文和签署页。
- 完整PDF/签后文件只向本人及明确授权角色提供，不因通用文件下载接口绕过归属。
- 资料到期复核、停止请求、重新生成及真实供应商在途必须保留原事实，不覆盖已签文本或重置事实。

## Task 1 API独立资源与签约状态

**Owner:** API implementer, only `apps/api/**`. 主控维护根依赖及已批准文案。

**Files:** 新增 `apps/api/src/technical-acceptance/` controller/service/template/signing及必要细分；新增迁移 `202610160019_technical_acceptance`；扩展 `schema.prisma`、`app.ts`、现有法大大gateway/回调、签署lease、PDF writer、文件ACL、后台legal/resource路由的显式分派；新增 `apps/api/test/technical-acceptance.test.ts` 及必要gateway集成测试。

**Interfaces:** 首先发布 `apps/api/technical-acceptance-contract.md`，明确 `/admin/technical-acceptances` 创建/列表/详情/prepare/停止和 `/customer/technical-acceptances` 列表/详情/confirm/sign/sign-status/停止，沿用csrf、idempotencyKey、revision守门及已有文件读取。创建只接受指定customerId及已批准模板，不能接受任意正文/商业金额。DTO列明独立编号、状态、模板/正文/PDFhash、确认/双审/能力、签署结果与安全文件id，不泄露证件/内部渠道响应。原生kind为 `technical-acceptance`；法大大kind为 `TECHNICAL_ACCEPTANCE`。

- [ ] 先写失败测试：指定客户之外404/403；未发布模板/未确认正文/缺双审/同人复核不外呼；没有商业表副作用；正式签署关闭时技术开关独立；停止/关闭后query不新盖章；部分签署和归档失败不成功；重复回调/并发重试不重复章。
- [ ] 运行专项确认因缺失功能失败，再实现独立记录、冻结PDF、本人逐份确认及敏感数据单独同意、原审批/身份/渠道适配、显式回调与独立settler。字段校验、hash/版本/lease/所有权在事务边界检查。
- [ ] 停止参与记录本地停止时间并拒绝后续新动作；在途结果继续核对和归档，显示“待核实”，不假称供应商已撤销。SIGNED仅表示双方真实完成且签后文件已核验归档。
- [ ] 完成180天到期复核机制及审计：对符合条件、无未结争议/渠道在途的独立记录标记到期并供授权人员实际删除/匿名化；共享账号/证书不得删除。明确实现的人工步骤，不能仅写未实现承诺。
- [ ] 专项、API完整测试、固定来源检查、typecheck/build；在独立本地库提供真实 HTTP 测试夹具与安全假供应商，给两前端调用。报告区分合成和真实渠道。
- [ ] 报告 `apps/api/technical-acceptance-report.md`；取得主控Git窗口后只提交本任务文件，不推送、不部署。

## Task 2 后台验收与用印工作台

**Owner:** Admin implementer, only `apps/admin/**`.

**Consumes:** Task 1契约。**Produces:** 独立“签署技术验收”列表、创建指定客户文件、PDF/正文核对、prepare/停止、状态及已有双人用印入口；不放在商业订单里，不能编辑为收费合同。

- [ ] 先测试非授权角色、未就绪/未确认/缺审批、停止/未知结果、旧会话响应、安全PDF读取及无订单路由污染。
- [ ] 按接口实现，显示明确无租赁收费的文件用途、真实本人状态和每份审批状态；默认不勾同意或代替客户确认。创建和准备不自动请求企业用印或批准。
- [ ] 使用本地真实HTTP夹具核对创建→文件→客户确认回读→申请/另一人复核呈现→签署/停止/归档状态。UI合成验收不得调用真实渠道。
- [ ] 后台完整测试/typecheck/build和实际产物网络/布局检查；输出独立冻结产物目录及SHA，避免误用旧dist；报告 `apps/admin/qa/technical-acceptance-report.md`。经主控Git窗口提交。

## Task 3 小程序本人签署入口

**Owner:** Native implementer, only `apps/miniprogram/**`.

**Consumes:** Task 1契约，现有 `native-signing.js` 会话/精确域名/暂存策略。**Produces:** 账户设置进入独立验收详情，本人阅读全文、明确确认并单独授权、主动签署、主动核验归档、下载本人文件和停止参与。

- [ ] 先测试开关关闭/无记录、换账户/登出旧响应、缺同意不发起、只本人签/假返回不成功、停止后不再发起、PDF归属与不缓存短URL。
- [ ] 增加独立kind及详情页，页面明确无租赁/收费/交车义务；签前完整正文和数据用途可读，不能将实名已完成当作新文件已同意。状态仅来自安全服务端结果。
- [ ] 复用实际原生签页与固定回跳，不把providerUrl参数、onShow或webview返回当完成；本人主动点核验才进行需要渠道动作的核对，停止态不允许新章动作。
- [ ] 小程序完整测试、17+ WXML/WXSS实际编译、Mock哈希、合成状态布局及本地HTTP联调；报告 `apps/miniprogram/evidence/technical-acceptance-report.md`。经主控Git窗口提交。

## Task 4 主控固化、复核与上线准备

- [ ] 保留批准源原文，生成只改审阅状态的正式模板、批准manifest和发布时间分离记录；核对用户批准SHA，记录明确“签署/用印未获代操作授权”。
- [ ] 完成跨模块独立审阅，重点核对五项Review Focus、商业副作用及前后端同意/状态一致性，修复后复核。
- [ ] 冻结已验证API/后台/小程序产物，记录源码和文件SHA；运行密钥审计。独立生产备份并恢复验证，再部署迁移及服务，保留回滚镜像/配置。验收开关先关闭。
- [ ] 发布获批文本和独立技术用印策略；为此前已实名本人生成一份待核对文件。仅准备具体记录与PDF，不替本人确认，不申请或批准本文件用印。
- [ ] 开启仅限指定验收记录的能力，生成真机预览码。交给本人阅读/确认，再给两位实际管理员具体文件用印入口。签署、用印和真实归档核验未完成前，不宣称真实电子签署已通过。

本计划不代表微信代码审核或正式发布完成；先完成这条真实电子签署验收，再推进整体上线剩余事项。
