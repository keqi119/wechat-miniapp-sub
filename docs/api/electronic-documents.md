# 宁达统一电子签接口

状态：2026-11-02 本地实施；尚未切换生产。以下路径均位于 `/api`。

| 入口 | 路径 | 能力 |
| --- | --- | --- |
| 后台 | `/admin/electronic-documents` | 列表、详情、源文件／签后文件、start、sync、withdraw |
| 客户本人 | `/customer/electronic-documents` | 本人列表、详情、文件、sign、sync |
| 企业／自然人本人 | `/owner-h5/owners/:ownerId/electronic-documents` | 对应主体列表、详情、文件、sign、sync |
| 法大大回调 | `/callbacks/fadada-electronic-sign` | 校验摘要及原交易绑定后触发主动查询 |

列表 GET；详情 `/:id` GET；文件 `/:id/files/source` 或 `/:id/files/signed` GET；动作 `/:id/{action}` POST。
写操作提交 `revision`、`idempotencyKey`；本人 sign 还须提交 `accepted:true`、本版 `sourceSha256`。后端核对当前身份、实际角色、文件和业务版本，不接受客户端指定签署账号、印章或代理人。

后台仅有效管理员／运营办理，财务／客服只读，管理员也不能代客户或企业本人点签。H5 本人会话须独立建立并绑定当前法人／自然人资料；公司只读管理员会话不能升级为签署或授权会话。写操作保持 Cookie、Origin、CSRF 校验。文件私有、禁止缓存，仅归属人及获准员工可读取。

企业自动签同时要求宁达范围内的业务授权、真实渠道授权、当前有效身份／证书／指定印章及渠道被授权方证明。任一企业条件不足，在首次派发前统一回退双方企业逐份手签。首次派发后不得借切换模式重复签署。自然人始终逐份本人手签。

任务状态：PREPARED、SIGNING、SIGNED、FILING、ARCHIVING、ARCHIVED、WITHDRAWN、DECLINED、EXPIRED、RETIRED。签署方状态另行显示 PENDING、ISSUED、UNKNOWN、SIGNED 等；跳转返回和通用成功回调不直接变为 SIGNED。

所有外呼先持久化意图。超时／未知结果只查询冻结原合同和原交易。备案明确拒绝后，必须先核验原合同未备案才可恢复原合同备案；未知备案不重复提交。签后文件下载失败只恢复下载。每 30 秒分别有界扫描已启动任务与停派待保全任务；关闭新签署开关不停止原交易查询恢复。

签署成功证据不填造人工复核或纸档保管字段。归档保存逐方核验摘要、源／最终 PDF 哈希和备案确认摘要；渠道没有备案编号时不生成假编号。撤回或退休任务的晚回调可补记原交易签署事实，完整有效签署通过独立证据保全路径取得渠道归档回执、最终文件验签并保存 ElectronicStoppedEvidence；不调用 afterArchive，不提升 ArchiveVersion/currentApprovedVersionId，不激活订单、合作或续期。

通知只记录到宁达自己的站内通知，由相应本人入口办理。API 供应商不进入主体、通知对象、授权接收人和业务归档角色。

V3.1 Task4：`parties[].signedAt` 为渠道原交易 `endTime`，按 Asia/Shanghai 解释并保留原字符串与精度；`verifiedAt` 是本地核验时刻。`legalCompletedAt` 为全部有效签署实际时间最大值，`archivedAt` 只表示正常业务归档完成。缺时间、未来时间、错绑定不得用服务器时间补造。

`withdraw` 先锁任务停止新派发，返回投影含 `stopStatus`。`STOPPED_LOCAL_ONLY` 表示尚无外部签署尝试；存在已派发原交易则为 `NEEDS_REVIEW`，等待渠道关闭能力与法律状态核对。`PROVIDER_CLOSED` 预留给有真实渠道关闭证据的路径；当前未实施拒签调用，不将预备案状态0、生成链接或本地停止解释为渠道关闭或法律解除。停派后已核实成功签署不会删除。内部 `stopSigning(taskId,revision)` 返回同一状态，HTTP 客户端仍使用原 RBAC/审计/幂等 withdraw。

正常及停派最终文件都上传精确下载字节至官方 `contract_verify.api` 核验。仅严格布尔完整性/时间戳证据、冻结证书 CN 摘要覆盖全部预期主体及匹配时间可通过；同一主体多个章允许。主体摘要来自真实证书查询并通过个人、企业及自然人合作商身份链冻结，历史无摘要须刷新身份，不从显示名推断。CN 明文和原验签 JSON 不进入任务普通 JSON。

停派的 `finalFileAvailable=true` 仅在独立保全完成后出现，原本人及员工授权文件入口可下载；不代表恢复业务。无效文件不绑定 finalFileId、不开放签后下载。`loadElectronicArchiveProof` 继续只接受正常 ARCHIVED 版本，拒绝停派保全记录。`captureStoppedSigningEvidence(tx,taskId,proof)` 仅给服务端可信恢复调用，按 taskId 唯一幂等，返回 `{evidenceId,finalFileId}`。

最终验签失败时，原始下载字节以 `electronic-quarantine` 私有用途保存，归属 customerId 为 null；独立 ElectronicFileQuarantine 固定 taskId、archiveVersionId、providerContractId、sourceSha256、snapshotHash、精确文件 SHA256、拒绝码、核验时间及可得的渠道响应回执摘要。没有渠道响应时回执摘要为 null，不伪造成功回执。按 taskId+SHA256 去重，隔离记录不可更新/删除；每任务最多保留3份不同PDF（每份≤20MiB，总上限60MiB），达到上限后停止继续下载并要求核查。重复失败不会增加文件副本或记录。隔离文件不进入 finalFileId、正常归档、业务激活或本人取件清单。

普通客户、后台及公开文件入口拒绝隔离文件；共有业务附件检查也拒绝其重新挂接，即使文件用途或客户字段被误改，永久隔离绑定仍生效。内部 `readQuarantined` 只做受保护字节/哈希核对，没有新增客户、企业或后台HTTP下载入口。核查及保留策略UI不在本次范围。

Task4 fix1：停派恢复队列以 recoveryNextCheckAt 持久化下次检查时间，查询前即预约30秒后重试；无变化、部分已签、渠道错误和隔离上限任务都会轮转，不再永久占据最早20行。任务证据事实不随调度改变。

迁移前已经 SIGNED 但缺少实际时间的行，正常推进与停派/回调恢复均查询原 transactionId 补证，不退回待签、不生成新交易。原 verifiedAt/queryEvidenceHash 不变；evidenceCheckedAt/enrichmentQueryEvidenceHash 单独记录补证观察与查询摘要。已获得的实际时间及原始/补证查询摘要禁止覆盖。历史冻结主体缺少原证书CN摘要时，补齐可核实的时间后设置 evidenceReviewStatus=ORIGINAL_CERTIFICATE_REQUIRED 并只审计一次；不读取/套用当前证书，不继续新签署、备案或业务激活。

渠道 signedontime 与 timestamptime 必须按各自声明精度形成的时间区间双向相交；过早或过晚的矛盾时间戳都拒绝，不移动实际签署时间。

2026-11-10 真实渠道核验发现，同一原交易的 `query_sign_result.endTime` 比最终 PDF 的 `signedontime` 晚 1 秒，且 PDF 完整性、签署主体与时间戳验证均通过。归档不要求两字段秒值相等：PDF 签章时间区间须与原 `attemptedAt` 至 `endTime`（包含其声明精度）的范围相交；缺少原请求时间、无效精度、超出原交易范围、证书失效或时间戳矛盾均拒绝。原交易查询时间、原始字符串、精度和证据摘要不覆盖，文件仍按原合同下载并对精确字节验签；不新增签署、不补造时间或绕过隔离保全。

新隔离字节存入 UPLOAD_DIR/electronic-quarantine 专用目录。Windows 使用禁继承DACL并核验仅运行服务SID与明确配置的 ELECTRONIC_QUARANTINE_RECOVERY_SIDS（JSON SID数组，默认空）具有权限；POSIX校验服务UID并使用目录0700/文件0600。创建及复用均重新检查实际权限。旧隔离记录先验证路径、字节与哈希，再只收紧其引用文件的权限，不改变共享分片目录或其他文件，不删除/移动原文件。启动恢复器先分批修复现有隔离引用（包括已达保留上限任务），读取/复用旧引用也重新核验；权限修复失败不会被伪装为私有保全成功。未新增对外取件入口。
