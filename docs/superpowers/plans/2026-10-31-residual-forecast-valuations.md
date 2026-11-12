# 单车残值预测与人工估值实施计划

依据已审阅残值设计、已稳定七表与统计纯函数。仅建立预测/复核事实，不写车辆售价、租金、折旧、账单或支付。

## 预测

- 新`residual-market/forecast-{types,command,controller}.ts`和`forecasts.ts`，对应专项测试。使用独立`/admin/residual-forecasts`资源；POST `/preview`、POST根创建、GET列表/详情、POST `/:id/points/:pointId/adopt`及`/:id/archive|void`。预览请求含vehicleId/curveId/asOfDate/horizonMonths；创建另含revision=vehicleRevision、assetRevision、curveRevision、previewHash/key。
- 预览允许明确的DRAFT曲线并提示未生效，正式保存只用当前ACTIVE。校验车辆真实车型ID及年款、资产首次登记日、电池归属与容量；不存在款型事实时不能匹配限定trim的曲线，不用车型名称猜。没有可信采购价则单车残值率返回null，不能用折旧基数或曲线参考价充数。
- 复用原样统计及曲线冻结校验；actual服务月无关，不挪用租期日期。原`UNSUPPORTED_OUT_OF_RANGE`转换为数据库`UNSUPPORTED`，金额/区间保持null。目标日期夹月末，不外推。
- 创建锁Vehicle→AssetProfile→Curve，重新验证版本、ACTIVE及预览摘要，冻结车辆身份/资产事实/曲线/每点权重。历史读取只验证冻结来源和数学，不读取实时车型/当前资产重算旧预测。
- 采用必须同父点且受支持，每点一次；另存明确采用金额/原因/人/时间，不覆盖原预测值。第一个采用将父状态标ADOPTED。已采用或有APPROVED估值引用不得VOID；归档保留事实。引用已VOIDED预测的待审估值不得批准，但可驳回/取消。

## 人工估值

- 新`vehicle-valuations/{types,command,controller,service}.ts`及对应测试。GET/POST根、GET详情、POST `/:id/approve|reject|cancel`。ADMIN/OPERATIONS/FINANCE可申请/读；批准/驳回仅ADMIN/FINANCE，取消仅原申请人或ADMIN的待审记录。所有专门动作当前权限先于幂等回放。
- FORECAST申请需同车真实点及当前forecastRevision，父未归档/作废且点受支持；MANUAL的两个forecast字段必须null。requestedAmount是明确申请值，不自动等于采用值。冻结来源及beforeSnapshot，不伪造评估。
- 批准需本复核专用凭据、明确approvedAmount/原因、当前vehicleRevision及review revision；FORECAST再核真实点归属和未作废来源。以上海当天加3个月夹月底设置nextReviewDate。终态不改金额，后续评估新建；历史资料不跟随车辆改名重写。
- 同点只允许一个PENDING，SQL partial unique兜底并发；known command唯一冲突仅精确类型重试，其他错误不得假成功。

## 核验和职责

主控负责controller注册、契约、已有schema/角色/六parent文件边界。B独占上述新文件；如需曲线冻结校验导出，仅可在新阶段基线后把已存在函数改为export，不改统计/已验收曲线业务。A样本/导入文件不并改。C后续接真实接口页面。

先红测金额/日期/匹配维度、零采购价来源、月末和范围外、快照篡改、预览变更、失权、同键回放、点重复采用、禁止作废已采用事实、待审来源失效、角色分离及终态不可改。再统一guard独占数据库做真实HTTP/并发、专用凭据、三个入口拒绝与客户资金零副作用；原曲线/样本历史仍可读。
