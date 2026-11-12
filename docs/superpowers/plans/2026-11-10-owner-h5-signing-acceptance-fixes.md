# 企业 H5 电子签验收修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复用户七项H5验收问题，维持既有电子签业务流程。

**Architecture:** 在原LegalApp中维护文件列表与所选文件，以同源认证PDF字节交给本地阅读器；签署跳转与返回状态独立处理。取消用印沿用原服务端接口，以确认框承载原因和最终确认。

**Tech Stack:** React、TypeScript、Vite、本地打包PDF.js。

**Spec:** docs/superpowers/specs/2026-11-10-owner-h5-signing-acceptance-fixes-design.md

## Global Constraints

仅修改apps/signing-h5内相关源、测试及package.json；根依赖安装/锁文件/CSP/发布由主控处理。UI沿用原企业合作商中心。不得修改真实签署记录、取消真实授权、发短信、代签、支付；不得发布小程序1.3.0。不做业务流程扩张。

## Review Focus

- 微信窄屏、多页中文PDF在实际CSP下可读；页面资源全为同源。
- 原件/签后文件切换、关闭/换公司/失效登录，旧文档和旧同意不能串用。
- 跳转时页面加载中断不会显示误导失败；真实网络失败仍可恢复。
- 用户已确认总状态“待签署／待归档／已归档”；参与方卡槽按实际签署成功分别打勾。归档受阻仍为待归档，并保留具体提示，不让用户误以为需要重签。
- 取消授权关闭不提交，最后确认才提交当前版本原因，重复点击不重复派发。

### Task 1: H5 展示与操作修复

**Files:** apps/signing-h5/src/owner/LegalApp.tsx、legal-client.ts、legal.css；按职责新增文件列表/阅读器及对应测试，必要时复用Common.tsx确认框；apps/signing-h5/package.json。

**Interfaces:** 沿用LegalTask DTO、LegalClient.request、现有同源/owner/api文件路由及sign/sync/revoke-grant接口。新增组件仅处理展示和显式用户操作。

- [x] 复现blob iframe/CSP、跳转时重复refresh、现有状态枚举和撤销布局问题，保存修改前基线。
- [x] 为过期文档隔离、跳转后不重复查询/误报、取消确认和状态映射增加必要失败测试；纯样式不用镜像测试。
- [x] 实现逐文件状态列表、原件/签后本地PDF阅读、明确加载/错误、同源下载以及取消确认框。
- [x] 运行H5完整测试、typecheck/build；合成多页中文PDF在320/390/桌面布局与实际CSP下截图核验，保存测试日志。
- [x] 主控独立审阅实际增量，不提交他人文件、不自行部署。

### Task 2: 集成与发布核验（主控）

**Files:** pnpm-lock.yaml、必要的deploy/ninda/nginx-signing-headers.conf精确调整、私有发布资料及公开脱敏证据。

- [x] 检查新依赖来源与版本，统一安装、冻结锁文件；保护同源授权，不放开远程frame/第三方预览。
- [x] 将批准H5增量叠加当前已发布源，保留其他端页面与配置；归档补丁独立验证后合并或先行发布。
- [x] 验证构建、静态资源、文件路由和现有真实原签署任务，记录未完成的本人验收项。
- [x] 发布可回滚版本并请用户在原H5验收；小程序1.3.0仍禁止生产发布。

## 发布记录与未完成验收

2026-11-10 13:44:55（上海）发布 `20261110-owner-h5-documents-v1`。限定 H5 测试83/83、类型检查和双入口构建通过；独立审阅通过并另执行10项限定测试。21个合成浏览器场景覆盖320/390/1280宽度和实际CSP；原件与真实签后PDF共18+13页均以发布产物渲染，签名Widget印章可见。上线后199个静态文件哈希一致，PDF worker为同源JavaScript，匿名文件请求401。没有调整CSP、API逻辑或后台静态文件。

晓浪、宁达的持久认证/证书/已选印章跨本轮两次发布只读指纹一致。主合作协议及独立用印授权均已归档。已向用户请求原企业H5真机微信验收；其结果仍待本人确认，桌面移动视口测试不替代真机结果。更广泛API套件存在失败且本次记录时仍运行，不纳入本轮H5通过声明。完整电子签人工验收后续的三方订阅合同和支付仍未完成。

- [x] 用户在微信真机确认两份文件双方打勾、已归档；原件/签后文件翻页及双方印章正常。

2026-11-10 用户回复“均正常，能看到双方印章”，上述真机阅读和状态展示验收通过。独立取消授权和真实法大大往返不在本次用户反馈的确认范围内，前述合成测试证据保留，不宣称用户实际取消过授权。本轮H5七项修复交付结束，继续已有虚拟订阅人工验收。

公开证据：[发布及保留核验](../../evidence/v31-owner-h5-documents-20261110.json)。私有证据位于 `.runtime/owner-h5-release-20261110/`，实际材料和印章不进入公开证据。
