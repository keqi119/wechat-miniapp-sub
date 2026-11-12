# 车辆资产：BAAS、折旧、牌照与内部成本台账设计

日期：2026-10-31。状态：供主控审阅的实施设计，尚未实施。

本轮只读本项目和指定旧提交的源码，仅新增本文件；未读取密钥、未连接数据库或线上环境。代码现状是本地工作区证据，不代表当前线上功能。继承依据为 `docs/superpowers/specs/2026-10-31-rebuild-reference-rules.md`、10/30 原需求和 10/16 独立平台设计；本稿新增的接口、权限分工和安全约束均为适配建议，不能写成用户已逐项确认。

## 1. 本阶段边界与方案选择

完成四个闭环：BAAS 合同登记及启停、成本计划预览后生成及财务确认；折旧策略及试算确认；独立牌照的归属和车辆绑定历史；统一内部成本读取、确认、人工付款事实登记及冲正留痕。

不自动付款，不调用支付供应商，不使用客户 `Bill`、`Payment`、退款或押金模型存内部成本；不自动改变客户月费、商品售价、合作分润或订单条款。残值曲线、事故维修、保养本阶段只规定接入边界，不生成空壳菜单或宣称已实现。不继承旧完整投资分析模块。

比较两种可用结构：

| 方案 | 代价与适用性 |
| --- | --- |
| 各领域各建成本记录表 | 移植旧 BAAS/折旧较快，但后续事故、保养重复实现确认、付款登记、冲正和权限，汇总容易重复计费 |
| 领域保留各自合同/策略，共用计划及成本分录 | 增加一次公共接口设计，后续直接共用期间、来源、幂等和审计；本稿推荐 |

推荐第二种。通用台账仅承载明确的内部成本事实；BAAS 周期和折旧公式仍由领域服务计算，不能把领域规则放入任意 JSON 公式编辑器。全部金额整数分、币种首期固定 CNY；日期为严格校验的 `YYYY-MM-DD`，账期为 `YYYY-MM`，用日期运算避免时区偏移。单笔沿用本项目 Int 上限；批次合计使用安全整数/BigInt 汇总并校验输出范围。

## 2. 已有能力与必须新增的部分

| 当前证据 | 可以复用 | 本阶段增量 |
| --- | --- | --- |
| `apps/api/prisma/schema.prisma` 的 `Vehicle`、`ModelDefinition`；`apps/api/src/vehicles/commands.ts` | VIN、车辆 revision、车型真实 modelYear、当前车牌、发布状态；VIN 已有规范化唯一索引 | 没有电池 BAAS 属性、资产成本、折旧策略、独立牌照模型；不能把 `Vehicle.year` 当首次登记日期或车型年款 |
| `apps/api/src/operations/admin.ts`、`apps/admin/src/resources.ts`、`apps/admin/src/vehicle-fields.ts` | 车辆台账和普通编辑 | 当前 `plateNumber` 可直接 PATCH，独立牌照上线时必须收拢成绑定命令，否则新旧入口会绕过历史与唯一性 |
| `VehicleOwner`、`PartnerAgreement/Version/Vehicle`、`apps/api/src/partners/simple-agreements.ts` | 个人/企业合作商档案、不可变协议版本、合作车辆范围及分润冻结 | 合作范围不是车辆所有权或牌照所有权；牌照归属只引用合作商主档，不能创建合作协议/车辆分配/门户授权 |
| `OwnerVehicle`、`PartnerVehicleBindingHistory`、`apps/api/src/partners/vehicle-binding.ts` | 历史车辆合作归属及锁定/留痕模式 | 不复用为牌照绑定表；它们有不同主体、权限和业务含义 |
| `apps/api/src/owner-h5/service.ts`、`partners/portal-session.ts`；`apps/signing-h5/src/owner/client.ts`、`SimpleWorkspace.tsx` | 公司范围、accessVersion 每次校验、显式 DTO 和客户端路由白名单 | 新牌照关系不得扩展原 `currentCompanyVehicles` 或 H5 白名单 |
| `apps/api/src/field-handover/service.ts`、`rules.ts`；`FieldHandoverTask` | 按 assignee、任务状态、vehicleAssignmentId、materialGeneration 隔离现场证据 | FIELD 不是资产查看角色；本期不新增资产派工权限 |
| `apps/api/src/auth/role-policy.ts`、`auth/access.ts`、`auth/staff-session.ts`、`common/db.ts`、`offline-documents/command.ts` | 固定岗位、当前会话复核、Serializable 重试、ArchiveCommand 请求摘要与结果回放、AuditLog | 新资源显式登记；命令授权必须在幂等回放前执行，不能仅复用 archiveCommand 就认为有权限校验 |
| `StoredFile`、`apps/api/src/files/files.ts`、`files/storage.ts` | 私有文件存储、摘要、大小/MIME 校验 | 新资产附件必须增加文件归属边界和专用下载路由，阻断通用 admin/customer/public/media 路径绕读 |
| `Bill` 必须关联订单，现有内部合作结算有独立模型 | 客户账单和合作结算继续原职责 | 本项目没有通用 AssetCost 模型；新成本不得关联客户账单来凑实现 |

## 3. 最小增量模型草案

以下为字段级草案，不是已经写入的 Prisma schema。所有可变聚合有 `revision Int`、创建/更新时间与操作人；外键在迁移中真实约束，不依赖仅存字符串。历史记录不级联删除。

| 模型 | 最小字段与职责 |
| --- | --- |
| `VehicleAssetProfile` | `vehicleId @id`、`revision`、`batteryOwnership UNKNOWN/OWNED/BAAS`、`firstRegistrationDate?`、`notes`。不复制车辆 VIN/车型/当前合作方；未知电池类型不能启用 BAAS |
| `LicensePlate` | `id`、`revision`、`plateNumber`、`normalizedNumber`、`plateType`、`region?`、`status ACTIVE/ARCHIVED`、`createdBy`。无租金、押金或收费默认值 |
| `PlateOwnershipPeriod` | `id`、`plateId`、`ownerId -> VehicleOwner`、`ownershipRevision`、`validFrom/validUntil?`、`recordedAt`、`recordedBy`、`reason`、证据关联。归属变更关闭前期并新增一期，历史 ownerId 和证据不修改 |
| `PlateVehicleBinding` | `id`、`plateId`、`vehicleId`、`bindingRevision`、`validFrom/validUntil?`、`recordedAt`、`recordedBy`、`reason`、证据关联。归属人与绑定车辆各自独立；不写 PartnerAgreementVehicle/OwnerVehicle |
| `VehicleBaasContract` | `id`、`vehicleId`、`revision`、`previousContractId?`、服务商、内部合同号、供应商合同号、电池套餐/序列号、`effectiveFrom/To`、`billingCycle MONTHLY/QUARTERLY/YEARLY`、`rentalAmount`、`paymentDayOfMonth`、`graceDays`、`invoiceRequired/taxIncluded`、`currency`、`status DRAFT/ACTIVE/SUSPENDED/TERMINATED/ARCHIVED`、`firstCostPeriod?`、`termsHash`、备注、各状态操作时间。已启用合同计价条款冻结；更正另建承接合同，不原位改历史租金 |
| `VehicleDepreciationPolicy` | `id`、`vehicleId`、`revision`、`previousPolicyId?`、`method STRAIGHT_LINE/MANUAL/NONE`、`basisAmount`、`basisSource`、`basisEvidence`、`residualAmount`、`startDate`、`usefulLifeMonths?`、`status DRAFT/ACTIVE/SUPERSEDED/ARCHIVED`、`termsHash`、币种、备注。基数必须录入真实依据，不从月租金/车型年款/估值预测猜测 |
| `AssetCostPlan` | `id`、`vehicleId`、`revision`、`sourceKind BAAS/DEPRECIATION`、`baasContractId?`、`depreciationPolicyId?`、`costPeriod`、`periodStart/End`、`amount`、`dueDate?`、`status SCHEDULED/CONFIRMED/VOIDED`、`sourceRevision/sourceHash`、不可变来源快照、生成/确认/作废人和时间。两个来源外键恰有一个；不接受客户端任意 sourceId/amount 覆盖公式 |
| `AssetCostEntry` | `id`、`vehicleId`、`revision`、`planId?`、`sourceKey @unique`、`category BAAS_RENT/DEPRECIATION`、`effect COST/REVERSAL`、`amount`、日期区间、`postedAt/By`、`sourceSnapshot/sourceHash`、`reversalOfId? @unique`、`lockedAt/By?`、原因与证据。确认时写入，金额和来源不可 PATCH；折旧是非现金成本，付款登记不适用 |
| `AssetManualPaymentRecord` | `id`、`entryId`、`revision`、`status RECORDED/VOIDED`、`amount`、`paidAt`、`referenceNo`、`recordedBy/At`、原因与证据。首期仅整笔人工登记，金额复制有效 BAAS 成本分录；没有交易号回调、支付按钮或渠道成功状态 |
| `AssetPrivateFile` | `fileId @unique -> StoredFile`、受控 `kind`、具体资源外键、上传人及文件 hash。数据库 CHECK 保证恰有一个对应资源；证据可被同聚合历史引用，跨聚合复用需显式校验。禁止 `storagePath` 入 DTO |

幂等记录复用 `ArchiveCommand`，资源命名空间例如 `asset:plate:<id>`、`asset:baas:<id>`、`asset:cost:<id>`；其现有 `(actorId,resourceId,action,key)` 唯一约束适用。不增加第二套相同命令日志。来源快照不包含客户身份、订单全文、账户或原始文件路径。

数据库约束至少包括：

- 车牌 `(normalizedNumber,plateType)` 唯一。统一 trim/大写、拒绝不支持字符；不以当前城市拼接出不同身份，也不套用未经确认的单一车牌长度。
- 每个牌照最多一个开放归属期；每个牌照最多一个开放绑定期；每辆车最多一个开放牌照绑定期，均用 `WHERE validUntil IS NULL` 的部分唯一索引。历史区间无重叠在资源行锁内检查；如将来允许回填任意历史区间，应补排他约束，不用“先查后插”裸写。
- 同车最多一个 `ACTIVE` BAAS 合同、一个 `ACTIVE` 折旧策略；用部分唯一索引加事务锁，不能只在 UI 禁按钮。
- BAAS `@@unique([baasContractId,costPeriod])`、折旧 `@@unique([depreciationPolicyId,costPeriod])`；来源 CHECK 保证正确非空组合。同车同类别已有有效确认期不得重叠，承接合同/策略也必须检查。
- 初始确认每个 plan 只能产生一条正常成本分录；冲正只能指向原分录且一次，不能冲正冲正记录。一个分录最多一笔未作废人工付款登记。
- 金额非负、开始不晚于结束；残值不得超过基数；折旧周期/月数有上限。零额折旧期保留为零额记录，不误称已付款；BAAS 周期金额须大于零。

## 4. BAAS：预览、生成计划与财务确认分开

### 4.1 可直接继承的计费语义

固定旧提交 `db4b48c55890f11f52c4fc52c29242d7c0d150be` 的 `apps/api/src/vehicle-baas/vehicle-baas.service.ts` 已核对：

- 月/季/年间隔 1/3/12 月，每期金额就是 `rentalAmount`。例如季租 300000 分，每季度一条 300000 分，不再乘 3。
- `fromPeriod` 是所选首月的月初；每期到下个周期起点前一天；`toPeriod` 限制的是周期起始月。季租选择 2026-01 至 2026-02，得到的仍是 2026-01-01 至 2026-03-31 一期，UI 必须显示实际覆盖终日。
- 付款日在周期开始月，超过该月天数取月末，例如 2027-02 付款日 31 得 2027-02-28；宽限日不改变本金，不自动生成罚息。
- 原实现不按合同起止裁剪、不折算首末期。保留完整期间与整期金额；预览明确标记超出合同日期、非自然完整合同覆盖等项，不悄悄折算或自动确认。
- ACTIVE/SUSPENDED 可按明确选定的历史范围生成计划。暂停阻止默认未来新增，但不自动取消已有计划、冲正已确认成本或认定租金停止；需要根据实际合同逐笔处理。终止/归档不触发付款或退款。

### 4.2 新项目的完整操作

1. 运营录入 BAAS 档案，确认资产电池类型为 BAAS。启用在车辆行锁下执行；所有金额/日期/附件齐备、当前无另一 ACTIVE 合同后写审计。
2. 选 `fromPeriod/toPeriod` 后调用只读 preview。返回每期完整起止、付款日、整数分金额、已有期及状态、将生成/跳过数量、合计和警示。
3. 首次生成把明确选择的 `fromPeriod` 固定为该合同 `firstCostPeriod`；后续生成须满足与该锚点相差 1/3/12 月的整数周期。该约束为防止季租换一个首月重复覆盖的适配保护，不是新增折算公式。锚点不能由重新生成操作悄悄移动。
4. 点“确认生成成本计划”提交 `revision,idempotencyKey,fromPeriod,toPeriod,previewHash,acknowledgedWarningIds`。服务器重新读取当前合同与已有记录，重新计算并比对 hash；不同返回 409，要求重新预览。不可提交整批自定金额。所有可生成行一次事务完成，已有期跳过；VOIDED 也显示已有，不能自动重建。
5. 此时只是 SCHEDULED。财务逐期或明确勾选批次“确认成本”，在同事务把计划改 CONFIRMED 并生成不可变成本分录。批次每条带 revision，全部成功或全部失败；不能只确认半批后返回失败。
6. 仅 BAAS 的有效已确认、未冲正分录可整笔登记“人工已付”；须实际付款日期、付款参考号/说明、证据。不生成支付请求，也不改变客户账单。原旧实现允许 SCHEDULED 直接标已付，本项目建议收紧为先确认成本，保持动作含义明确。
7. 未确认计划可作废；确认后只允许按台账冲正流程处理，不回写历史 amount。合同计价变更另建承接合同，不能重算已生成/确认记录。若需要恢复误作废但从未确认的计划，显式 reopen 命令重新预览并递增 revision；已经确认后冲正的旧计划不自动复活。

首期无定时生成/自动确认任务，逾期只是根据应付日、宽限日和人工付款登记计算的内部提示，不等于向供应商催收或发生渠道欠款。

## 5. 折旧：策略、试算、计划与确认分离

固定旧路径 `apps/api/src/vehicle-depreciation/vehicle-depreciation.service.ts` 的确定规则：

```text
可折旧额 D = basisAmount - residualAmount
每月基础额 B = floor(D / usefulLifeMonths)
最后一期 = B + (D - B * usefulLifeMonths)
```

第一期间从 `startDate` 到当月末，仍为完整一期金额；以后自然月，总期数为指定月数，不按首月天数折算。例如基数 10001 分、残值 1000 分、3 月，三期为 3000、3000、3001 分。试算展示此规则，精确显示尾差，不能以前端浮点运算确定入账金额。

- STRAIGHT_LINE：基数/残值/起算日/月数明确录入后试算，生成 SCHEDULED；确认每期生成 DEPRECIATION 分录。必须满足全部期合计正好等于 D，累计确认不超过 D。
- MANUAL：不自动套直线法；财务逐期录入期间、金额及依据，先为 SCHEDULED，预览总额后确认，仍服从期间去重、累计上限和证据校验。
- NONE：明确不计提；返回空计划及原因，不生成零金额“已折旧”分录来冒充计提。
- 仅 DRAFT 可编辑金额依据与公式字段；ACTIVE 的未来调整通过新策略承接，原策略 SUPERSEDED，旧已确认/锁定记录原样保留。不得将新完整策略从旧起算月再跑一次覆盖已计提期间。
- 承接策略要求人工明确剩余基数、残值、剩余月数和新起算日；预览同时展示已有净累计折旧与承接依据，未填不能激活。不能把残值预测或当前市场售价直接写回折旧基数。
- 锁定只适用于已确认分录及其对应计划，必须有原因与操作人。锁定金额不能改、不能直接作废；首期不提供解锁接口，保留未来受控调整入口，不临时用普通 PATCH 绕过。
- 资产摘要分别显示历史净计提、未来计划、锁定额和按所选策略的账面值；账面值必须明确依据版本。没有明确基数时显示“未登记”，不输出猜测数值。

## 6. 牌照归属、车辆绑定及旧字段兼容

旧提交没有独立牌照收费/租赁模型。首期只做档案、归属合作商、当前绑定和历史，合作商个人/企业主体继续共用 `VehicleOwner`，无需创建另一个“牌照人”客户账号。

归属变更与车辆换牌是两个命令：

- 归属：保存 plate 与 owner 的当前关系，保留原归属区间及证据。只表示备案，不自动签约、不改变车辆合作分润、不启用 PartnerPortalAccess、不派生 Customer/OwnerMember。
- 绑定：选定当前可用牌照与车辆，提交双方 revision、当前绑定 revision、原因和证据。锁定车辆和牌照后，关闭旧绑定、建立新绑定、更新 `Vehicle.plateNumber` 和 vehicle revision；同一事务保证显示字段与历史一致。
- 对已占车车辆，允许原车换牌的登记事实，延续当前 `vehicles/commands.ts` 的车牌例外；不能借换牌改变 VIN、当前车辆分配或历史订单快照。跨车辆移动牌照须显式提交旧/新车及其版本，不能隐式抢占另一车辆牌照。运营需核对未完成交接使用的当前车牌，交接已确认事实不追溯重写。
- 首期变更以服务器实际确认时刻生效，历史记录只允许关闭 `validUntil`，其余事实不可编辑；错误归属/绑定以反向新命令更正并关联原事件。真实历史补录日期与追溯纠错另设受控流程，不能在普通表单任意回填造成重叠。
- 旧 `Vehicle.plateNumber` 保留为兼容读字段。上线后普通车辆 PATCH 若改变它应返回明确业务错误，指向换牌命令；保持同值可接受。新车可以不绑定牌照，后续由牌照入口完成绑定，不制造未知 owner 的有效归属。
- 历史车牌文本不自动当成已核验牌照资产/归属证据。迁移只提供候选清单：重复号码、缺类型、未知归属都待运营确认；不得一键猜测“车辆合作方就是牌照归属人”。已签快照仍保存其当时车牌。

## 7. 共用台账、附件与统计口径

`AssetCostPlan` 是预期成本，`AssetCostEntry` 是已确认成本，`AssetManualPaymentRecord` 是人工付款登记。三者分别统计，不能把计划、确认和人工付款相加为三笔费用。折旧是非现金项目；资本化基数与残值估值不计入日常实际支出合计。

允许的台账动作：确认、锁定、冲正、整笔人工付款登记、撤销错误付款登记。确认必须由领域服务验证源；不开放任意 source/category/vehicleId 的通用创建分录接口。冲正新增相反作用记录，原记录保留，且拒绝已锁定分录。已有有效人工付款登记的成本不能直接冲正；先对真实事实核对并办理登记更正，不自动推导退款已发生。

确认后发现金额有误时，不能编辑分录。首期通过冲正原成本并登记有独立依据的替代计划处理，替代必须显式引用被更正 plan/entry、取得车辆/来源锁、检查原记录未锁定且无有效付款登记；正常 plan 与替代 plan 的唯一来源键需区分，但同车同类别同期间只允许一笔未冲正确认成本。替代金额仍由对应的新合同/新策略或 MANUAL 策略计算，不接受“直接改一笔金额”。此修正流程须作为显式命令测试，不允许绕过正常唯一约束插一行。

事故维修/保养后续通过自身 `AssetWorkOrder` 的费用确认调用同一台账接口，增加来源枚举和真实 FK；不能预先将客户 `ServiceRequest` 当已实现的内部工单。费用计划、实际费用和保险人工赔款登记分开；赔款不能直接把维修原成本改小。需要费用确认的关单至少一笔未冲正 ACTUAL_COST；FIELD 只能填写被分配的现场事实，不能确认成本。保养下次日期/里程、残值样本及曲线不属于成本分录。

附件使用 `asset-baas`、`asset-depreciation`、`asset-plate`、`asset-cost` 的专用上传/读取边界，验证当前 actor、所属资源、文件种类、MIME/大小/hash。新增映射须接入 `files/files.ts` 的边界判定，即使图片意外被填进车辆 mediaFileIds，public/media 也不能读取。H5 不可通过已有合作协议文件路由读取资产附件，FIELD 不可通过任务文件路由读取它们。上传成功但业务保存失败的孤立文件留待现有清理策略，不伪造完成记录。

## 8. 最小接口与命令契约

以下新接口均由专用 controller/service 提供，更新时将准确 DTO 写入 `docs/api-contract.md`。只读 GET 分页 `page/pageSize`，pageSize 上限 100；预览最多 120 期，超限明确拒绝或要求拆分，不默默截断。列表/详情仅显式字段投影。

| 接口 | 语义 |
| --- | --- |
| `GET/PATCH /admin/vehicle-assets/:vehicleId` | 基础电池归属/首次登记日期；PATCH 带资产与必要车辆 revision，不接收成本/客户字段 |
| `GET/POST /admin/license-plates`，`GET /:id` | 档案列表/新增/含独立归属、绑定历史的详情 |
| `POST /admin/license-plates/:id/ownership` | 原归属版本 + 新合作商 ID + 原因/证据；不产生协议授权 |
| `POST /admin/license-plates/:id/bind`、`/unbind` | 指定车辆/原绑定版本与双方 revision；禁止普通 PATCH 关系 |
| `GET/POST /admin/baas-contracts`，`GET/PATCH /:id` | 草稿字段；PATCH 只允许 DRAFT 计价字段 |
| `POST /admin/baas-contracts/:id/activate|suspend|resume|terminate|archive` | 明确状态转移、revision、原因；所有状态不能由 PATCH 输入 |
| `GET /admin/baas-contracts/:id/cost-preview?fromPeriod&toPeriod` | 无写入，返回候选/已有/警示/摘要/hash |
| `POST /admin/baas-contracts/:id/cost-plans` | 再算并核对预览，原子生成计划 |
| `GET/POST /admin/depreciation-policies`，`GET/PATCH /:id` | 策略草稿与历史，只允许财务维护金额依据 |
| `POST /admin/depreciation-policies/:id/activate|archive` | 明确承接/启用；激活新策略与原 ACTIVE→SUPERSEDED 原子完成 |
| `GET /admin/depreciation-policies/:id/plan-preview` | 直线法试算/人工期汇总；NONE 空计划 |
| `POST /admin/depreciation-policies/:id/cost-plans` | hash/revision 校验后生成 SCHEDULED；MANUAL 允许显式期间金额，经服务器验证 |
| `GET /admin/asset-cost-plans`、`GET /:id` | 按车辆、来源、期间、状态筛选；计划详情 |
| `POST /admin/asset-cost-plans/:id/void|reopen` | 仅未确认计划；按来源角色再校验，保留审计 |
| `POST /admin/asset-costs/confirm` | 财务确认一条或明确勾选批次 `{plans:[{id,revision}],idempotencyKey}`；同事务生成分录 |
| `GET /admin/asset-costs`、`GET /:id` | 已确认成本和净额、冲正/付款证据；不混入客户账单 |
| `POST /admin/asset-costs/:id/lock|reverse|manual-payment` | 财务专用动作；revision、幂等、原因与必要证据 |
| `POST /admin/asset-costs/:id/correction-preview|correction-confirm` | 显式替代来源与被更正期；preview 不写库但仍以财务权限保护，confirm 重新计算；不接受任意新金额 |
| `POST /admin/asset-costs/:id/manual-payments/:recordId/void` | 撤销错误登记，非发起退款；双层资源归属校验 |
| 各领域 `/:id/files` 与 `/:id/files/:fileId` | 私密附件上传/下载；不能通过任意资源 ID 串读 |

每个有副作用的命令包含非负整数 revision 和 8–128 字符幂等键；新增聚合 revision=0，涉及多个聚合必须带全部会变化对象的版本。单条成本确认与批次确认共用服务，避免两条路径校验不同。

预览 hash 覆盖：算法版本、来源 ID/revision/termsHash、车辆资产 revision、请求期间、精确候选行、已有记录 ID/revision/status、警示 IDs；确认请求中的 warning acknowledgment 只确认可接受的边界提示，不能跳过角色、唯一性、来源或金额限制。预览后数据有变必须 409；不同参数不能复用旧 hash。对旧记录“已存在”的返回包含其真实状态，不用 skipped 掩盖未确认/已作废。

## 9. 权限、H5 与 FIELD

建议岗位分工如下，实施时由主控确认并登记为新资源权限，不扩 `vehicles.read` 的含义：

| 范围 | ADMIN | OPERATIONS | FINANCE | SUPPORT / FIELD / 合作商 H5 |
| --- | --- | --- | --- | --- |
| 资产基本信息 | 读写 | 读写 | 最小身份只读 | 不新增权限；原车辆/任务显示保留 |
| 牌照档案、归属、绑定、证据 | 读写 | 读写 | 仅成本详情的当前车牌显示，无归属证据 | 无 |
| BAAS 合同与计划预览/生成 | 读写 | 读写 | 只读，付款事实从成本路由办理 | 无 |
| 折旧策略、试算/生成 | 读写 | 仅车辆资产页“已配置/未配置”状态 | 读写 | 无 |
| 内部成本计划 | 全部 | 仅其 BAAS 计划及金额；不能看到折旧私有依据 | 全部 | 无 |
| 成本确认、锁定、冲正、付款事实登记 | 允许 | 禁止 | 允许 | 禁止 |

资源键建议 `vehicle-assets`、`license-plates`、`baas-contracts`、`depreciation-policies`、`asset-cost-plans`、`asset-costs`。固定岗位 + 服务端权限声明 + 动作/来源行级校验必须同时成立。当前路由中间件按 `/admin/<resource>` 判定写权限，所以财务动作放在 `asset-costs`，不能让 OPERATIONS 因为能改 BAAS 合同而获得成本确认。混合 `asset-cost-plans` 列表必须按当前角色在 SQL 查询阶段过滤来源，不只前端隐藏；总数也按同一范围计算。

不引入未经要求的双人审核流程；ADMIN/FINANCE 当前角色可按上述分工确认。但必须保留实际提交/确认人，禁止伪造旧流程的“已审核”字段；后续若配置独立复核再单独实施。

合作商 H5 继续依据 `PartnerPortalSession`、`PartnerPortalAccess`、`accessVersion` 与有效合作协议取数。新 PlateOwnershipPeriod 即使 ownerId 与某公司一致，也不能进入 H5 车辆查询的 OR 条件，不产生收益可见范围；牌照归属人不能因此看到车辆完整 VIN、资产成本、BAAS 合同、折旧、客户、订单或文件。现有合作车辆 DTO 仍仅包括已授权的 vehicleId/plateNumber/modelId/modelName/status/协议摘要等白名单字段，不展开 VehicleAssetProfile 关系。

FIELD 继续只能读取 ASSIGNED 给自己的交接任务，改派/取消/账号停用即失权；不添加 `asset-costs`、`license-plates` 等权限。后续资产维修派工应独立实现 `AssetWorkOrder` 任务作用域，使用 assignment generation 隔离旧材料，不把 FIELD 变成全车资产查询者。当前交接只能显示其任务需要的当前车牌与车型，不能通过它获得所有权、成本或客户原始资料。

## 10. 并发、幂等与权限收回

1. 每次命令先 `requireCurrentStaff` 并校验实际 authVersion、角色与动作资源，再执行幂等查找；浏览器路由许可不能替代这一步。失权后旧成功键也不能泄露旧结果。
2. 统一 `Db.serial`。新资源按固定顺序锁涉及车辆（ID 排序），再锁牌照/合同/策略，再锁计划/分录；同时触及合作商的流程遵守现有 simple-agreements 的“车辆先、合作商后”顺序。禁止两个新服务各自反向锁同一对象。
3. 首次创建无 ID 时按 actor + 资源 + action + key 取得事务 advisory lock，防并发同键重复创建。幂等记录与实际业务、审计在同事务提交；同键不同摘要返回 `IDEMPOTENCY_CONFLICT`。
4. 每条更新以当前 revision+允许状态做 CAS，失败返回 409。数据库唯一约束兜底双 ACTIVE、双绑定、重复账期、重复冲正、重复确认/付款登记。P2002 仅映射具体冲突，不把任意唯一失败当成功。
5. 预览无业务写入；确认重新算 hash，不信任客户端成本总额。确认期间新的 plan/entry 或源变化会使 hash 失效，不能“尽量确认剩余几行”。
6. 不在持有数据库事务时调用外部支付、短信或文件远端服务。附件上传先落独立文件，再通过领域事务关联；所有下载再次校验当前角色和资源归属。
7. 真实归属/绑定历史只追加，历史关系结束只填一次 validUntil；禁止删除原事实或把停止时间挪到过去覆盖另一段历史。保留 recordedAt 与业务期间以便核对。

## 11. 页面与实施分工

后台在车辆管理下新增牌照、BAAS、折旧入口，内部成本台账放财务模块；车辆详情提供有权限的摘要与相关记录深链。紧凑列表 + 页面内详情，方案预览明确列出期间、金额、状态及跳过/警示；确认按钮展示本次总额，不以通用 CRUD 的“保存”代替入账。费用元输入在表单边界转整数分，所有结果用服务端试算。

分工建议，先固定 DTO 与迁移再并行，避免重复改共享文件：

| 工作包 | 独占建议路径 | 交付 |
| --- | --- | --- |
| 主控集成 | `apps/api/prisma/schema.prisma`、新迁移、`apps/api/src/app.ts`、`auth/role-policy.ts`、`auth/access.ts`、`files/files.ts`、`docs/api-contract.md`；后台 App/resources/navigation 统一协调 | 数据约束、守卫、注入、文件边界、菜单与协议 |
| A：共用台账 + BAAS | 新 `apps/api/src/vehicle-assets/`、`asset-costs/`、`vehicle-baas/` 及对应 test | 日期/分算法、预览 hash、事务计划、确认、冲正、人工付款事实 |
| B：牌照 + 折旧 | 新 `apps/api/src/license-plates/`、`vehicle-depreciation/` 及对应 test；`vehicles/commands.ts` 的牌照兼容调整需与主控约定单写者 | 归属/绑定历史、普通 PATCH 防绕过、策略/试算及承接 |
| C：后台 | 新 `apps/admin/src/vehicle-assets/` 或同名页面/model/css/tests；入口共享文件由主控合入 | 本地合成数据的完整命令 UI、元分换算、权限和深链测试 |
| 独立复核 | 只读各阶段限定 diff，数据库测试按主控独占时段 | 账期金额、并发幂等、文件访问与角色/H5/FIELD 回归 |

顺序：公共 DTO/台账与约束 → 牌照及基础电池属性 → BAAS → 折旧 → 合并后台和三端权限回归。台账未完成前允许纯算法与预览工作，不对外宣称“已确认成本”。本次文档不改变这些文件，不授权付款或数据库操作。

## 12. 必须先红后绿的行为验收

- BAAS 月/季/年、31 日/月末/闰年、整周期金额、跨合同边界显式提示、暂停合同的明确补期、锚点错位拒绝、已有/VOIDED 跳过、未知电池类型禁止启用。
- 同车并发启用两合同仅一条 ACTIVE；两个同键/不同键批次并发生成同期间不重复；预览后合同/计划变化必须 409；失败不残留半批计划/分录。
- 折旧整数尾差、首月完整金额、零可折旧额、MANUAL 不套公式、NONE 无计划、残值大于基数/总额超限拒绝；确认与锁定不覆盖；承接不重复计提旧期间。
- 牌照双绑定、车辆双牌照、归属变更与绑定变更并发；直接 vehicles PATCH 换牌被拒；旧订单快照不改变；未知归属历史迁移不猜测；同键回放无新增历史。
- 成本只确认一次；冲正只一次；已锁定拒绝改动；人工付款必须有效 BAAS 成本和证据，折旧拒绝付款登记；不调用支付、不新增 Bill/Payment。
- ADMIN/OPERATIONS/FINANCE/SUPPORT/FIELD 矩阵、失权后幂等回放、跨来源计划 ID、资源父子 ID 不符、成本附件猜 ID、公媒旁路均拒绝。
- 仅有牌照归属但没有合作协议的公司，在 H5 不多出任何车辆/收益/成本/客户/附件；已有协议公司 DTO 也无新增敏感字段。FIELD 只显示其任务必要车牌信息，改派后旧任务文件失效。
- 后台真实同组件 hashchange/process-location 与页码/筛选一致，409 保留输入并要求重预览，提交后回读失败不提示“提交失败请重付”。桌面/窄屏本地合成验收，不以无权限页冒充功能预览。

## 13. 已确定规则与最少待定事项

**足够直接继承**：BAAS 字段与状态、仅 BAAS 车辆启用、同车单 ACTIVE、1/3/12 月、每周期原金额、付款日月末截断、计划后确认、人工付款事实；折旧三方法、首期完整金额、整数尾差、计划/确认/锁定分开；牌照归属与绑定历史；新项目 revision、事务、权限和幂等补强。

**逐笔业务事实，不需要再问用户全局规则**：某合同的实际租金/起止/付款日、某车是否 BAAS、具体归属人、采购或折旧基数及证据、残值、起算日与月数、已付凭据。必须由运营/财务填写或导入真实资料；不能用旧界面默认值代填。

**本期没有新增阻塞用户的问题。** 当前仍只等待已提出的降级换车问题，本文件不发新问题。下列扩展若以后明确要求，才集中确认：

1. BAAS 是否按日折算首末期、提前终止如何结算：需要明确分母、包含首末日规则及分到分的舍入/尾差；本期保留旧整期规则并预览确认，不自动推断。
2. 牌照是否产生租金/押金/服务费：需明确付款方、收款方、收费期间与金额；首期没有收费模型，不凭归属关系新增应付或扣分润。

折旧的实际基数/残值/月数由每辆车明确配置；本系统管理台账不自行提供税务折旧或法定财务结论。若要求自动资本化、历史追溯重算、锁定期间调整、分次付款或自动抵扣合作分润，应另给业务依据和验收范围，不能把它们塞入本期“继承功能设计”。
