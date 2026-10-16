# 纯电主义运营后台

React + TypeScript + Vite 静态后台。业务数据只取自独立 API，不包含演示数据或失败时的 Mock 回退。

## 开发与构建

根目录统一安装依赖后执行：

```powershell
pnpm --filter @chundian/admin dev
pnpm --filter @chundian/admin build
pnpm --filter @chundian/admin test
```

开发地址 `http://127.0.0.1:3100`，`/api` 代理到 `http://127.0.0.1:3101`。构建产物在 `apps/admin/dist`。部署需把非静态资源路径回退到 `index.html`。

`VITE_API_BASE_URL` 是公开的 API 基地址，默认为同域 `/api`，生产可在构建时指定 `https://mini-api.subauto.keybox.cloud/api`。请勿将密码、私钥或供应商密钥放入任何 `VITE_*` 变量。跨域后台需在 API 配置精确的 `ADMIN_ORIGIN` 并允许携带 Cookie。

## 业务行为

- HttpOnly Cookie 会话，写请求附带服务端返回的 CSRF Token；会话与 Token 只存于内存。
- 依据服务端 `resource.read` / `resource.write` 权限展示模块与动作，服务端继续强制校验。
- 金额输入为元，按十进制精确转为整数分，并限制到 API 的整数范围。
- 审核、方案、收款、退款、签署和交接通过明确动作处理，保留冲突错误与服务端消息。
- 退款创建在同一表单提交和失败重试中沿用一个幂等编号；关闭表单后新建才生成新编号。
- 额外费用与退车结算使用独立账单草稿、稳定幂等编号和另一名财务复核，通过后方可发布。
- 最终方案必须明确填写14项逐单商业条款；不生成默认待定内容，条款随版本和哈希进入确认快照。
- 交接收集7项事实、真实附件和额外检查项目；客户异议通过新版本草稿修订，旧证据保留。
- 企业印章、授权、策略与签署计划在签章运营模块管理。合同/交接先准备冻结PDF与复核计划，由另一名具备有效授权的人员审批；客户实名与证书状态从真实API读取。
- 已过期且具备服务端资格的通过计划，可为同一未完成任务重新申请双人授权。沿用原PDF、任务与企业身份，选择原印章的已启用策略；新的复核通过前不切换原任务授权。
- “支付验收”仅ADMIN可见，授权表单只选择客户、填写明确授权说明；固定0.01元、24小时有效，不生成订阅订单或合同。已建授权不可编辑，也没有代客户支付入口。只有服务端`canClose=true`且状态为AUTHORIZED/CREATING/PENDING时可查询并关闭未付记录，成功到账始终不可关闭。
- 正式协议仅保存草稿；上线发布需经用户正式文案确认。
- 真实交易与电子签署验收需由主控明确测试范围。

## 本地验收

`scripts/qa.mjs` 执行真实 API 的车辆图片上传、车辆/套餐录入和上架、协议草稿、390px 小屏与 Cookie 恢复。`scripts/qa-review.mjs` 验证审核、方案精确金额、14项商业条款、版本和哈希回读。`scripts/qa-errors.mjs` 验证客服只读权限、空态、503、409 与401。`scripts/qa-governance.mjs` 验证印章草稿、实名准备、额外费用双人复核、7项交接事实与异议修订、安全取消。`scripts/qa-rejection.mjs` 验证独立审批人真实驳回、历史PDF与计划哈希保留，以及申请人自审隔离；其待复核元数据是明确标识的本地fixture，不代表正式签前准备已成功。

这些脚本仅读取根 `.env`，不会输出登录凭据。合成数据严格限制为本地 `chundian_dev`，使用 QA 前缀，不访问生产或旧数据库。治理脚本以明确标识的ACTIVE场景fixture验证运营动作，没有造SIGNED/PAID或供应商成功结果；签署开关为真时拒绝运行。脚本按顺序执行，结果和截图在 `apps/admin/qa`。异常流程中的503/409/401使用浏览器请求拦截，不会加入产品代码。

重新授权脚本使用明确标识的过期APPROVED与未执行PREPARED任务元数据，验证真实资格、处理中租约和正式印章检查拒绝。原印章保持DRAFT、客户实名保持未完成；脚本不把此场景记为重新授权成功，也不向供应商创建交易。

```powershell
node apps/admin/scripts/qa.mjs
node apps/admin/scripts/qa-review.mjs
node apps/admin/scripts/qa-errors.mjs
node apps/admin/scripts/qa-governance.mjs
node apps/admin/scripts/qa-rejection.mjs
node apps/admin/scripts/qa-renewal.mjs
```

单元测试覆盖金额、权限阻断、Cookie/CSRF、浏览器 fetch 调用方式、错误与会话、表单 DTO、交接清单、工单状态和退款幂等。浏览器测试使用本机 Chrome，不需要下载浏览器。
