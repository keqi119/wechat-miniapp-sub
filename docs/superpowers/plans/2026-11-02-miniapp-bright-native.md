# 明朗原生小程序优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将用户选定的明朗原生应用到真实小程序，上传 1.2.2 并设置体验版。

**Architecture:** 保留原生页面和真实数据控制器，以共享 WXSS 与页面 WXML/WXSS 优化界面。源码快照作为本轮审查基线，构建冻结包独立于后台发布。

**Tech Stack:** 微信原生 WXML/WXSS/JavaScript，现有 Node tests、wcc/wcsc、微信开发者工具/CI。

**Spec:** docs/superpowers/specs/2026-11-02-miniapp-bright-native-design.md

## Global Constraints

- 仅本项目写入；原样副本、历史包与本轮前已有修改保留，不提交别人文件。
- API、状态、金额整数分、权限、幂等与签署/付款条件不变，不从原型复制合成业务数据。
- 四个入口保持；新版本只提交体验版，不生产提审/发布。
- 低风险纯视觉调整以编译和布局核验为主，不添加只镜像颜色/类名的单元测试；如需改动业务显示判断，则先以真实行为测试复现。

## Review Focus

1. 同车多方案及不可售方案：选择与申请仍绑定正确商品，费用不被遮挡。
2. 长车型、长金额、低宽度：卡片和固定操作区不溢出或覆盖内容。
3. 首期/押金已支付与实际交付分离，账单事由和未起租服务期保持正确。
4. 交接已确认、已完成和被替代版本不出现再次同意/提交控件。
5. 登录、资料审核、服务错误/空状态仍可恢复；不显示虚假实名结果。

### Task 1: 基线与全局视觉

**Files:** apps/miniprogram/src/app.wxss、app.json、页面 JSON；基线 .runtime/ninda/bright-native-20261102/baseline。

**Interfaces:** 保留所有页面路径、JS 方法和 data 字段；提供现有 .page/.card/.primary/.secondary/.field 等类的新视觉。

- [x] 保存 src 和项目配置快照，运行现有全套测试并记录基线。
- [x] 更新全局色彩、字号、圆角、表单、按钮、安全区及白色原生导航/底栏。
- [x] 编译 WXML/WXSS，确认无平台样式语法错误。

### Task 2: 选车、用车与常用页面

**Files:** apps/miniprogram/src/pages/{home,catalog,vehicle,use,mine,records,record,order-detail,handover,profile,application,application-detail,service,mileage,settings,legal,sign}/index.{wxml,wxss}。

**Interfaces:** 使用当前控制器提供的真实数据和既有 bindtap 方法，不增加网络请求或更改金额运算。

- [x] 重排首页、车辆和方案页面，保留可售状态、真实车图及完整方案条件。
- [x] 统一用车、订单/账单、交接和我的；按当前业务状态保留按钮条件。
- [x] 常用表单和文档页面统一视觉，保留必填字段、错误与恢复入口。
- [x] 运行现有全部测试/check/build；需要变更行为时先补有意义的回归测试。

### Task 3: 布局、审查与冻结

**Files:** apps/miniprogram/scripts/verify-bright-native-layout.cjs（如现有比较脚本不足）；.runtime/ninda/bright-native-20261102/。

**Interfaces:** 使用现有源码编译浏览器 bridge 和离线测试夹具；夹具不进入 src/发布包。

- [x] 在 320/390/430px 核验主页面与 Review Focus 状态，保存截图及失败明细；肉眼查看代表截图。
- [x] 独立审查本轮与源码基线的差异，处理影响流程或可用性的发现。
- [x] 冻结 1.2.2 源码、API 配置和文件哈希，核对包中无 Mock/测试数据。

### Task 4: 微信体验版

**Files:** 新冻结目录 .runtime/releases/ninda-20261102-bright-native-v2/miniprogram；对应证据目录 miniapp/。

**Interfaces:** 复用 scripts/miniapp-ci.mjs 或已核验微信 CLI，appid wxb5115e5a5f70f1b1，API https://api.evsub.ndacar.com。

- [x] 开发者工具编译与只读入口检查，生成预览。
- [x] 上传版本 1.2.2，保存真实上传回执与版本说明。
- [x] 微信体验版已设置：用户确认 1.2.2 已设为体验版；平台页面未由自动工具独立核验，确认记录保存于 miniapp-v2/experience-confirmed.json。
- [x] 更新设计选择、交付记录与体验路径；不执行生产提审或发布。

本任务不自动提交/推送整个脏工作树；本轮持久化进度写入 .runtime/ninda/bright-native-20261102/progress.json。
