# V3.1 指定虚拟验收（Task11b）

本轮仅允许一个持久标记的虚拟车辆和三个独立指定账户。测试固定12期、每期100分、固定押金100分，首次两笔各100分。全局保持`NEW_ORDER_CONTRACT_MODE=OFFLINE`、`CUSTOMER_IDENTITY_POLICY=MANUAL_REVIEW`。客户端不能提交开关启用虚拟行为；业务权限来自服务器冻结配置与车辆标记。

统一说明：仅用于实名、电子签、支付与归档验证，不形成真实车辆租赁或交付义务。

## 准备及入口

以下写入沿用当前员工权限、事务、版本与幂等校验；bootstrap/cooperation/freeze/revoke只允许ADMIN。

| 路径 | 作用 |
|---|---|
| POST `/admin/virtual-acceptance/bootstrap` | `revision:0,idempotencyKey,customerId,ownerId,ownerActorCustomerId,platformId,platformActorCustomerId,expiresAt`；创建DRAFT及不可解除标记的私有虚拟车辆。三个客户账号须不同。 |
| POST `/admin/virtual-acceptance/:id/cooperation` | `revision,idempotencyKey,productVersionId,subscriptionTemplateId,validFrom,validUntil`；生成只涵盖该车的合作草案，固定押金及不分润事实。 |
| POST `/admin/virtual-acceptance/:id/freeze` | `revision,idempotencyKey`及精确product/cooperation/01/02-main/02-grant ID和hash、`wrapperHash,wrapperApproved:true`；验证来源后READY并生成唯一私有套餐。配置hash不包含首次app/order绑定。wrapper批准独立于原模板批准。 |
| POST `/admin/virtual-acceptance/:id/revoke` | `revision,idempotencyKey,reason`；禁止新办理；不移除永久车辆标记。 |
| GET `/customer/virtual-acceptance` | 当前指定客户可见`entry`含私有vehicle/plan/applicationId/orderId及说明；其他客户无入口。 |
| GET `/customer/virtual-acceptance/capabilities` | 当前指定三账号可见本人入口、有效身份/电子签能力；企业角色只获得自己ownerId及法人H5地址。失效返回无入口，但指定账号保留`recovery.identity:true`以查询原身份/证书；该字段不授权新实名。匿名capability仍保持普通模式。 |
| POST `/customer/virtual-acceptance/owners/:ownerId/claim` | `{token}`；账户、路径企业与邀请企业必须一致，事务内重核当前范围。仅得到CLAIMED；不能替代真实企业实名。 |

## 初始申请与签约

客户原`POST /customer/applications`仅可用服务器返回的唯一plan，允许真实实名完成前提交。范围原子绑定唯一申请，重复幂等不建第二份。虚拟profile为严格version4；驾驶资格/信用/车辆权属/保险/对公结算明确不适用，不创建普通APPROVED审核记录。

`GET /admin/applications/:id/final-plan-defaults`对指定申请返回`kind:VIRTUAL_ACCEPTANCE`和测试参考日。

- POST `/admin/applications/:id/virtual-quote`：`revision,idempotencyKey,customerAddress,referenceDate?`。固定12×100+100，保留实际运营填写的联系地址；日期默认当前上海日，仅为测试参考。
- POST `/admin/applications/:id/virtual-review`：`revision,idempotencyKey,commercialHash`。VIRTUAL_QUOTE_REVIEW审计绑定当前真实法大大身份、个人资料、确切方案与配置。OPERATIONS须独立审核，保留既有ADMIN例外。
- 原customer confirm接口保留所有确认、归属、共享说明及版本要求；身份/资料/产品/合作/方案变化或范围失效均拒绝。冻结精确模板与已签02来源，不取全局latest。生成唯一订单及两张100分账单。

现有electronic-documents prepare/start/sign/review接口继续使用独立本人身份、原文确认和回调/归档校验。每次新外部操作在实际adapter派发处重核服务器绑定。该虚拟来源策略为`MANUAL_ONLY`：OWNER/PLATFORM逐份签；02-grant独立签署归档，但不能启用技术自动签授权。即使已有AUTHORIZED技术记录也不选AUTO。限制随任务/车辆/grant来源，不是企业永久限制。普通未来ELECTRONIC非虚拟授权规则不变。

付款必须绑定当前范围、冻结订单、DEPOSIT序号0或SUBSCRIPTION序号1及100分。已发起付款的回调/查询/退款对账、原签署查询/证据/归档在到期或撤销后保留。真实已签归档及两笔已支付才展示“测试签约与付款已完成／本测试到此结束，无需车辆交付”；订单不转ACTIVE。永久车辆标记在新交付、续租、换车、解约入口及实际激活/assignment/stage写入层拒绝，不能通过删除配置或恢复普通模式绕过。

## 发布接续的最小开关

此清单只是依赖说明，不授权改环境、发布或真实操作。仍须准确wrapper审定及真实账户/企业/产品/模板绑定后freeze；本任务未实际READY任何真实范围。

- 保持普通`NEW_ORDER_CONTRACT_MODE=OFFLINE`和`CUSTOMER_IDENTITY_POLICY=MANUAL_REVIEW`。
- scoped新实名/签署需要`ESIGN_NEW_REQUESTS_ENABLED=true`；客户实名还需`CUSTOMER_IDENTITY_ENABLED=true`、`FADADA_ENABLED=true`、`FADADA_ACCOUNT_REGISTER_ENABLED=true`、`FADADA_REALNAME_VERIFY_ENABLED=true`和现有有效服务器凭据/32字节加密key。
- 初始签署需`ELECTRONIC_SIGNING_ENABLED=true`、`FADADA_SIGNING_ENABLED=true`；小程序需`MINIAPP_SIGNING_ENABLED=true`、固定API2地址`https://textapi17.fadada.com/api2/`及`MINIAPP_SIGNING_PROVIDER_HOSTS=textapi17.fadada.com,realnameverify16.fadada.com`。`MINIAPP_FACE_BRIDGE_ENABLED`非本轮必须，保持关闭。
- 企业本人实名需`OWNER_ONBOARDING_ENABLED=true`；法人登录需既有`OWNER_LEGAL_H5_ENABLED=true`、`PORTAL_SMS_ENABLED=true`、有效短信配置和SESSION_SECRET。`OWNER_LEGAL_H5_ONLY`不是必要条件，保持原值；本轮按scope进入本人法人H5。通用`H5_SIGNING_ENABLED`不是本轮必须，可保持false；OWNER_H5是独立入口。
- `OWNER_AUTO_SIGNING_ENABLED`不需要开启，本轮保持false；`OWNER_AUTHORIZATION_ENABLED`不用于本轮新技术授权。普通旧入口仍被OFFLINE服务端守卫拒绝，不能仅靠隐藏按钮。
- 现有平台API/H5 HTTPS来源、正确回调/返回地址、CJK字体、法大大企业账户/印章真实证明以及微信支付独立配置仍必要。支付未增加新开关或财务自动化。真实企业/法人与客户资料由主控核对，本任务只验证合成数据。
- 匿名`/public/signing-config`的enabled/newEsignRequestsEnabled/newElectronicRequestsEnabled/electronicEnabled/fallback.enabled/ownerPortal.migrated仍false，newOrderContractMode仍OFFLINE；匿名identity仍MANUAL_REVIEW且能力全关闭。开启scope所需env不会使普通旧授权入口可新建操作。

既有发布脚本强制关闭ESIGN_NEW；主控须另做preserve发布工作，本任务未更改发布脚本。真实渠道AUTO未正向验收；真机微信/native与真实身份、签章、支付验收不由合成测试替代。
