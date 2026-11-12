# 车辆台账组合筛选（Phase2 2026-11-05）

GET /api/admin/vehicles 保持原会话、vehicles.read、keyword/status/page/pageSize及稳定排序。ADMIN/OPERATIONS可在同一请求组合：

| 参数 | 语义 |
| --- | --- |
| cooperationOwnerId | 当前实际业务合作商ID。优先当前有效SIMPLE协议与原件绑定；仅在不存在SIMPLE绑定时，使用已审核且合作商未停用的legacy OwnerVehicle。不是资料登记人、注册候选或登记车主姓名 |
| mileageKmMin / mileageKmMax | 公里，0..2147483647的整数，包含两端；两端同时提供须min<=max |
| batteryOwnership | OWNED或BAAS，读取VehicleAssetProfile真实登记；UNKNOWN/未登记不落入任一选项 |
| ageMonthsMin / ageMonthsMax | 自真实firstRegistrationDate到服务端北京时间ageAsOf的完整月数，0..120000，包含两端；两端同时提供须min<=max |

不发送表示不限，0是有效边界。数组、负数、小数、倒置范围或未知电池方式返回400；FINANCE/SUPPORT没有高级筛选或合作商目录权限，基本列表读权限不变。未登记/未来首次登记日不会被当成0月，车型年份和Vehicle.year不参与推算车龄。

所有组合生成同一个全库where，先过滤再分页；items与total使用完全同一条件，返回{items,total,page,pageSize,ageAsOf}。跨分页不采用当前页内过滤。

GET /api/admin/vehicles/filter-options?cooperationSearch=&page=1&pageSize=100 为当前有效ADMIN/OPERATIONS提供最小目录：{items:[{id,name}],total,page,pageSize,ageAsOf}。按所有真实当前合作绑定去重、可按姓名搜索、全量后分页；不会把DRAFT注册候选、已停用或过期协议当成当前合作。客户端可按total逐页读全；不新增“未登记”具体选项。

本增量仅只读查询、权限和校验，无schema/迁移/金额/支付或签章变更；资金32文件及第73迁移保持v3 SHA。
