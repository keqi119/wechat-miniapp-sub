# 通用纸质补充协议：合成审阅样张

本包是未批准草案的本地审阅材料，不是可签署合同；没有写入数据库、注册法律文书、调用支付或签署网关。

- 打开 index.html 查看目录；delay.html、swap.html、renewal.html 为三类完整可读样张。换车页含同价与升级两份独立正文。
- 四份正文逐字来自实际 publisher 写入的 q.snapshot.document.content，与对应内存 Contract.body 一致。HTML 仅进行转义和段落排版。所有合成/待确认标签都在正文外。
- source-facts.json 保存正文、整数分逐期明细、输入变体、应用哈希与原始文本 SHA-256。应用 hash 是对 JSON.stringify(string) 求 SHA-256，与原始 UTF-8 文本哈希不同。
- 原草案 docs/legal/drafts/offline-order-amendment-v1.md 未修改，SHA-256：e7fab549049a0cb7cf4508f09e635c9829bcd47efb56afe203e64ec8819d2301。
- 续期取消及异常沿用既有合成输入，不代表取消费、退款比例或违约责任已经确定。
- 三方签署页式尚未生成；正文引用签署页，但样张没有伪造签字、盖章或签署日期。
- 延期及换车样例明确保留原用量规则；它们的合成源未冻结可重新列出的原里程数值，因此未虚构数值。续期样例明确新阶段每月 2400 公里、超额 2.30 元/公里。
- 续期原押金合同额为 500.00 元，但合成源未付款，不应把合同额当实收。

生成脚本及运行证据：tmp/legal-amendment-review-samples/。只使用独立内存 fixtures，不实例化真实数据库客户端。
