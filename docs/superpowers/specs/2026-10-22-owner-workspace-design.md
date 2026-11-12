# 法人 H5 授权与业务合同工作区

用户于 2026-10-22 明确“先按这版更新实施”，批准本线程已提出的三页签、就近反馈、逐单手签优先方案，并授权继续施工。既有项目明确授权生成计划后直接施工，本轮不重复索要设计/计划许可。

## 范围

企业内分为企业与印章、签约授权、业务合同三个页签。认证完成仍保留查询入口，印章直接展示。授权当前记录优先展示，历史渠道授权和已关闭记录折叠；旧证书未签件明确提示建议撤回，但不自动撤回。已签单方授权不能推导自动签权限。原三项范围与正式文案不变。

业务合同复用已准备的 OwnerSigningTask，包含订单车辆及金额/期限摘要、双方签署进度、原文与签后文件、逐份明确同意后手签。未生成正式文件时空态说明等待运营准备；不虚构作废记录或把链接过期当履约到期。本期显示待处理/处理中/已完成/已关闭，具体原因区分待客户、待法人、拒签、签署过期。所有新增入口仅当前核验法人可访问，沿用 Cookie/Origin/CSRF，检查本企业归属及客户资料同意。

操作反馈按企业及记录关联，显示在点击处；全局只保留登录/页面级错误。返回/查询只核验、归档，不派发自动签章，不自动重试签署。手动必须核对整份文件并提交 sourceSha256/documentHash/accepted；任务模式与发出意图互斥，不改绑旧文件或交易。

## 执行门禁

本期模式固定为逐单手动确认，自动模式展示未开放。允许用独立 OWNER_MANUAL_CONTRACTS_ENABLED 标志开放实际车主合同的双方手动流程，且 OWNER_CONTRACTS_ENABLED=true；FADADA_SIGNING_ENABLED=false 与 OWNER_AUTO_SIGNING_ENABLED=false 保留。不得使手动门禁替代自动执行检查；自动执行仍明确要求原全局签署和自动授权权限。现有客户小程序本人签署复用实际车主网关，平台自身盖章不受新标志影响。

不代用户创建订单、撤回授权、签署或盖章。生产验证仅读取和公共/未登录接口；真实签署由本人验收。若生产依赖确有阻断，保持准确说明，不把仅展示入口说成完整验收成功。

## 接口约定

新增 /owner-h5/owners/:id/contracts：GET 返回 {items,signingMode:'MANUAL',manualSigningEnabled,automaticSigningEnabled:false}。items 对应已准备的任务，id 为 taskId，resourceId 为 contractId。

每项至少有 id/resourceId/kind/status/ownerMode/createdAt/archivedAt/reviewedAt、parties:[{role,status}]、orderId/vehicleTitle/monthlyFeeAmount/depositAmount/months（无法可靠取值时为null）、documentHash/sourceSha256、sourceAvailable/signedAvailable、canSign/canQuery、blockers:string[]。GET /:taskId 返回相同摘要及 body。GET /:taskId/files/source|signed 返回受保护PDF。POST /:taskId/sign 接受 {accepted:true,documentHash,sourceSha256}；POST /:taskId/sync 接受 {} 且只查询（advanceAuto=false）。无需单独“切换手动”按钮，显式签署动作内原子领取手动模式。

授权列表附加 certificateMatchesCurrent:boolean 或 null（账号未具备有效证书）；历史方法明确保留。撤销查询失败继续保留 REVOKING，错误反馈独立展示，绝不将未知结果记为已撤销。

## 验证

本地独立测试库：H5越权/CSRF/跨企业、资料同意和PDF绑定、同意缺失、客户未签、证书/印章不符、全局关闭但受控手动可用、自动门禁不会被旁路、查询永不自动用印。浏览器合成API：三页签、当前/历史授权、同页反馈、合同筛选及详情、显式确认、重复点击/未知结果、切换企业/退出会话的迟到结果隔离。发布前独立复审，API/H5构建与相关回归；线上对比授权、文件和业务记录不变。
