# 交还地点配置与验收

三份完整文案于2026-10-17获用户批准，批准源和正式副本SHA-256见[批准记录](legal/location-approval-manifest.json)。批准不等于已经发布，当前manifest保持published=false。

## 启用顺序

1. 通过新后台既有协议发布流程录入privacy v3、application v3和handover-location v1，内容使用manifest中的finalFile原文；核对confirmedBy和confirmedAt。不要覆盖历史版本或历史客户同意。
2. 将三个已发布文件的数据库id、version、内容摘要配置到独立API的HANDOVER_LOCATION_POLICY_JSON，结构如下。内容摘要按`hash(content)`即SHA-256(JSON.stringify(content))计算，区别于manifest的文件字节SHA-256。不包含密钥。

```json
{"privacy":{"documentId":"已发布隐私文档id","version":3,"contentHash":"64位小写十六进制"},"application":{"documentId":"已发布申请文档id","version":3,"contentHash":"64位小写十六进制"},"handover-location":{"documentId":"已发布选址说明id","version":1,"contentHash":"64位小写十六进制"}}
```

3. GET /api/public/handover-location应返回enabled=true，mapEnabled=false。此时可手动提交地址；新隐私政策须客户自行重新同意，既有同意不自动迁移。
4. 微信平台仅申请wx.chooseLocation；用途是客户主动选择车辆交还地点，始终保留手填，不申请后台定位或轨迹。2026-10-17现场核对该接口尚未开通，申请表已准备但尚未提交。截图资料如使用开发界面须明确标注合成展示，不作为真机接口成功证据。
5. 将微信隐私保护指引同步到获批v3，披露选择的地点及实际使用接口。接口开通及指引同步后，受控验证时才设置HANDOVER_LOCATION_MAP_ENABLED=true。验证客户拒绝、取消、手填、主动选点、核对提交和补件往返；通过后记录证据。

如果任一文件被替换、摘要不符或未正式确认，新地点入口自动关闭；关闭地图不影响已保存地点查看和手填。已提交申请的幂等重放不产生新同意。删除建议地点使用显式null，旧客户端省略该字段保留原值。

## 数据与合同边界

客户profile.handoverLocation只存name/address/source及地图提交时由服务端生成的consent快照；选择框返回的latitude/longitude不会复制到页面数据、请求或存储。地点输入严格校验，伪造同意时间等额外字段被拒绝。

后台显示建议及来源，空白新方案会预填带“待确认”的交还安排，必须由运营核对补全后才能发布。已有非空交还条款不覆盖，最终方案按原有摘要确认后冻结。实际交还地点、时间和车辆状况继续在独立交接流程按事实记录。

当前变更不生成真实订单、不代表出租授权或保险用途资料已齐全，也不触发微信定位、付款或签署。
