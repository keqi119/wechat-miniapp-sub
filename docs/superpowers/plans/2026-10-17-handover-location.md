# Handover Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checkbox syntax.

**Goal:** 客户提出同一交还地点，运营核对后在最终方案中固定。
**Architecture:** 在申请profile JSON中增加严格文字地点，沿用既有补件和方案确认流程；一个公开能力接口绑定已发布法律文件，原生页面共享选址辅助模块。
**Tech Stack:** NestJS/Zod/Prisma、微信原生小程序、React/TypeScript。
**Spec:** docs/superpowers/specs/2026-10-17-handover-location.md

## Global Constraints
- 仅当前独立项目；金额、信用、签署、付款及旧系统不改动。
- 地点只含name/address/source及服务器生成的版本同意记录；不存经纬度。
- HANDOVER_LOCATION_POLICY_JSON精确绑定privacy/application/handover-location的id/version/contentHash；HANDOVER_LOCATION_MAP_ENABLED默认false。
- 手填可用时不强制地图授权；地图取消、失败、迟到回调和账户变化不留未提交位置。
- 不自动覆盖已确认条款；生产发布/微信能力/真机验证分别记录。

## Review Focus
- 旧客户端补件省略地点不得删除现有值；显式null才清除（Task1测试）。
- 地图返回含坐标、恶意额外字段不得进入服务器、审计或缓存（Task1/2测试）。
- 法律文本更新或开关关闭时旧页面不能新提交地图资料（Task1测试）。
- 选点进行中退出页面或切换账户，迟到回调不得污染新页面/账户（Task2测试）。
- 已存在最终方案条款不得被客户建议预填覆盖（Task3测试）。

### Task 1: API及批准文案
Files: applications/handover-location.ts、applications.ts、catalog.ts、admin.ts、test/handover-location.test.ts、法律正式副本与manifest。
Interfaces: locationInput为nullable optional严格联合；locationCapabilities(db)返回enabled/mapEnabled/notice/policyHash；resolveLocation(tx,input,customerId,previous?)返回规范存储值。GET /public/handover-location只暴露当前匹配且已发布文案。
- [x] 写测试：默认关；精确文件绑定；手填；地图需单独同意和当前policyHash；拒绝坐标；省略保留/null清除；HTTP归属、状态、幂等。
- [x] 运行tsx --test test/handover-location.test.ts，观察缺少模块/能力导致RED。
- [x] 实现严格地点解析、服务器生成同意快照、提交/补件事务整合及legal类型。
- [x] 运行同一测试及API build，Expected全部通过。

### Task 2: 小程序申请及补件选址
Files: utils/handover-location.js、共享WXML、application/profile页面、services/api.js、app.json、tests/handover-location.test.cjs。
Interfaces: 页面辅助方法显示文案、勾选后主动wx.chooseLocation；payload仅显式name/address/source/policyHash/accepted。服务新增getHandoverLocationCapability；补件仅在编辑时发送地点。
- [ ] 写页面测试：仅明确点击调用；默认未同意；手填；取消拒绝；不保留坐标；迟到和重复回调；账户改变；补件往返。
- [x] node --test tests/handover-location.test.cjs，Expected缺少行为RED。
- [x] 实现共享辅助与模板、会话守卫、严格序列化、应用权限声明；不默认调用定位。
- [x] 同一测试及全部native测试、check、compile:templates通过。

### Task 3: 后台交接建议与整体验证
Files: admin/src/handover-location.ts/test、credit.ts、App.tsx、resources.ts、api-contract.md、.env.example、能力启用说明、验证证据。
Interfaces: handoverProposal(entity)只生成建议文字；prefillHandoverTerms不覆盖任何已有非空handoverArrangement。
- [x] 测试建议展示、空条款预填、已有条款不变，观察RED后实现。
- [x] API全套、admin全套与构建、native全套与生产bundle。Expected全部通过。
- [x] 只读核实微信权限；未完成平台配置与真机验收则记录pending，不启用地图。
- [x] 一次新上下文最终审查，修复必要问题，摘要核对与秘密扫描后提交/推送当前功能分支。

已依据用户“生成实施计划后直接开工”继续执行；不另设重复方案批准关卡。文案批准记录独立留存，尚未声称发布。
