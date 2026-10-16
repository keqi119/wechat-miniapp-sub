# B2 与原生签署客户端合并

2026-10-16，主工作区。B2所属文件先单独提交93cc5ce，再按主控授权cherry-pick原生0a4f378；只处理apps/miniprogram，不stash、不带入API/admin/docs/deploy等未提交修改。隔离原生worktree及已冻结发布副本不改。

冲突在record JS/WXML、api.js、order-changes.js及删除的h5-signing.js。保留B2换车/恢复安全投影、两侧事实、逐车分段、无车间隔、次数账户、swap key清理和完整报价确认；合入原生native-signing、独立privacy同意、customer/token/generation/flowVersion守门、lease引用释放和页面卸载/迟到查询保护。AMENDMENT无早返回H5分支，先fresh capability/revision再以revision/key发正确native sign；B2费用或目标ID不会进入签署请求。删除旧H5适配器，无隐藏fallback。

受影响54/54；完整客户端153/153，0skip；build95文件、17WXML/18WXSS（16主包页+官方中间子包）。原样Mock109×2 SHA零差异。B2 actual-wcc16状态、native14状态均离线生成，零溢出/脚本异常/外部请求；分别见vehicle-change-layout/report.json、native-signing-layout/report.json。B2签署测试现验证原生AMENDMENT的正确版本、唯一POST和仅revision/key；既有20项native并发/独立同意/三kind/错误回查回归保留。

真实业务DB、供应商/生产API、SDK/DevTools、实名/短信/支付/签署、二维码、预览上传均未执行。未知Face AppID/path分支仍关闭，不统一阻断verified_way=1三要素路径。当前root产物包含未部署B2/017，只可由主控继续封存/审核，不代替线上已验证native-v1。
