真实接口以 ../../docs/api-contract.md 为准。适配器 src/services/api.js 保持源公开服务方法；getContext 同步读取有效会话快照，refreshContext 异步回读服务端。所有写入只调用 /api/customer/*，公开浏览调用 /api/public/*。

生产错误不会退回样例，401清会话，403/404/409/供应商失败分别保留错误码；最终方案确认传revision+commercialHash；申请传documentId/version；附件传fileIds；里程传orderId/readingKm；交接传manifestHash/readFileIds。接口版本变化须同步测试。

信用第一阶段：GET /customer/applications/:id/credit-review；POST /credit-consent {documentId,version,decision:ACCEPT|DECLINE,idempotencyKey}；POST /credit-consent/withdraw {consentId,idempotencyKey}，两写接口返回同safe。safe新增canDecline、consentRequirementsMet、verificationCurrent、canConfirmFinalPlan；canFinalize属于后台出具动作，原生不依赖它。最终方案须固定creditVerificationId/creditRuleVersion/creditBand/creditRevision，客户确认前与当前有效核验匹配。DECLINE/withdraw不以一般隐私补签为前提。详情加载信用失败仅阻止信用操作及方案确认，不阻断已获授权的申请只读展示。

用量A：GET /customer/orders/:id/usage-account；POST /customer/orders/:id/mileage-packs {productId,termsVersion,termsDocumentId,termsDocumentVersion,termsHash,accepted:true,idempotencyKey}返回purchase+普通bill。purchaseTerms缺confirmed/PUBLISHED文案时为null，客户端禁止购买但保留历史只读。POST /customer/usage-periods/:id/readings {readingKm,recordedAt,fileIds,idempotencyKey}，recordedAt按照片真实北京时间转换ISO；canSubmit由服务端决定，期初读数null不阻止收本月界证据，也不估算起点。GET /customer/return-settlements/:id及POST /dispute {reason,idempotencyKey}，客户没有直接complete/cancel/refund动作。depositRefundRequiredAmount为只读整数分。最终方案usagePolicy固定文案id/version/hash/全文及结构规则进商业hash，页面完整展示，缺正文或关键规则不匹配阻止确认。

B1延期：GET /customer/order-changes及/:id；POST /:id/confirm、reject、sign、sync均携OrderChange.revision和idempotencyKey，confirm加commercialHash，reject加reason。quote.document固定delivery-delay-amendment全文/id/version/hash，缺失禁止确认/签署；newEndDate为最后包含日，period.endDate为排他月界。原生type=orderchanges复用records/record，签页kind=order-change仅复用原入口，getSignStatus先fresh GET后POST sync，contract.SIGNED+signedFileId才可信完成。客户不调用后台apply/finance/refund；补款跳普通bill。初始DRAFT revision=0可只读，无发布quote/客户动作。未新增微信刷脸桥接或签署域名配置。

B1安全审查后的最终DTO兼容：list items仅{id,orderId,kind,status,revision,reason,createdAt,quoteSummary:{id,revision,newStartDate,newEndDate,months,commercialHash,expiresAt}|null}，不含quote正文/contract/finance；详情document.content为已填正文，hash=bodyHash，templateHash另存。quote.expiresAt是带时区ISO的首次客户确认截止时间，过期/缺有效时间禁止confirm；已确认后的sign/sync/历史继续按业务能力，不能误用该期限代替印章approval有效期。

H5指引切片：公开GET /public/signing-config -> {mode:SERVICE_ACCOUNT_H5,entryUrl:https://app.subauto.keybox.cloud/miniapp-sign/,enabled:boolean}，复制时重新校验enabled与精确固定地址；用户点击才setClipboardData，绝不附token/phone/idcard/id/signUrl。所有原生sign/identity发起只导航本地指引，无sign/register/verify/refresh POST；身份读取GETreadiness，主/交接GETsign-status，延期fresh revision POSTsync。SIGNED必须有归档；旧外链缓存清理，pending只kind/id。
# B2原生增量（2026-10-16）

契约来源 `apps/api/b2-contract.md`。新增本人 `GET /customer/orders/:id/swap-account` 与 `POST /customer/orders/:id/vehicle-changes {reason,idempotencyKey}`，申请前fresh能力、稳定失败重试key及busy；只用真实返回id进入详情，不本地扣次。account.cycle.endDate不含；预占/释放/消费分列。B3无购买方法/按钮，paidAvailable按本轮固定0解析、canPurchase始终false。

order-changes同时精确支持DELIVERY_DELAY与VEHICLE_CHANGE，新增SWAP_RETURNED。换车quote全文类型须vehicle-change-amendment，沿revision/commercialHash/expiresAt及显式阅读守门；显示冻结oldVehicleIdentification/targetVehicleIdentification、原期限/逐期钱款、新月费/押金补退/交接费、保险责任/无车间隔、BEFORE_RETURN资金门槛。当前/原分配与目标车及两侧交接只读，完整本版本已填正文始终必需；AMENDMENT仍仅H5指引，没有原生sign POST。

handover页支持明确id打开SWAP_RETURN/SWAP_DELIVERY，不用dashboard当前车替代本单vehicleTitle。actualAt+manifestHash fresh守门继续；新type还需vehicleId/changeId/vehicleTitle，缺失仅可查看/异议。逐车用量读取currentAssignment/assignments/period.segments；segments存在时必须选真实segment，仅POST /customer/usage-segments/:id/readings，不传vehicleId/assignmentId/usedKm，不跨车比较读数。开放段拍摄日期取period.effectiveEndDate；封闭段取endAt上海日，仍以server.canSubmit为准。无当前分配显示待交付，未知状态不默认为ACTIVE。
