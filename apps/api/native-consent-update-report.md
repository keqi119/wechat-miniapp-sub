# 旧预览实名缺同意提示

原生verify仅在完全缺少顶层consent时返回400 `ESIGN_CLIENT_UPDATE`：“请重新打开最新版小程序并单独同意实名说明”。已有但无效、空值、错误类型或过期同意仍按原严格schema/版本拒绝；H5不改变。拒绝发生在provider调用和实名同意审计之前，响应无姓名证件。

新增HTTP测试先红：原为VALIDATION，预期ESIGN_CLIENT_UPDATE（`.runtime/native-consent-hint-red.log`）。最小修复后 `NODE_ENV=test pnpm --filter @chundian/api exec tsx --test --test-concurrency=1 test/native-signing.test.ts test/h5-signing.test.ts` 24/24通过，0跳过（`.runtime/native-consent-hint-green.log`）；API build通过。未调用真实实名/短信/签署；不以该提示断言生产400根因已最终证明。
