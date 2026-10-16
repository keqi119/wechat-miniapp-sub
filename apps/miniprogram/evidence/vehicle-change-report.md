# B2免费次数换车与逐车里程原生报告

2026-10-16。仅修改apps/miniprogram；依据阶段B批准设计与API负责人固定的b2-contract。原Mock、API/admin、法律全文、根依赖/锁、已冻结.runtime发布副本均未修改，无提交/部署。

实现：

- 新swap适配器严格读取本人账户与免费周期，免费可用/预占/实际消费、来源及流水分开；cycle.endDate标明不含。真实申请前fresh canRequest，理由必填、稳定幂等key和busy，POST真实返回后只导航实际记录。申请不扣次、不建付款、不本地假成功，失败提示查询原记录。B3没有购买接口或按钮，canPurchase永远false，本轮paidAvailable仅接受0。
- records权益页将次数与月里程分别读取，单侧失败不伪造另一侧。用车页入口可查看当前变更或次数账户；currentAssignment=null清除旧车名/图片/读数投影，明确换车待交付。
- 复用orderchanges详情精确区分延期/换车，保留完整报价阅读与当前revision/hash/期限。换车展示冻结车辆身份字符串、原期限与月界、逐期应付/原实收/沿用/补收/退还、新月费、押金补退/依据、交接费/依据、保险及责任、无车间隔及取消安排，显著BEFORE_RETURN资金门槛。缺vehicle-change-amendment已填正式正文、错误类型/占位/期限/资金门槛不确认，已确认版本不被首次确认期限误阻签署。金额始终整数分来自safe，不客户端推算费用。
- 当前/原分配与目标车、SWAP_RETURNED无车间隔、两侧交接与实际完成/登记时间分别显示；旧分配记录与报价冻结身份并存，live车辆修改不替换本版本报价。两侧按钮各自打开明确handover ID，不依赖dashboard猜是哪辆车。SWAP_RETURN明确不是退订，SWAP_DELIVERY不重发本月1500或包余额。
- 交接仍要逐项读附件、fresh manifestHash+actualAt核对、明确北京时间、默认未确认。新type缺vehicleId/vehicleTitle/changeId或有效实际时刻不允许新事实确认；历史已响应保留可读。事实确认、单独签署和后台实际完成分开。
- usage账户新增分配历史与每期segments，逐车基线/终点/证据状态分别显示；只有服务端月总用量显示汇总，无跨车仪表相减/取max。segments存在即须选择本车可申报段，不能回退旧period路径；仅提交readingKm/recordedAt/fileIds/key，服务端绑定车辆与分配。开放段照片上海日期对应effectiveEndDate，封闭段对应endAt且须server.canSubmit；已签交接固定段不由普通申报覆盖。已结/空segments/错误段/读数倒退/日期不符拒绝，缺证据保持待审核；月份或段版本更新清除旧照片/读数。
- AMENDMENT复用既有H5公开配置及用户复制入口、可信sync；标题改为通用订阅变更补充协议。不新增miniapp sign/register/verify/web-view或供应商跳转fallback。

验证：

- 本轮开始基线124/124。新增13项行为测试，其中12项在相应实现前观察RED，1项后续补充确认流程直接通过；最终全包137/137。覆盖鉴权/归属数据、非法数字/未知状态、预占不消费、理由/fresh能力/幂等/错误、防重、完整换车报价/期限/当前版本/文案类型、H5无POST签署、原始车辆身份及历史、两侧ID、无车间隔、不同车90000与20仪表基线、日期/照片/段版本/已结/空段拒绝。旧延期、H5、普通账单支付、信用及A里程包/退订回归全部保留。
- npm run build：90文件，官方wcc/wcsc编译16 WXML、17 WXSS通过；node scripts/verify-reference.cjs：109文件×2副本，0差异。
- node scripts/verify-vehicle-change-layout.cjs：14个actual-wcc离线合成状态、14PNG，390×844视口，无横向溢出/JS异常/外部请求。证据vehicle-change-layout/report.json。已目视新车本车基线申报、次数预占、无车间隔完整报价、旧侧交接，最后更新冻结身份及分配历史后再次生成并复核。
- git diff --check通过（仅平台既有LF转CRLF提示）。

范围边界：全是本地内存请求/数据与actual-wcc离线显示fixture，没有读取真实客户、连接数据库或业务网络，没有SDK/DevTools/真机、真实剪贴板、SMS/支付/实名/签署、二维码/预览/上传。服务器免费周期计算/资金/库存/两侧完成原子性由API负责，本文不冒称已进行真实端到端验收。正式换车补充模板未批准发布时前端关闭确认/签署；是否实际发布及H5启用由主控掌握。最后接口字段变更须明确同步，不能用Mock回退。


## B2恢复报价契约收尾

依据API最终phase-b2-report与最新b2-contract，补齐恢复版本安全关联：quote.recoveryFromQuoteId表示最近已签取消基线，financeSourceQuoteId表示原已核清资金来源，两者分别保留，不在客户端推算/重建。缺其中一项的恢复报价fail closed。客户仍默认未勾选，fresh GET核对当前revision/hash/期限，确认只POST revision/commercialHash/key，无金额、目标或历史quote ID写入。

恢复详情明确此次仅重新确认日期、交接与无车安排；逐期金额标为沿用原已签资金安排，已履行部分不再次履行，真实未结额看原账单/当前资金进度。拒绝未签新安排后读取服务端恢复的最近已签版本，不本地回退到更早基线。旧侧COMPLETED入口改为查看已完成交接及归档记录，仍沿原handover ID只读进入，不重复确认/签署或新建旧侧事实。

新增3项行为回归均先红后绿，B2专项16/16，全包140/140；build90文件/16WXML17WXSS；Mock109文件×2零差异。离线版面增加新恢复版本待确认、拒绝后最近已签版本两状态，最终记录见vehicle-change-layout/report.json。此收尾仅root apps/miniprogram；隔离native0a4f378源码/产物未改，无git提交、DB/业务网络/真实渠道/SDK/二维码/预览上传。原生签署恢复合并由主控接续，当前root包仍保留其H5基线接线，不冒称已集成native。

收尾版面最后生成16/16、16PNG，零溢出/JS异常/外部请求；已目视新恢复待确认与恢复最近已签版两张长页，已完成旧侧只读、无新侧时明确尚待准备。
