# 技术签署验收独立代码审阅

日期：2026-10-16。审阅基线 `fdaff1a`，最终核对根 HEAD `156cec44e92d2229b76ebad669a0e6a5ac734e1b`，API已由主控提交，后台/小程序仍为未提交工作区。第一轮发现及第二轮修复核验均记录于本文；末尾SHA标识本轮实际审阅源码。

**最终代码审阅结论：通过，可冻结当前源码；没有剩余的本轮代码阻断项。** 原P1停止竞争、P2归档副本清理、迁移误删外键均已修复并独立复核，后台/原生迟到响应与旧签署入口修复也已核对。最终本地HTTP发现的原生planHash格式差异已完成定点复核，32项专项通过，未放宽其他校验。生产执行须由主控收齐最终前后端HTTP联调、构建和产物SHA证据后统一进行；本结论不表示已部署、已开启渠道或真实双方签署通过。正式签署、支付继续关闭；本人确认、实际签署及逐份企业用印由实际人员操作，本文本批准不授权代理代办。

## 范围和方法

- 读过 AGENTS、独立平台方案、技术签署实施计划、API 契约及批准文件；审阅 technical-acceptance/service、signing、retention、rules、PDF、controller，gateway/callback、签署审批、lease、文件ACL、RBAC、schema/019迁移及两前端接口适配。
- 审阅根提交中的 `deploy/prepare-technical-config.py`、`deploy/activate-technical-release.sh`、`scripts/publish-approved-technical-signing-legal.mjs`，包括其调用的 activate-release 路径。
- 第一轮未连接数据库；第二轮仅只读连接作者新建的两个独立迁移测试库，事务明确设置 `SET TRANSACTION READ ONLY`。未访问旧库、生产或真实供应商；未运行会改写固定技术测试库的 API 夹具。除本报告外未写入项目文件，未提交、推送、部署。
- API 边界复测直接加载实际 `FadadaESignGateway`，仅使用内存数据库和供应商 stub；PowerShell here-string 经 stdin 交给 `node --import tsx --input-type=module`，设置 `TSX_DISABLE_CACHE=1`。未保存临时脚本或凭据。

## 已确认的实现优点

- 独立资源及独立默认关闭开关，未借用商业订单；API 绑定持久 customerId，创建不接收任意正文、身份或金额。
- 冻结正文及模板哈希、PDF哈希分离；本人确认包含三个文档摘要和独立信息处理同意，一般协议过期要求走现有明确同意流程。
- 审批沿用实际两个人、有效权限及计划/源PDF绑定；签署结果核对双方 provider 身份，技术 SIGNED 还要求任务真实双方签署证据、签后文件归属、字节及哈希核验。
- GET sign-status 只读本地，主动 sync 才查询；STOPPED 与历史 signatureStatus 分开，停止后迟到归档不被伪称撤销。
- 客户文件ACL以及 ADMIN/OPERATIONS 文件范围有明确检查；前端短URL只在内存，并有客户、token、会话代际及过时响应校验。
- 180天清理实现人工到期复核、争议保留、在途/lease守门；删除独立任务、审批、非PURGE动作，清空正文、专项同意、客户关联及签署坐标；共享实名/证书不删。共享文件ID及同存储路径也有保留检查。
- 发布脚本校验固定独立基线与关闭商业通道、已批准文本SHA和部署版本；发布文案不创建确认或签署。

## 历史问题及最终修复核验

### P1：用印意图提交后，停止成功仍可先于实际用印外呼——已修复

首轮位置：`apps/api/src/esign/fadada/fadada-esign.provider.ts:84`、`:87`、`:88`。最终实现位于同文件`:19-28`、`:96-102`。

在写入 sealRequestedAt 的事务提交后，代码释放验收记录锁，随后 await 审计，再调用 autoSealContract。若客户 stop 在审计等待期间成功提交，或技术开关此时关闭，后续调用不再核对或互斥，因此会在已经停止后新发企业章请求。sealRequestedAt 只是本地意图，尚不能证明请求已经发出。

独立复现：客户已签、平台记录为空、有效双审、技术开关开启。内存 auditLog.create 在 ENTERPRISE_SEAL_EXECUTION 时将 stoppedAt 设为时间并关闭开关，再完成。实际 gateway.query 输出：

```json
{"mode":"stop-after-marker","sealCalls":1,"stoppedBeforeSeal":true,"flagEnabled":false,"archivedCount":1,"referencedArchive":true}
```

最终 `technicalDispatch` 使用独立、不自动重试的 ReadCommitted 事务，持有同一验收记录 `FOR UPDATE` 锁完成最后检查及实际外呼；stop 使用相同行锁。耐久seal marker在此前事务提交，外呼或后续事务失败时保留不确定事实，不能重盖。外呼超时由现有HTTP transport控制，dispatch事务超时至少比请求配置长10秒。上传和签署URL创建也走同一最终门禁。

独立重跑实际gateway并以内存互斥事务重现原交错：仅stop、仅关开关、两者同时在审计等待期间完成，三者均返回PENDING、`newSealCalls=0`且清除未发出marker；外呼先开始时stop等待，后续查询仍只有一次用印；模拟外呼后事务失败，marker保留、查询归档且不自动重试。上传/签署URL最终门禁在停止后调用数也为零。作者另有真实PostgreSQL行锁回归（技术测试`:151-182`），已读取其最终223项日志确认包含这些测试。**本项关闭。**

### P2：归档保存后丢失处理权会遗留独立PDF副本——已修复

最初位置：同 gateway `:94-96`，`apps/api/src/technical-acceptance/retention.ts:18`。

persistPdf 先创建 StoredFile，随后CAS保存 task.signedFileId。若lease在下载/保存期间失效被其他请求接管，CAS抛错但文件没有引用；原清理只收集record/approval/task引用的ID，无法发现这份副本。

独立复现：已有真实用印执行标记且双方查询均为已签；writer.persistPdf 返回后令内存task持有另一lease。输出：

```json
{"mode":"lease-loss","sealCalls":0,"stoppedBeforeSeal":false,"flagEnabled":true,"archivedCount":1,"referencedArchive":false,"failure":"SIGNATURE_LEASE_LOST"}
```

最终 gateway `:110` 增加 finally discardUnreferencedTechnicalFile，并在 retention `:18-19` 将同customer/purpose及记录编号命名的source/signed文件纳入候选，覆盖CAS前进程退出。独立实际gateway复测lease丢失：报SIGNATURE_LEASE_LOST、discard调用一次、未关联副本为零、没有错误SIGNED。独立调用实际retention服务的内存夹具确认崩溃副本进入清理候选、共享记录文件ID与同物理路径的其他元数据保留、独立task/approval/非PURGE action被清理、正文与客户关联清空；未触碰共享实名，也没有磁盘或数据库写入。**本项关闭。**

### P1：019迁移误带删除六个既有购买业务外键——已修复

初审019迁移`:4-20`删除了 SwapCreditPurchase 的 billId、creditId、customerId、orderId、paymentId 和 SwapLedger.purchaseId 外键，且没有重建，与独立技术验收无关。

作者确认自动diff误带，已从尚未上线的019移除六条DROP，并向schema映射已有018关系防止再次误带。当前019不再含DROP，001–018未变。主控提交156cec4前仅规范019/retention/测试的多余EOF空行，没有语义变更，但019字节checksum因此更新；主控重新创建两个空库验证，未改旧证明库或UI库的checksum。审阅者最终独立只读核对 `technical_full_1792160172456_test` 与 `technical_upgrade_1792160172456_test`：各19项迁移完成，019数据库checksum与当前源码 `0f8da11bab0e15606e27ac1f2583e4d6e80209bc41d1cf4ea58d8feb5188305a` 一致，六条业务外键全部存在且validated，更新/删除均为NO ACTION。前者为空库001→019，后者为018→019；本轮没有修改两个数据库。较早1792158646154两库仅为修复过程证明，不作为当前迁移字节证据。**本项关闭。**

### 前端收尾交叉发现——已核对修复

- 后台 `technicalWrite` 与 ResourcePage 使用 `TechnicalViewGuard` 阻止迟到409回读、成功prepare跳转覆盖已切换记录或新表单，详情读取额外核对Abort状态。PURGED+SIGNED明确保留历史签署事实、独立文件已清理，PDF hash单列。
- 原生详情页操作期间不再接受onShow发出的旧GET覆盖，账户/会话代际检查继续生效。原生实际签页reload以fresh canSign及terminal状态丢弃旧短URL；主动sync可信归档后立即forget，批准过期不能重开缓存入口。此轮曾观察作者补充的三个红测，作者完成后独立重跑31/31通过，未将中间红态当最终问题。

### 最终HTTP发现的计划哈希DTO差异——已核对修复

服务端固定来源 `apps/api/src/esign/enterprise-seal/signing-plan-hash.ts` 返回 `sha256:` 加64位十六进制，原生此前误按裸64位判断，导致已批准记录仍不能进入签署。最终 `apps/miniprogram/src/services/technical-acceptance.js:19` 对approval.planHash改用 `^sha256:[a-f0-9]{64}$`（忽略大小写），APPROVED状态、不同请求人与审批人、有效期、确认、源PDF、停止状态及服务端canSign检查继续保留；模板、正文和PDF的裸64位校验没有变更。主要fixture已改为真实DTO格式，新增测试拒绝缺前缀、坏长度、非十六进制及错误算法，且验证不会发出sign请求。独立重跑最终32/32通过。API仅补充契约格式说明，签署计划生成实现未改。**本项关闭。**

独立阅读 `apps/miniprogram/evidence/technical-acceptance-http/customer.json` 及其执行脚本：16项检查包含一般同意更新、本人确认、双审回读、显式sync归档、两个PDF归属与跨客户拒绝、本人stop保留历史签署事实。证据采用两阶段运行：恢复段有24条可审阅HTTP请求，较早13条仅作为明确注明的历史checkpoint；本轮没有独立重发HTTP或把历史checkpoint视作本轮逐条重验。请求连接本地3191、独立UI验收库及合成供应商，原生导航只捕获而未打开供应商URL。source/signed PDF的相同SHA来自合成供应商返回相同PDF字节，可证明本地文件链路及归属，不能证明真实企业签章或真实签后PDF。证据没有声称真实渠道通过，与其执行脚本和检查范围一致。

## 独立执行的验证

| 验证 | 结果 |
| --- | --- |
| `apps/admin`: `node --experimental-strip-types --test src/technical-acceptance.test.ts` | 最终11/11通过，退出0 |
| `apps/miniprogram`: `node --test tests/technical-acceptance.test.cjs` | 最终32/32通过，退出0，包含canonical planHash及非法格式拒绝 |
| `apps/api`: `node --import tsx --test test/technical-pdf.test.ts` | 2/2通过，退出0，无DB/落盘 |
| 根：`python -B -m unittest discover -s deploy -p test_prepare_technical_config.py` | 8/8通过，退出0 |
| 实际gateway内存边界复测 | 第一轮复现P1/P2；最终7组修复场景全部通过，退出0 |
| 实际retention内存服务复测 | 崩溃副本回收、共享资料保护及独立记录匿名化通过，退出0 |
| 两个独立迁移库只读核验 | 各19项迁移完成、019 checksum一致、6条有效业务外键保留，退出0 |
| `git diff --check -- apps/api apps/admin apps/miniprogram` | 已跟踪修改检查退出0，仅CRLF提示；新文件随后由主控暂存检查规范EOF |
| `git show --format= --check 156cec4` | 最终API提交检查退出0，无格式错误 |

最终完整API223/223、0失败、191.9秒：独立读取 `.runtime/technical-final-full-test.log` 末尾及受影响测试，和作者报告一致；本审阅未重新执行其固定测试库。作者报告的generate/build、固定来源15文件及前端完整套件另见各模块报告，本表不将作者执行冒称为审阅者独立执行。主控的PDF三页视觉核对证据为 `docs/evidence/technical-signing-pdf-review.json`，本轮另独立跑过上述2项PDF测试。前端HTTP最终产物、真机与真实双方签署不由这些单位测试替代。

最终审阅源码SHA256（后续变更应重新核对对应结论）：

| 文件 | SHA256 |
| --- | --- |
| gateway | `9e5b7528bd9d4a16c120b193d5155b1688503d6e11930ffcc81e711e4bb94b31` |
| retention | `27ea0922a76fe74e16ecadb09a16ef104d5e14610467bcdc1bea2e8695970ea4` |
| 019 migration | `0f8da11bab0e15606e27ac1f2583e4d6e80209bc41d1cf4ea58d8feb5188305a` |
| PDF renderer | `db20c9f1616df3e77d8d962180f995bba09429a273b0151499ae0aee8d199c87` |
| admin technical-acceptance.ts | `2852b8670a77efdd3c43c49e832d467c6cf7452bece9b1df8399376f29ed94cf` |
| admin App.tsx | `51fc947b6a294a737199e43837f0da31b3b864af583486191388b3d2680cf185` |
| native pages/sign/index.js | `dcf8493a92f4e7e86ac6917acc2afb86d7e0f15497f5300a502f045b55f34217` |
| native services/technical-acceptance.js | `43aac6a67c49ca5224742536e58e15bb310b0f521b5da3ddb9a01539f16f3289` |
| native pages/technical-acceptance/index.js | `40f7b31d94d8a185fdfdf71208828518040096066615e5837d785ee10fdc0c23` |
| native technical acceptance fixture | `4fefe3a99fd9c0ecda17140162b6df80c9e3d44da001904716e2693663fa1ea0` |
| native tests/technical-acceptance.test.cjs | `73a2f3b17ba844c9e988cd39eb7547abc0a974b200a9fbc2cbbcd0ccf4038269` |
| native evidence/technical-acceptance-http/customer.json | `adb7bef7950af9dde1762ff8e32c28bc246622a64ec14dc549fffa6ca463f05b` |
| API technical-acceptance-contract.md | `9105c5107a60470f98fd334ca2d6e33fb1ba6c2d8a3abed7b2503e6f016569ab` |

## 未作结论的范围

- 法大大真实账号权限、本人签署、真实企业章及真实签后PDF：需要实际人员在已批准范围操作，本轮没有授权或调用。
- 生产备份恢复、迁移、部署和开启记录范围：由主控最终冻结后统一执行，本轮仅审代码及只读测试库证据。
- 安全审计日志仍保留必要操作者/资源/摘要，未宣称清理会删除所有历史审计或供应商独立留存；需要遵循既有留存治理。
- 真机页面、后台最终HTTP及最终构建产物：由主控收齐各作者证据。原生本地HTTP证据已按上述范围核对，不能代替真机和真实渠道验收。

最终判断仅针对上述已复核代码：允许冻结；首轮阻断已全部关闭。发布门禁、真实参与者操作和真实双签归档仍保持独立，未完成前不得宣称真实电子签署验收通过。

## 发布执行助手补充复核

最终源码冻结后，审阅者另只读核对主控的发布准备助手：唯一已实名客户选择、准备技术策略及一份待确认文件、源PDF读取和产物/公网摘要核对。未发现代本人同意、代逐份申请/批准用印或代签章调用。发现打包助手只比较小程序产物与自身清单、没有绑定当前源码的P2门禁缺口；主控补充当前src完整文件集/逐文件SHA、project.config.json SHA及符号链接拒绝，审阅者再次只读复核关闭。随后真实打包通过这些检查，官方CLI预览后再次核对同一冻结清单和配置摘要，源文件及包未变化。相关生产及预览结果分别记录于 `technical-signing-production-release.json` 和 `technical-signing-miniapp-preview.json`；不把部署成功视作真实双方签署成功。
