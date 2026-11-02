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

所有外呼先持久化意图。超时／未知结果只查询冻结原合同和原交易。备案明确拒绝后，必须先核验原合同未备案才可恢复原合同备案；未知备案不重复提交。签后文件下载失败只恢复下载。每 30 秒扫描未关闭且无有效处理租约的已启动任务。

签署成功证据不填造人工复核或纸档保管字段。归档保存逐方核验摘要、源／最终 PDF 哈希和备案确认摘要；渠道没有备案编号时不生成假编号。撤回或退休任务的晚回调可补记原交易签署事实，但不能继续派发、归档或恢复业务。

通知只记录到宁达自己的站内通知，由相应本人入口办理。API 供应商不进入主体、通知对象、授权接收人和业务归档角色。
