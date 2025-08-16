# 测试指南（Vitest）

## 1. Mock 策略：优先使用 mockClear()，避免 mockReset()

- 原则：仅清理调用记录，不清空自定义实现。
- 背景：本项目多处依赖 mock 的自定义实现来累计统计或拦截调用（例如 `saveImage()` 在 twoPhase 测试中用于验证 `stats.formatCounts` 的累计与引用一致性）。
- 误用 `mockReset()` 会清除实现，导致累计/断言失真。

### 推荐用法
```js
// bad（会清空自定义实现，破坏统计）
// saveMock.mockReset()

// good（仅清理调用次数/历史，保留实现）
saveMock.mockClear()
```

### 典型场景
- E2E：`tests/e2e.twoPhase-retry.test.js`、`tests/twoPhase.stats-reference.test.js`
  - 使用 `saveMock.mockClear()`，并在注释中说明原因。
- 目的：保证 `saveImage()` 的实现或自定义实现仍然生效，从而在 `processDownloadQueue()` 返回的 `formatCounts` 等聚合对象中可观测到累计效果。

## 2. 关于 stats 引用一致性
- `downloadQueue.processDownloadQueue()` 与 twoPhase 分支均会创建一次聚合对象，例如 `aggregateFormatCounts`，并将其作为 `stats.formatCounts` 传入 `saveImage()`。
- 测试应验证：`saveImage()` 接收到的 `stats.formatCounts` 与最终返回结果的 `formatCounts` 为同一引用，并且在 `saveImage()` 内的累计可反映到返回值上。

### 示例
参考 `tests/twoPhase.stats-reference.test.js`：
```js
saveMock = vi.fn(async (buffer, filePath, imageUrl, stats) => {
  // 记录住 stats 引用
  captured.stats = stats
  // 模拟保存成功与累计
  stats.successful++
  stats.formatCounts.png = (stats.formatCounts.png || 0) + 1
})

// 断言：
expect(captured.stats.formatCounts).toBe(res.formatCounts)
expect(res.formatCounts.png || 0).toBe(1)
```

## 3. twoPhase 混合格式回归测试
- 文件：`tests/twoPhase.format-aggregation.test.js`
- 要点：禁用统一格式转换（`format.convertTo = 'none'`），分别输入 png/jpg/svg 三类图片，验证最终 `formatCounts` 为 `{ png:1, jpeg:1, svg:1 }`。
- 说明：`saveImage()` 会按“最终落盘格式”进行累计。若未来启用统一转换（例如默认转 PNG），则统计应反映转换后的最终格式。

## 4. 避免过度 Mock 系统模块
- 原则：遵循 KISS，能用真实实现就不引入额外抽象；必要时在边界处 Mock（如网络请求、浏览器依赖）。
- 清理资源：临时目录、文件在 `beforeEach/afterAll` 中创建/删除，避免测试间相互影响。

---

本指南旨在统一 Mock 与统计相关测试的约定，降低认知成本，避免回归。
