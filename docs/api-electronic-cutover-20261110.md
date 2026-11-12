# 正式电子签切换接口增补（2026-11-10）

本文件增补 `docs/api-contract.md`。适用独立宁达环境及 ELECTRONIC 新订单，不连接旧库。

- `NEW_ORDER_CONTRACT_MODE=ELECTRONIC` 后，确认旧 OFFLINE 报价创建新订单返回 `409 CONTRACT_MODE_CHANGED`。已经确认的同一请求仍按原幂等结果读取，不重复建单。
- 新建、准备、提交、复核及归档纸质文书的写操作返回 `409 PAPER_SIGNING_DISABLED`。旧文书只读、问题反馈及停止已有错误资料的能力保留；不能作为新订单的签署通道。
- 客户合同记录在 ELECTRONIC 模式返回当前归属明确的电子合同工作区链接，不返回旧渠道 `canSign` / `canQuery` 操作。签署与归档状态只来自当前任务及本客户签署方。
- 客户订单文档列表增加当前交付前取消（04）及协商终止（06）方案入口；阅读和确认仍使用既有 `cancellation04` / `termination` 客户接口，提交绑定当前方案 revision 与 proposalHash。
- `GET /admin/cancellations04/:id/files/:fileId`、`GET /admin/terminations/:id/files/:fileId`：管理员或运营读取本方案冻结的原始依据；文件必须属于本方案 evidence，并匹配文件哈希、客户及提交人。返回私有文件流，禁止缓存。该读取权限不赋予财务编制或审核合同的权限。
- 后台取消/终止读取投影的 `reviewSource` 仅对管理员、运营提供；财务只读业务结论。`reviewSource` 不可由客户端覆盖。
- 后台续期列表/详情增加 `executionMode`，准确区分电子与历史纸质来源。
- 后台换车交接投影增加 `revision`、`taskVersion`；登记实际收车须同时提交当前查验 revision / manifestHash 及已有现场任务版本。实际结算绑定 receiptEventId、deliveryHandoverId 和本次变更 revision。
- 小程序复用既有换车事实金额接口；CONFIRM / OBJECT 均绑定本订单、变更、来源哈希、资金哈希、金额哈希及上一响应版本。未知结果只能重试原请求。
- 协商终止页面同时读取既有 `settlementSource`，实际还车后由本客户使用 `POST /customer/orders/:id/exit-amounts/respond` 确认或提出异议；绑定当前来源哈希、响应版本及上一响应 ID，不把预计金额或未使用租金直接认定为已退金额。
- 退款依据工作区沿用金额确认原始证据、人工核验、登记退款义务及关联已申请退款的接口，不新增自动审批或出款。退款投影补充 `revision`、`obligationId`，避免同笔款重复关联或覆盖已变化的审批。
- `GET /admin/orders/:id/refund-amount-evidence/:claimId/files/:fileId`：仅管理员／运营读取本订单 CLAIM 内冻结且哈希匹配的原始依据，返回禁止缓存的私有文件流。财务仍读取已核验业务结论并独立审核资金。
- 客户电子签阅读同意同时绑定任务版本、原文哈希及本人实名版本／身份哈希；实名来源变化后清除同意，签署提交前再次读取身份和任务，禁止沿用旧同意。

本轮不新增自动退款。续期取消的退款请求进入 `PENDING_APPROVAL` 后，缺少退款依据、金额确认或异常到账独立复核时不得出款；同一未决款不得重复申请，也不得标记资金核清。

发布顺序：先构建并上传 1.3.3；核对微信正式版本可用与启用模板范围后，再统一激活服务端 ELECTRONIC / SIGNING_REQUIRED。开发版上传或提审不等于正式发布。03—06 正文未核定时明确阻塞，不回退纸签。
