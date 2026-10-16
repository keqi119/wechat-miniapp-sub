# B1 后台交车延期实现与本地验证

2026-10-16。依据主控批准`apps/api/phase-b-design.md`与API实现同事最终DTO，仅修改`apps/admin`。新增独立delay模块与局部样式/测试，App/resources/esign作必要入口集成；A阶段usage/credit规则及其测试未改。未提交、部署、调用生产、数据库或真实支付/签署。

订单详情从独立delivery-delay-context读取订单revision、原termsHash、月数/原服务日期/押金、逐期原Bill与可信净实收、canCreate与具体阻断；不自行推算余额。仅OPS/ADMIN且write权限和canCreate=true能建立真实延期草案。草案只提交服务器版本/哈希、理由和稳定key；表单内显示错误，不伪造成功跳转。

新增交车延期模块支持列表、分页/状态/变更编号筛选、详情、版本历史与专用逐期报价表单。新起租日与每期dueDate/整数分amount/calculationBasis及完整延期/资金/交接/取消安排均明确提交；金额精确换算，0元须明确逐期依据，不生成负数金额。原月数、车辆和押金不提供编辑，新服务日期和carry/charge/refund摘要只显示服务端回读。每期[start,end)标注截止日不含，总newEndDate/context.endDate标注最后服务日含。无原账单的期不生成null链接。

动作按服务端can能力与角色双重守门：运营报价/发布/签前准备/apply/cancel，财务review/prepare-finance；复核拒绝报价创建人本人。每次打开表单生成稳定请求key，重试保留，提交带change.revision；不发送status、已签、已付、手工余额等任意覆盖。缺能力、未知动作、未知kind均关闭，B1不操作VEHICLE_CHANGE。

详情保留客户主动确认时间及等待状态、完整逐期报价、报价商业hash、固定批准正文id/type/version/hash/bodyHash/templateHash/content及历史版本摘要。资金卡展示服务端新服务义务/原款分配/真实补款Bill和退款申请/渠道状态/阻断；准备资金只创建真实安排，退款仍走已有不同财务审批，不直接标退款成功。AMENDMENT具有单独签署策略、冻结PDF与归档链接；prepare跳既有双人审批，不代客确认或签署。主合同旧send/prepare/status动作对AMENDMENT隐藏，原订阅/交接行为保留。新增delivery-delay-amendment法律类型选项，但不生成、批准或发布文案。

TDD新增9项回归，先观察失败再实现：订单版本/条款绑定、逐期完整输入/日期/精确分、角色/能力/非本人、稳定幂等且忽略任意覆盖、安全白名单、AMENDMENT独立策略且旧动作不可用、固定批准正文/显式0费用，以及系统范围外赔付必须显式选择、报价未来期限/北京时间/summary白名单/确认后期限独立。全后台56/56测试通过，TypeScript/Vite构建通过；最终bundle index-EA22VEya.js，JS362.15kB/gzip112.75kB，CSS28.24kB/gzip6.99kB。

`scripts/qa-delay-ui.mjs`使用本机Chrome、隔离会话和显著标注的QA fixture，拦截全部/api请求，无凭据、数据库、供应商或实际业务调用。8组检查通过：OPS/FINANCE/SUPPORT动作分别守门、无代客入口、逐期金额和版本、409错误无假成功/重试同key、390px无横向溢出、订单入口仅一层modal且绑定原context、无null账单链接；pageErrors=0。证据为`delay-browser-fixtures.json`与`delay-mobile-form.png`。初次QA未起Vite导致connection refused，已起本地dev；另一次发现脚本在详情数据到达前断言按钮，已改为等待具体已读取报价内容，不改变产品能力逻辑。

限制：API同事仍在实现/回归B1真实资金与签署衔接。追加root批准的externalCompensationRequired：报价必填选择默认空，空不能发送；true由服务端MANUAL_FINANCE_REQUIRED阻止，表单内容保留、不生成可签报价，不构成权利放弃。资金入口复用canPrepareFinance以恢复确定失败/被拒的退款，未知/处理中不另起第二笔。当前FINANCE/SUPPORT正文缺失按权限说明展示，历史只返回四字段摘要时不渲染不存在日期/金额。浏览器已覆盖上述边界。

本轮没有执行该模块的真实HTTP草案→报价→财务→客户确认→签署→生效闭环，不将隔离浏览器结果称为后端端到端或真实供应商验收。正式模板未批准发布、客户未确认、签署/资金未知时仍展示真实等待/阻断。B2/B3入口未加入，没有免费换车或付款假状态。


最终追加expiresAt：新报价默认空、显式必填未来北京时间（日期时分）转ISO，不设任意天数限制；列表只读quoteSummary并展示确认截止，详情保留该版本expiresAt/hash。未确认过期的publish入口关闭且提交再校验，运营依server canQuote重出版本并重审；客户已确认后签署/资金不受报价期限影响，印章计划期限另计。隔离浏览器新增验证默认空、精确UTC换算、过期不得发布而可重出、confirmed后prepare仍可用；pageErrors=0。产品与报告再次冻结，无共享DB或生产操作。
