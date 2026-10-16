# 技术签署验收后台实施与冻结报告

2026-10-16；基线 fdaff1a，Task 2 完成。仅 apps/admin。源码及专用产物已验证冻结，**未提交，等待主控 Git 窗口；未推送、未部署，未操作真实供应商**。本地 HTTP 使用独立数据库和法大大内存替身，不代表真实电子签署验收已完成；生产本人确认及实际企业用印仍须本人操作。

## 已实现

- 独立“签署技术验收”列表、筛选、创建和详情；ADMIN/OPERATIONS可见，FINANCE/SUPPORT无权。创建只提交现有 customerId、已批准发布的 technical-signing-verification documentId和稳定请求键，无商业订单、任意正文或金额。
- 冻结完整正文、模板/正文/业务文档/PDF字节hash、原PDF及签后PDF、本人逐份确认、真实签署/归档事实。revision显示“记录版本”，document.version单列“模板文案版本”。后台不代客户确认、接受协议或签署。
- 本人确认且safe能力允许后，按TECHNICAL_ACCEPTANCE策略申请本份用印计划，跳实际approval；另一实际授权人员独立审批。回链指向本份独立文件，无商业合同路由污染。planHash原样保留既有sha256:64hex，未截前缀或以裸hex正则拒绝，真实浏览器审批201已验证。
- 停止请求记录本地停止时间，阻止新签署/准备；在途/迟到签署及归档事实仍按服务端核实，不宣称供应商撤销成功。PURGED且历史SIGNED显示“保留历史双方签署事实；独立文件已清理”，不伪报归档失败。
- 180天到期状态及必要留存可见。仅ADMIN按safe.canReviewRetention明确选择留存或审核释放，默认空，不继承已有legalHold=false。独立safe.canPurge才开放实际清理，理由与操作确认必填，只清本验证独立资料，不删共用实名、证书或授权。
- safe白名单不展示证件、供应商原文或短URL，无新增正文/PDF/签署URL持久缓存。一般协议未就绪只说明等待本人更新。
- 409只重新GET独立记录/创建列表，保留原请求键和表单版本，不自动重写新版。交叉审查复现的P2旧A回读覆盖B/旧成功跳审批已TDD修复：资源、记录、表单generation及卸载守门，POST/回读前后和反馈前核对；离开/关闭原记录后旧响应失效。

## 最终验证

- 技术专项11项红绿，完整后台 **94/94**，typecheck与专用Vite生产构建通过。
- 最终命令结果保存于technical-acceptance-verification-log.json：记录原工具stdout的成功退出码、94项测试摘要及完整构建输出；测试完整未截断stdout当时未单独tee，已明确标记，未为补日志重跑验证。
- 开发态15组浏览器fixture、2组实际Chrome Promise交错，以及最终生产bundle15组同等场景均通过，0页面错误，390px无横向溢出；截图已目视核对。旧B3 11组隔离回归通过；未运行真实渠道。
- `technical-acceptance-browser-fixtures.json`、`technical-acceptance-browser-races.json`、`technical-acceptance-production-fixtures.json`明确区分合成拦截；生产mobile截图为实际冻结bundle。现有公共sessionGeneration三项交错随94全测通过。
- `scripts/qa-technical-acceptance-http.mjs`真实HTTP共 **7组通过，0页面错误**：根持有127.0.0.1:3191，数据库technical_signing_ui_acceptance；前端3190，不拦截API。随机凭据仅从ignored运行文件读取，令牌/密码/手机号不输出或保存到证据。
- ADMIN浏览器实际创建本份文件，读冻结全文和PDF，实际字节SHA等于sourcePdfHash；确认前没有申请入口。下一合成privacy经真实本地API发布，仅供客户本人显式更新一般同意，不由后台接受客户同意。
- 客户本人客户端检测旧一般同意，主动更新后逐份确认；OPS浏览器真实prepare、另一ADMIN浏览器真实approve，申请人不能自审，正文hash不变、签署仍DRAFT。admin safe.canSign=false是安全角色投影，只有本人可签。
- 本人主动sign（只捕获本地导航，不打开synthetic URL）、被动GET不伪完成，显式sync后后台真实读双方SIGNED及归档PDF。本人stop后后台回读status=STOPPED、signatureStatus=SIGNED、stoppedAt及signedFileId保留，canPrepare/canSign=false。另一独立客户文件由ADMIN浏览器实际stop，仍DRAFT、无假签后文件。
- 独立到期夹具由API真实create/stop后仅提前测试retentionDueAt；ADMIN明确审核释放再实际purge，原PDF GET404。共用客户实名VERIFIED/证书绑定保留；OPS无清理入口，FINANCE/SUPPORT独立资源403且不能读取主PDF。无本技术流程订单、费用、支付、信用、库存或权益变更。
- `technical-acceptance-real-http.json/png`保存上述安全证据，只有角色、请求路径和状态，没有正文、验证码、凭据或供应商响应。小程序作者本人HTTP证据 `apps/miniprogram/evidence/technical-acceptance-http/customer.json`另覆盖本人/越权PDF及停止后不能重签。
- 实际HTTP发现客户端误用裸hex验证既有sha256:64hex planHash，作者定点红绿修复，沿原已确认/双审文件继续，未重建或重审批。后台脚本曾误断言admin可签，已修为false并只回读既有批准。服务进程结束造成的连接拒绝阶段没有技术写，根接管服务后新seed重登录成功；这些失败不计为已通过场景。
- 原生只读交叉审查发现onShow旧GET可覆盖较新CONFIRMED POST，作者红绿修正。独立VM复跑原顺序已保持rev2/只一次被动GET；最终原生32专项我独立重跑通过，含canonical planHash、终态URL清理与停止。本轮未改原生目录，当前无未解决的明确P1/P2前端阻断。

## 冻结产物和算法

**唯一最终目录：apps/admin/qa/technical-acceptance-build/dist**。不要使用旧apps/admin/dist。上层 `artifact-manifest.json` 按主控固定schema生成，含apiBaseUrl/sourceHash/sourceFiles/files，已另独立重算每个源码及产物hash/bytes并通过。

生产API：https://mini-api.subauto.keybox.cloud/api。实际运行该bundle，拦截网络确认auth/me与auth/login精确此目标且credentials:include，0错误，无3191；证据technical-acceptance-api-target.json。该验证没有发生产请求。

sourceFiles为46项：apps/admin/src全部文件，apps/admin/index.html、package.json、tsconfig.json、vite.config.ts和仓库pnpm-lock.yaml。path从仓库根开始，使用正斜杠，按path字典序排序；每个sha256为原始文件字节摘要。**sourceHash=SHA256(UTF-8 JSON.stringify(sourceFiles))**，紧凑JSON无额外空白，每项字段顺序path、sha256。该算法独立于Git提交SHA，不包含ignored凭据或生成物。

sourceHash：`13862cf86eb46590d83cec19e7d5265bb01a196defc9c4747cdb9cb4519a0156`

| 相对dist路径 | bytes | SHA256 |
| --- | ---: | --- |
| index.html | 498 | f926c5451c84291fbf2a7801d67279a9dff3c148b36bb6ee1b45e584fba05c79 |
| assets/index-DgJ-haOG.js | 445448 | 4d410febc2f70aa29c2e07ab14c1db2a0afe145ca3b8273c952f2a93cee7f0af |
| assets/index-BR69LfsS.css | 29200 | dccaa858baec95d6bf47f0500ddb94335281b95727ccf4692812c12e37db1d66 |

manifest包含dist全部3个文件，入口引用匹配。源码和产物均冻结待主控窗口提交/发布；真实本人签署、真实企业用印及供应商归档未在本地替身验收中发生，不宣称真实渠道已通过。

## 单列：误用旧治理脚本，不计本次验收

曾错误启动旧 `qa-governance.mjs` 作既有审批回归。该脚本在登录前含开发库 seed，目标已只读审计确认为本项目 `127.0.0.1:55432/chundian_dev`，不是生产、旧业务库或共享 chundian_test。操作锚 UTC 2026-10-16 13:34:02.685。

本次新增临时 customerSession 1条（createdAt 13:34:02.532、expiresAt 14:34:02.530）；经主控明确授权，固定本地目标和 customerId/createdAt/expiresAt 精确 WHERE，事务 count 恰1才删除，实际删除1条，没有读取/输出凭据。旧 QA reviewer 已存在，其密码 hash、FINANCE角色和 active 被脚本 upsert 覆盖；旧 QA 车辆 IN_USE/reservedOrderId 被写入。旧 QA plan/application/order 均早于本次存在，order.updatedAt 未变，没有本次新建商业订单。因旧值未知，未回填 reviewer 或车辆。

随后旧脚本本地 bootstrap 登录断言失败，尚未进入印章、费用、交接或渠道操作；已停止且不再执行。只恢复本次写坏的已跟踪 governance-result 到 HEAD，删除本次新建失败截图；执行前两者没有用户未提交变动。此失败和其 seed 不属于技术验收证据，不以名称清理其他数据库记录。
