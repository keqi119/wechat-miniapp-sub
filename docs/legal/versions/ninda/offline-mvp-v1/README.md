# 宁达线下纸质合同正式文本 v1

当前会话用户在五份线下合同审阅包及生产发布说明后明确回复：**“确认按审阅稿制作正式版”**。本目录据此制作五份正式文本，平台服务方为上海宁达信息科技有限公司，联系邮箱为 like@ndacar.com。审定记录时间为 2026-10-27T13:12:33.582Z（UTC）；真实生产发布结果由主控另行留存。

## 文件和发布格式

| 正文 | LegalDocument.type | 档案主体 | 必签方 |
| --- | --- | --- | --- |
| [合作协议](owner-cooperation.md) | OFFLINE_OWNER_COOPERATION | OWNER | OWNER、PLATFORM |
| [三方租赁合同](rental.md) | OFFLINE_RENTAL | ORDER | CUSTOMER、OWNER、PLATFORM |
| [交车确认单](delivery-receipt.md) | OFFLINE_DELIVERY_RECEIPT | HANDOVER | CUSTOMER、PLATFORM |
| [还车确认单](return-receipt.md) | OFFLINE_RETURN_RECEIPT | HANDOVER | CUSTOMER、PLATFORM |
| [三方终止协议](termination.md) | OFFLINE_TERMINATION | ORDER | CUSTOMER、OWNER、PLATFORM |

同名 .template.json 为管理 API 创建法律文档的直接请求体，含 type、version、title、content、confirmedBy、confirmedAt。content 是含 body 和 requiredSigners 的 JSON 字符串。主控核对目标环境该类型版本后，按创建、发布、回读流程办理；本目录未执行 API 发布。

原审阅稿保持不变。此次正文变换仅移除草稿提示及标题后缀，将“本草稿”按文件类型改为“本合同”或“本协议”；主体、必签方、业务内容和附件要求均未变更。审批来源、原文及正式文摘要见 [approval-manifest.json](approval-manifest.json)。本地正文及 JSON 按固定摘要保存，后续实质改文应另制版本。

## 逐单打印和附件办理

1. 合作协议以实际审核通过的合作商、车辆范围和有效期生成，可在范围内供多单引用。自动打印仅列车辆档案 ID 和有效期；须随同签署《合作车辆与服务范围清单》《分润与人工结算约定》。系统规则依据真实已签约定建立，不自动猜测比例、扣除或付款期限。
2. 三方租赁合同的价格、押金、期限、里程、保障、维护和权益取当前冻结商业附件；正文不新增固定费用或退款天数。实际商业附件须明确退款节点和期限等必要条款，新模板不倒改既有订单及其已签约定。
3. 交还车单保持获批的客户与宁达作业方签署范围。实际车辆、地点、电量、物品、照片、经办人及异议等未由自动查验部分完整打印的信息，放入同版本事实附件；不以材料归档代替客户确认、真实交付或结清。
4. 三方终止协议须配套《终止事项及结算明细》，明确终止时间、实际收车、租金截止、应收应退、未决事项和处理期限。自动附上的原订阅方案不是最终结算单。
5. 全部人工附件由实际当事人确认、线下签署并与主文完整上传；原件信息和页数如实登记，上传/提交人与复核人分离。打印器不会自动生成这些人工附件，也不验证纸面签章真伪。

五份正式文本已通过现有打印模型的纯内存兼容验证，Markdown 与 JSON 正文一致，仅使用已支持变量；未执行真实签署、支付、退款或数据库操作。用户审定不被记作律师审阅或其他人员审核。
