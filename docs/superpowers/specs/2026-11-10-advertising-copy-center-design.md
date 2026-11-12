# 产品中心「广告词」管理

## 授权与目标

任务 brief：用户要求在产品中心增加「广告词」，自行编辑并发布首页、选车页顶部的本地 12 组大小字。沿用 AGENTS.md 已授权的计划后直接施工。以现有 12 组电影气质文案为初始内容，不改原样副本，不访问旧库，不混入其他未发布业务改动。

本轮目标是完成后台编辑、数据库保存、发布接口和小程序读取已发布内容的闭环。未来文案发布无需重新上传小程序；首次增加远端读取仍需要新版小程序。是否实际部署、上传及平台切换必须按真实结果分别记录。

## 产品行为与界面

产品中心增加独立二级入口「广告词」，路径 `#advertising-copy`。仅 ADMIN / OPERATIONS 可读写，使用独立 `advertising-copy.read/write` 权限。

固定 12 个位置，不新增/删除/停用或加权。每组有固定 id（不可编辑）、共用主标题、首页小字第一行/第二行、选车页小字。保留原主标题样式，主标题最多 9 个 Unicode 字符；首页每行最多 32 字，选车页小字最多 40 字；纯文本、非空、去首尾空格，不接受换行和控制字符。

页面顶部展示「已发布 vN」「草稿待发布/与已发布一致」及最后发布时间；左侧 12 组标题列表，选中后编辑右侧四个字段；下方并列展示首页卡片与选车页预览。保存与发布按钮独立：

- 保存草稿：将整套 12 组存入后台，不改变小程序展示。
- 发布：先保存，再核对已保存的草稿；有未保存输入时禁止发布。确认面板显示即将发布的 12 组标题，提交当前 revision 与草稿内容摘要，整套原子生效。
- 冲突保留输入，提示重新读取并由操作者核对；不静默换版本重提。
- 未知写入结果保留原请求体/幂等键，可按原命令重试。收到成功响应后 GET 失败，仅重试 GET，不重复写入。切换模块后可回来核对；会话/岗位/权限变化或 401/403 清除待提交状态。普通刷新不能丢弃未知写入。

复核后的实现约定：待核对的广告词请求（不含凭据）连同已成功/未知阶段保存到 sessionStorage，以当前用户、岗位、权限和 CSRF 的 SHA-256 摘要绑定会话（不保存原始 CSRF）。浏览器刷新后仍可核对原操作；会话不同则清除。页面加载先完成该绑定，随后才启用操作。既有通用待提交 Map 保持原行为，本模块命令自行持久化；存储失败在发起新写入前明确报错。

不扩展成营销活动、轮播图、图片或定时投放系统。固定业务提示、费用、审核、车辆与订单规则不在此模块编辑。

## 数据与首次内容

新增两张独立表：

- `AdvertisingCopySet`：单例 `id='discovery'`，`revision`，`draftItems` JSON，`draftHash`，`updatedBy/updatedAt`，当前 `publishedVersionId`。
- `AdvertisingCopyPublication`：不可变发布记录，`id`，递增唯一 `version`，`items` JSON，`contentHash`，`publishedBy/publishedAt`。

迁移以当前已批准的本地 12 组初始化首个发布版本 v1 和同内容草稿，标记 `publishedBy/updatedBy='SYSTEM_MIGRATION'`，不冒充人工操作。初始内容来源逐字来自当前 `apps/miniprogram/src/utils/subscription-copy.js`。迁移外不在 GET 时偷偷建记录；未初始化或已损坏数据返回明确不可用。

每次保存/发布在 `Db.serial` 中重新校验当前员工岗位和 authVersion，条件更新 revision，使用已有 `ProductCommand` 表但专用 resourceId/action 命名空间保存幂等回执，并写 AuditLog。角色变更后不能靠旧 actor 重放命令；同键异参 409；重复请求返回原回执；发布记录、当前指针、revision、审计、命令回执同事务。

复用的是 ProductCommand 存储，不调用会硬编码 `products` 权限的 productCommand() 包装器。摘要采用 Zod 解析并 trim 后、按固定位置以及固定 id/title/lines/catalogDescription 属性顺序的 JSON.stringify(items) 做 SHA-256；迁移冻结同一 JSON 字面值与摘要。每个发布版本分配与单例 revision 条件更新必须处于同一事务。

## API 契约

所有对象拒绝未知字段。`items` 恰好 12 组，id 和顺序必须匹配初始 12 个位置，每组 `{id,title,lines:[string,string],catalogDescription}`。

- `GET /api/admin/advertising-copy` → `{id:'discovery',revision,draft:{items,contentHash,updatedAt,updatedBy},published:{version,items,contentHash,publishedAt,publishedBy},history:[{version,contentHash,publishedAt,publishedBy}]}`。history 最近 10 条；后台本来即 private/no-store。
- `PATCH /api/admin/advertising-copy/draft`，body `{revision,items,idempotencyKey}` → `{id:'discovery',revision,draftHash,publishedVersion}`。
- `POST /api/admin/advertising-copy/publish`，body `{revision,draftHash,idempotencyKey}` → `{id:'discovery',revision,version,contentHash}`。
- `GET /api/admin/advertising-copy/commands/:action/:key`：action 仅 `SAVE_DRAFT/PUBLISH`，key 为原幂等键。事务内重新校验当前员工的读写资格后，只查询当前 actor + advertising-copy:discovery + action + key。明确不存在返回 `{found:false}`；存在返回 `{found:true,requestHash,result}`（result 为原命令回执），不含其他员工命令。无写入/审计副作用。
- `GET /api/public/advertising-copy` → `{version,contentHash,publishedAt,items}`，`Cache-Control:no-store`；只投影当前已发布快照，不含草稿、操作者或历史。

发布时验证 hash 与当前草稿一致；当前草稿与现有发布 hash 相同返回 409 `ADVERTISING_COPY_UNCHANGED`。revision 不符为 409 `REVISION_CONFLICT`，摘要不符为 409 `DRAFT_CHANGED`。

复核补充：恢复 unknown 命令时先 GET 原命令回执，并以规范化原 body 的 SHA-256 核对 requestHash；存在且匹配才进入 GET-only，权威 `found:false` 才按原 body/key 重放；网络失败、畸形/模糊响应保持阻断，摘要不符进入冲突。这样即便成功响应后的 sessionStorage 写入/清除全部失败，也不会在重载后因旧 unknown 记录再次提交已记录的命令。不得将超时或普通 404 当作明确不存在。

保存中离开再返回的 UI 回读不能依赖已经卸载的页面闭包：新页面必须接收命令完成后的可信回读或主动重新 GET，未核对最新状态前不能解锁编辑/发布。恢复提示必须反映实际的保存或发布操作。

## 小程序读取

新增匿名公开读取，不带客户凭据、不依赖登录。首页/选车页 onShow、下拉刷新、手动重试时读取已发布整套；搜索/品牌筛选不换文案、不额外请求文案。保留原样式与排除上一组的轮换规则，发布后仅在下一次进入/刷新切换，不在阅读途中自动跳字。

远端响应须严格校验版本、hash 格式、12 组位置和字段长度。只缓存校验通过的发布快照（内存），较晚到达的旧版本不覆盖新版本。请求超时最多 4 秒；文案网络异常不能阻断真实车辆目录，继续使用最近成功读取的发布快照，首次尚无快照时保留随包的初始正式文案。这是原有真实品牌文案，不是 Mock 车辆/业务结果；任何车辆/业务接口失败仍显示原错误。未发布草稿不进入客户端。

`nextSubscriptionCopy(currentId, items?)` 只从当前有效集合选择；若当前 id 已移除也返回有效组。页面 `load` 的请求/会话版本保护继续适用，旧刷新结果不得覆盖新页面。对运营输入的长连续字符增加小字换行保护，不改字体和卡片视觉。

## 方案取舍

采用独立文案草稿 + 不可变发布快照：后台可安全编辑，整套一次发布，有版本与审计。直接修改前端文件仍需重新上传，不满足用户自行发布；复用法律文书会混淆正式协议的确认流程；通用 CMS 或新增图片活动超出本轮范围。

## 验收

API：隔离的新项目测试库，真实 App HTTP + DB 验证匿名仅见发布、草稿隔离、角色/CSRF/当前员工校验、非法输入、版本冲突、同键重放/异参、并发保存/发布、版本与审计一致。绝不连接旧业务库。

后台：编辑 12 组、两种预览、保存回读、确认发布、未保存限制、冲突保留、未知命令原体重试、成功后 GET-only、跨路由及换账号清理；常见桌面与窄屏无溢出。

小程序：匿名读取、超时/失败沿用正式文案、拒绝畸形远端、旧版本迟到不倒退、发布内容驱动两页且刷新排除上一组，筛选不换字；实际模板编译与 320/390/430px 排版检查。浏览器不替代微信真机验收。
