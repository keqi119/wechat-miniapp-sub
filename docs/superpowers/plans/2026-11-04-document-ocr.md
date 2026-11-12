# Document OCR Implementation Plan

> 已弃用：2026-11-04 用户人工验收后决定放弃本轮增量并回滚。后续不得按本计划重新实施或发布 OCR；以下仅为历史记录。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. 用户已授权按计划直接实施。

**Goal:** 在 admin 车辆资料卡和小程序客户证件卡集成免费本地 OCR、证据展示与已有业务字段回填。

**Architecture:** 内网 RapidOCR CPU worker 返回页/行文本；NestJS从授权附件校验字节后解析字段；React/原生小程序在卡片内识别和回填，保存复用已有领域命令。

**Tech Stack:** NestJS/TypeScript、React、原生微信小程序、Python/RapidOCR/ONNX Runtime/pypdfium2。

**Spec:** `docs/superpowers/specs/2026-11-04-document-ocr-design.md`

## Global Constraints

仅写本项目及分配目录；仅新系统，禁止旧库。金额整数分；RBAC、版本冲突、幂等、审计和实名/资格/保单审核保持。证件号码不持久化到前端缓存、日志或后台DTO；无付费云API/Mock回退。上传与OCR按钮必须在相应卡片内部。无真实交易/签章、无推送或混合发布。

## Review Focus

- 把另一辆车/另一客户的附件传入不能识别或回填。
- 模型不可用、错文件类型/方向、过多PDF页必须明确失败，不能伪造成功。
- 识别期间人工修改、附件替换、会话变化不得被迟到结果覆盖。
- 身份日期/保险期间/发票金额不能误代业务事实，VIN不可普通改写。
- 文件保存成功而回读失败只恢复原请求，按钮留在对应卡片内。

## Task 1 — API与字段解析

Files: `apps/api/src/document-ocr/{types,extract,provider,controller}.ts`；测试 `apps/api/test/document-ocr*.test.ts`；主控注册 app.ts。

- [x] 写并运行失败测试：身份证/驾驶证/登记证/保单/发票字段、日期与金额、错误类型、VIN冲突、归属/摘要/会话检查。
- [x] 实现类型 `OcrResult`、`extractFields(documentType,pages)`、`DocumentOcrController`和内部worker provider，严格限制输入和输出，识别只读。
- [x] 运行定向测试及API类型检查；记录证据与文件清单。

## Task 2 — 本地识别worker

Files: `services/document-ocr/`、`deploy/document-ocr.compose.yml`、`docs/operations/document-ocr.md`。

- [x] 写并运行失败测试：真实类型/大小、PDF页/像素上限、鉴权、并发、模型缺失。
- [x] 实现只内网服务，固定依赖和本地模型预备步骤；用合成中文证件图片/PDF验证真实引擎。
- [x] 记录实际命令、通过/失败及资源限制，说明生产启用步骤。

## Task 3 — admin 卡片接入

Files: `apps/admin/src/vehicle-documents.tsx`、`vehicle-document-cards.css`、`vehicle-ocr*.tsx/ts`与测试。

- [x] 先测试上传表单在分类卡内、现存文件行内OCR、识别失败保留输入、换车/会话拒绝旧结果。
- [x] 实现卡内上传/OCR/结果核对，车辆资产字段及保单草稿使用既有revision/幂等命令，车牌/VIN按既有规则办理。
- [x] 定向交互测试、类型检查、页面截图核验。

## Task 4 — 小程序卡片接入

Files: `apps/miniprogram/src/pages/profile/index.*`、`services/document-ocr.js`、services/api.js和测试。

- [x] 先测试本人文件OCR、空值回填、人工编辑和换卡/会话/卸载期间旧结果、0驾龄、失败可人工保存。
- [x] 实现三类证件卡内上传后识别和已有附件按钮、字段证据展示、姓名/驾龄与临时证件号码回填；原保存流程及视觉不变。
- [x] 运行小程序相关和全量测试/生产构建，确认无缓存敏感原文。

## Task 5 — 集成、复审和交付

- [x] 注册API控制器，核对两端契约；从独立副本精确合并批准文件，重核基线未变化。
- [x] 独立检查权限、会话、证据/字段、日期/金额、上传恢复及完整用户流程，修复实际问题。
- [x] 运行相关回归/构建和实际OCR图片/PDF验证；记录局限与生产启用状态。

## 执行记录

2026-11-04：按用户明确授权直接施工。使用按目录分工的并行实现，以缩短两个独立客户端及worker的实施时间；共享接口先冻结，app.ts/依赖/合并由主控处理。既有工作区286项跟踪改动，不以HEAD重建或整体覆盖。

Ruling: PDF统一渲染而不以字符数决定跳过OCR — 真实复审发现文字页脚/分栏原生文字无法代表图内字段，渲染可保留坐标并避免漏识别；代价是CPU用时增加，仍受8页/像素/100秒限额。
Ruling: 小程序沿用既有保存字段 — 姓名和驾龄回填后由原命令保存，其余证件原文仅当前卡内核对；号码不进入已有会缓存的profile/context，避免改变已确认的隐私与实名契约。


完成记录：2026-11-04，35份审阅文件按共享文件SHA核对后精确合并。根项目API38、后台26、小程序553、worker14测试通过，API/admin/小程序构建通过；独立复审三项通过，CPU实际PNG/PDF和断网Linux容器验证通过。后台27项全量既有失败有原根源基线复现记录；未运行专用DB全套、未生产发布或手机实机验收。详见docs/evidence/document-ocr-20261104.md。
