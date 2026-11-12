# 宁达交接单法人手动签署

2026-10-25 用户明确选择：客户签署后，由宁达法人从服务号业务合同列表逐份手动签署，随后归档，保留后台双人复核。沿用项目已授权“生成计划后直接施工”的方式，不重复请求相同方案批准。

## 目标及依据

宁达企业、证书、印章均经法大大501040真实查询核验；后台印章已由实际第二管理员启用，申请/复核权限及HANDOVER策略已配置。渠道自动签查询status=0，用户此前拒绝受托方错误为晓浪的默认渠道授权函，因此不开放宁达交接单自动盖章。

## 方案

采用现有法大大手动签页和服务号法人会话，扩展“业务合同”展示宁达交车、还车交接单。备选为继续等待法大大配置宁达自动签授权；用户选择前者。使用既有FadadaTask及平台交接审批模型，新增冻结的手动模式和本人确认记录；不把交接单伪装成出租方OwnerSigningTask，不变更出租方。

新增任务在配置HANDOVER_PLATFORM_SIGNING_MODE=MANUAL时冻结为MANUAL，旧任务保持原模式且禁止静默转换。手动任务的查询/回调只核验并归档，不调用autoSealContract。宁达法人对当前PDF、manifestHash/sourcePdfHash明确确认后，服务端再次校验客户已签、双人审批有效、平台章映射、法人认证关系、证书和选章，签署URL绑定同一providerEnvelopeId/platformTransactionId及平台章。超时/重试继续同一文档交易，不创建重复任务。

法人H5新增/owners/:ownerId/handovers接口，列表、详情、PDF、签署、同步均校验当前登记且已通过供应商核验的宁达法人，并确保企业providerCustomerId匹配任务platformProviderId及当前运行映射。不能因手机号邀请或admin权限而看见合同。客户尚未签署时不能发起宁达签署；过期审批、撤销权限、身份/文件变更阻断新入口。签后查询可归档已发生的可信结果，但绝不因此生成新的签署动作。

## 界面接口约定

保留原/owners/:id/contracts接口；新增/owners/:id/handovers，对应GET list、GET /:taskId、GET /:taskId/files/:variant、POST /:taskId/sign、POST /:taskId/sync。签署入参沿用accepted:true、documentHash、sourceSha256。响应沿用BusinessContract/ContractList结构，kind=HANDOVER、platform方角色=PLATFORM、handoverType为交车/还车原类型、documentDomain=PLATFORM_HANDOVER，status将SIGNED映射为ARCHIVED。列表额外enabled:false时items为空，其他车主也返回空列表。手动模式通过manualSigningEnabled体现。界面区分交接单与主合同，以文件为单位显示局部反馈、完整PDF、双方状态及本人确认。

## 不变项与验证

不修改已批准正文、订单金额、车主授权函、支付退款规则、旧系统。不替法人认证/签署，不替第二人审批，不执行真实交易。OWNER_AUTO_SIGNING_ENABLED=false、TECHNICAL_ACCEPTANCE_SIGNING_ENABLED=false保持。生产部署先备份并检查无旧待执行任务，再设置手动模式和签署入口；真实签署由用户验收。

重点测试：跨企业/未核验/换法人访问拒绝；过期证书、换章、过期审批/撤权；客户未签不能签；确认hash变化；重复入口同交易；手动查询与回调autoSeal调用数为0；双签PDF归档与交接状态正确；关闭入口和旧AUTO任务不会被静默转为手动；其他车主合同不回归。
