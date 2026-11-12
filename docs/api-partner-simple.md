# 合作商简化办理 API（v2.3）

2026-10-28：已发布 `20261028-partner-simple-v23`，[部署证据](evidence/ninda-partner-simple-v23.md)。运营直接办理，无分权复核；分润基于净实收租金，比例由运营填写。

同日已发布保存与中文名称修复 `20261028-partner-agreement-save-v1`：[修复验证记录](evidence/ninda-partner-agreement-save.md)。支持百分号输入，已有乱码名称通过显示兼容恢复；未修改既有协议版本和业务数据。

## 授权与金额

新 `/api/admin/partners` 主体、协议、公司管理员及统计接口仅当前有效 ADMIN / OPERATIONS 可调用，无合作专项能力或员工映射前置。写入仍验证会话、CSRF、版本和幂等；不伪造旧审核事实。企业服务会话独立于小程序客户会话，逐公司隔离，除登录、确认绑定及退出外无业务写权限。

金额为整数分，partnerRateBps 为 0–10000 的整数基点，无默认值，0 合法。统计金额不表示已付款。

## 合作商与协议

- `GET /admin/partners`：列表。
- `POST /admin/partners`：`{profile:{name,subjectType?,creditCode?,address?,contactPhone?,ordinaryContactPhone?},idempotencyKey}`。仅名称必填。
- `GET /admin/partners/:id`：主体、agreements、vehicles、allowedActions。
- `POST /admin/partners/:id/profile`：`{revision,profile,idempotencyKey}`。
- `GET /admin/partners/:id/agreements`：协议列表。
- `POST /admin/partners/:id/agreements`：保存协议版本，载荷如下。
- `POST /admin/partners/:id/agreements/:agreementId/stop`：`{revision,idempotencyKey}`。
- `GET /admin/partners/:id/agreements/:agreementId/files/:fileId`：所属附件；通用文件读取不可绕过。

主体编辑采用完整 profile 替换语义：客户端应提交原 subjectType 以及需要保留的 creditCode、address、contactPhone、ordinaryContactPhone；省略选填文本字段会置空。主体类型建立后不可通过编辑改变。

```ts
{
  agreementId?: string;
  revision: number; // 新建为 0
  status: 'ACTIVE' | 'DRAFT';
  title?: string;
  referenceNumber?: string;
  fileIds: string[];
  partnerRateBps: number | null;
  vehicleIds: string[];
  validFrom?: string | null; // YYYY-MM-DD，可空
  validUntil?: string | null;
  notes?: string;
  replacements?: {vehicleId:string;agreementId:string;revision:number}[];
  idempotencyKey: string;
}
```

ACTIVE 要求原件、明确比例及车辆；DRAFT 可暂存不完整资料。响应有 currentVersion、latestVersion、versions、files（白名单元数据）、missingFields。编辑使用 latestVersion，生效展示使用 currentVersion；草稿不覆盖已生效版本。车辆已有合作归属须明确确认 replacement 并校验版本，不静默转移。

协议版本的 `title` 与 `contentHash` 保留原始不可变事实；`displayTitle` 仅用于显示及新版编辑初值，兼容早期中文上传文件名被按Latin1解码的记录。`files[].name`、企业服务及分润标签使用可读名称。新上传在存储前还原合法UTF8文件名，不改附件内容；显示修正不回写旧版本或改变内容哈希。后台允许填写80或80%并统一提交8000基点，API仍只接受整数基点。

订单冻结 revenueRuleSnapshot：mode=SIMPLE_AGREEMENT、ownerId、agreementId、agreementVersionId、versionId（同 agreementVersionId）、contentHash、title、partnerRateBps、vehicleId、modelId、modelName、plateNumber、validFrom、validUntil。修订协议不重算旧订单。

## 公司管理员与企业服务

- `GET /admin/partners/:ownerId/company-admin`
- `POST /admin/partners/:ownerId/company-admin/invitation`：`{revision,idempotencyKey,mobile,displayName?}`。
- `POST /admin/partners/:ownerId/company-admin/disable`：`{revision,idempotencyKey}`。

响应 `{ownerId,revision,status,entryUrl,current,invitation,allowedActions}`。status 为 UNSET/PENDING/BOUND/DISABLED。current 只含 maskedMobile、displayName、bindingMethod、boundAt、lastLoginAt 等必要信息。生成首次响应返回 invitationCode；幂等重试不回显明文，需显式重新生成。7 天有效，仅存哈希，默认不发短信。

- `POST /owner-h5/auth/invitation/preview`：`{mobile,invitationCode}` → `{previewToken,companyName,ownerId,maskedMobile,expiresAt}`。
- `POST /owner-h5/auth/invitation/confirm`：`{previewToken,consents}` → 安全 Cookie 及现有 portal Session DTO。
- `GET /owner-h5/owners/:ownerId/agreements`：仅已共享生效协议，`{items}`。
- `GET /owner-h5/owners/:ownerId/agreements/:agreementId/files/:fileId`：仅所属已共享附件。
- `GET /owner-h5/owners/:ownerId/cooperation-vehicles`：`{items,total,page,pageSize,models,agreements}`；车辆状态和当前协议白名单。

首绑展示企业名称后本人确认；同号逐公司确认。换号立即撤销原公司访问和旧挑战，新号待绑定。后续短信登录只聚合独立有效绑定的公司。持久失败计数不因验证失败回滚，限制猜码。企业服务不返回客户身份、电话、证件、收款账户或付款凭据。

## 分润统计

后台 `GET /admin/partners/:ownerId/revenue` 与企业服务 `GET /owner-h5/owners/:ownerId/revenue` 复用同一服务。

查询 from/to（北京日期 YYYY-MM-DD，含当日；默认本月）、agreementId、modelId、vehicleId、groupBy（month/agreement/model/vehicle）、page、pageSize。

```ts
{
  totals: {receivedAmount,refundedAmount,netAmount,partnerAmount,platformAmount},
  groups: [{key,label,receivedAmount,refundedAmount,netAmount,partnerAmount,platformAmount,count}],
  items: [{id,sourceType,sourceId,agreementId,agreementVersionId,agreementTitle,
    vehicleId,modelId,modelName,plateNumber,partnerRateBps,
    amount,partnerAmount,platformAmount,occurredAt}],
  total,page,pageSize,incompleteCount,
  filters: {agreements:[{id,title}],models:[{id,name}],vehicles:[{id,plateNumber,modelId,agreementId}]}
}
```

只计成功 SUBSCRIPTION 收款与退款；押金和额外费用不计。退款沿原订单比例，累计全退精确归零。使用可信渠道成功时间或系统首次确认成功时间，不用 updatedAt 猜历史时间。缺可信快照或时间的记录显示 incompleteCount，不猜算历史归属。查询失败显示错误，不能当作零。filters 取本公司全部不可变流水快照，不受当前日期或分页缩窄，支持车辆已转移后的历史筛选。
