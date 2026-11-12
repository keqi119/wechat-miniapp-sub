# V3.1 Task3 渲染与准备接入

`freezeV31Preparation(tx, {kind,resourceId,revision,businessHash})` 调用 Task2 公开上下文解析器，要求 missing 为空，冻结 snapshot/hash/context。客户端不提供 owner/customer/product 任意主体字段。`resolveV31RenderSnapshot` 是私有服务端渲染适配器，只在授权准备流程读取原有实名与对公账户；明文证件号和银行账号不写入通用 task/scope JSON。

新准备支持 SUBSCRIPTION、COOPERATION；明确拒绝未接入独立真实来源的后续种类。冻结内容在 ArchiveVersion.scopeSnapshot.v31Sources；新准备键复用旧任务前比较同一来源哈希。相同幂等键仍按原命令重放。START/新 UPLOAD/新 SIGN 以及接受授权时重新检查当前来源、批准模板版本/内容；查询、结果记录、文件下载和撤回不受新增实时资料检查阻断。

私有渲染正文只在内存及受保护PDF中保留；Contract.body 保存 PRIVATE_ELECTRONIC_PDF 引用（archiveVersionId/sourceFileId/sourceSha256/bodyHash），其中 bodyHash 仍为完整实际渲染正文的 canonicalHash，并同时固定在 ArchiveVersion.scopeSnapshot。通用后台合同列表/详情对 executionMode=ELECTRONIC 的所有记录不返回 body，包括历史已存有私有渲染正文的行；通过原授权文件入口查看完整PDF，权限不变。

合作 v31Sources 新增可选草稿字段 `productDepositRules: Array<{productVersionId,rule}>`。若填写，须唯一且完整覆盖 productVersionIds；未填写允许保存草稿，但准备02失败。rule 为 `{kind:'CREDIT_POLICY',policyVersion:'ZHIMA_MANUAL_V1'}` 或 `{kind:'FIXED',amount:<整数分>}`，无默认推断。前者由服务端冻结 GE750=0、B700_749=1、B650_699=2 倍约定月费和不合格档规则；后者代表明确协商的固定押金。其余月费组成/期限/里程/换车/BaaS来自已确认产品版本，不开放任意文本价费编辑。

templateRefs 必须指向已确认启用、结构完整的 ELECTRONIC_V31_SUBSCRIPTION，冻结 id/type/title/version/hash/content 全部内容。合作正文和授权 PDF 携带可阅读的完整固定01正文附件与精确源字节；哈希使用已有 common/data.hash 语义，原始字节 SHA256另行标识。01正文实际逐单值仍在订单准备时从真实数据生成。

后续任务边界：

- Task6：现有 ElectronicSigningTask.cooperationVersionId 唯一约束只能绑定一个主合作任务，不能拿主任务冒充独立授权。须设计独立 grant 绑定/唯一约束、授权状态、撤销范围和生效校验；复制同一冻结的完整01内容和主协议编号/摘要/附件一事实（含实际例外），提供 buildV31Document 的 grantReference/fixedTemplates。实际订阅押金必须符合合作所授权产品规则。当前 grant prepare 明确不支持。
- Tasks5–8：为换车、续期、交前取消、提前终止提供具体业务上下文及服务端真实渲染快照，再打开准备入口；不可直接接受客户端 render snapshot。
- Task10：维护显式产品押金规则和缺失来源导航，并在移动端预览完整签署 PDF；无需桌面附件查看器才能阅读01授权固定内容。
- Task4：继续提供签署证据、停止后证据捕获与独立授权证据类型。本任务不改造整个证据生命周期。

兼容限制：新01/02必须使用 V3.1 模板及含基础费/里程费/换车规则的已确认 v2 产品。订单月费若与冻结产品组成不同，须先建立真实调整后组成来源，本任务拒绝猜测。历史正文渲染保留，但新准备不会回退旧通用模板。
