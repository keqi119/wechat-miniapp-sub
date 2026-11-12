# 客户合同详情与签署进度

用户已要求直接优化当前小程序合同页，并补充个人签署后缺少进度提示。沿用项目直接施工授权，本轮更新已上线电子签流程的客户展示，不切换其他线程的线下签约规划。

根因：合同详情沿用通用记录页，DRAFT/PENDING 映射为待发布/待处理，重复显示编号；订单和首页也仅用 Contract.status 推断准备阶段。实际 OwnerSigningTask 已记录 PDF 复核及双方可信签署证据，尚未用于客户展示。

采用服务端统一只读合同投影，加小程序独立合同详情分支。只改静态名称无法区分客户已签和归档，故不采用；新建独立路由会增加迁移链接，本期保留原合同详情地址。用户已指定突出信息、清楚步骤和常规操作位置，具体布局由实现确定。

首屏显示当前阶段、下一位操作人说明、车辆及冻结的月费/押金/期限/起止日期、实际出租方。中间显示精简签署进度和双方状态；合同原文与签后归档命名区分。合同编号仅底部一处，时间使用北京时间。底部固定合同全文和签署合同；已核实客户签署后不再提供客户签署操作，显示等待车主；已尝试但未知结果显示核验中，只能查询，可信未签结果才允许继续原交易。点击反馈使用浮窗，保留区块中的持续业务状态。

阶段由已保存的复核、双方签署及归档证据决定：PREPARING、REVIEWING、READY_TO_SIGN、VERIFYING、WAITING_OWNER、ARCHIVING、ARCHIVED、REJECTED、EXPIRED、CANCELLED。名称依次表达合同准备中、合同复核中、待您签署、签署结果核验中、等待车主签署、双方已签待归档、已签署归档等。原始状态不作动作授权。

合同列表、详情、订单关联合同和首页下一步采用同一阶段逻辑。客户实名、归属、文件权限、原签署入口和回调校验保持。读详情不访问供应商；用户主动刷新时才调用既有查询，再读取新投影。查询不得自动派发用印。对缺失/未知 DTO、串单文件、未知状态关闭签署操作；金额零和一分准确保留。

兼容旧平台合同，不能将 OWNER 任务缺失错误降级到平台签署；补充协议保留原订单变更入口。原样 Mock、后台、法人 H5、真实签署业务状态和文案正文不修改。无数据库迁移，不代用户签署/支付。本轮只部署新 API 展示及上传小程序 1.0.7。

接口 contractDetail v1：contractId、orderId、kind、status、phase、phaseText、guidance、vehicle:{title}、lessor:{name}、summaryRows:[{label,value}]、parties:[{role,label,name,status,statusText}]、progress:[{id,title,state:DONE|CURRENT|PENDING|STOPPED}]、documents:[{id,kind:SOURCE|SIGNED,title}]、canSign、canQuery、primaryAction:{id:sign|query,label}|null、createdAtText、updatedAtText、templateVersion。所有字段须是安全投影；未提供数据明确标缺，不虚构。
