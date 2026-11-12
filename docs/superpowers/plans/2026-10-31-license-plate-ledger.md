# 牌照备案与车辆绑定历史实施计划

日期：2026-10-31。依据已授权的车辆资产设计，首版只做牌照资料、归属和绑定，不新增牌照收费或外部授权。

## 数据与权限

根新增 LicensePlate、PlateOwnershipPeriod、PlateVehicleBinding，扩展 AssetPrivateFile 的 PLATE 专用映射。LicensePlate保存原展示号码与唯一规范号码、类型、地区、状态、revision和操作人。归属/绑定各自独立期间与版本，当前有效期间用 validUntil=null 表示；历史不可改写，仅允许结束一次并记录结束人/原因。证据冻结为本牌照专用文件ID及元数据摘要。

ADMIN/OPERATIONS具license-plates读写；财务/SUPPORT/FIELD/合作商不因此获得牌照证据或所有权资料。归属ownerId引用现有个人/企业VehicleOwner备案，不创建客户、合作协议、H5授权或分润。

## A 独占后端

完成独立审阅后由root发出开始授权。仅新 `apps/api/src/license-plates/` 与对应测试；`vehicles/commands.ts` 的车牌入口保护及其必要fixture另明确授权。不得改root schema/files/注册，也不改C正在写的App/nav。

- [x] 严格DTO及规范化：号码trim/NFKC/大写且去空白，展示清晰；类型明确填写，不从号码猜归属。禁止控制字符、空或过长号码。region和notes选填。新建revision0/key，修改只改类型/地区/备注且带revision/key；已登记号码不普通PATCH改号，避免历史实体换身份。
- [x] 标准GET/POST `/admin/license-plates`、GET/PATCH `/:id`。详情返回本牌照当前归属、绑定及不可变历史、最小车辆/合作方身份和本牌照专用附件；不返回客户或订单。筛选号码/status，分页≤100。
- [x] POST `/:id/ownership`：plate revision、ownerId、ownerRevision、当前ownershipPeriodId/revision（无当前则显式null）、reason、fileIds、key；取当前staff→牌照→合作商锁，核对非SUSPENDED主体和本牌照文件。确认时刻结束原归属并新建一期，历史内容不变。归属变更不移动车辆。相同owner可要求不要重复登记；不以同手机号或车辆合作方代替显式ownerId。
- [x] POST `/:id/bind`：明确目标vehicleId/vehicleRevision、当前旧绑定id/revision以及旧vehicleRevision（如有）、plate revision/reason/fileIds/key。固定锁所有相关车辆ID排序→牌照→当前绑定。显式关闭本牌照旧绑定、结束目标车已有的其它牌照绑定需携带对应牌照版本/绑定版本；不得隐式抢占。可先要求操作者显式unbind目标旧牌照，再bind本牌照，以减少一次命令内隐式副作用。
- [x] POST `/:id/unbind`：带当前bindingId/bindingRevision、vehicleRevision、plate revision/reason/key；结束一次当前绑定，清空兼容Vehicle.plateNumber（必须仍匹配本牌照）并递增车版本，不改VIN/assignment/order历史。
- [x] bind可接受本牌照从另一车显式移动，必须提供双方版本。目标已有不同有效绑定则要求先unbind；与另一车尚未核验的旧plateNumber文本重复亦拒绝并提示核查，不能自动猜历史归属。旧文本被替换时仅记录此次before/after，不制造过去已核验期间。
- [x] POST `/:id/archive`：当前无有效车辆绑定才可归档，revision/key/reason；当前归属期间一并按实际归档时刻结束并留审计，原历史保留。不删除牌照或证据。
- [x] 普通车辆创建不能带非空plateNumber；普通编辑仅允许原值不变（null/空统一处理），不同值报专用绑定入口业务错误。该保护不依赖新单/Mock开关，所有旧入口保持同一边界；车辆VIN及其它原占用规则继续执行。
- [x] 历史候选只读接口可列有plateNumber但无有效新绑定的车辆及重复号码，不自动建档/归属。绑定后更新同车当前牌号显示，不重写冻结合同和已确认交接。
- [x] 当前权限校验先于幂等回放，事务同时写期间、兼容字段、revision、审计和命令；单牌当前归属/绑定、单车当前绑定与规范号码由SQL唯一约束兜底。错误归属/绑定通过新命令修正，禁止回填任意过去时间。
- [x] 先红测规范化重复、跨牌证据、权限收回、双车/双牌争抢、旧版本、绑定移动要求旧车版本、普通PATCH绕过、历史不改/合作商范围不扩。根授DB独占后跑真实HTTP/隔离库，交限定差异与证据。

## 根与后台

根负责兼容迁移、license-plates权限、PLATE专用文件上传/读取及通用文件隔离、controller注册。C完成BAAS页面后再接牌照列表/绑定表单与车辆只读牌号提示，不提前放空菜单。普通车辆表单在接口保护落地同时停用原车牌编辑。

实施状态：上述后端任务已通过限定复核与本地验证，具体批次见施工证据；页面与生产发布另行验收。
