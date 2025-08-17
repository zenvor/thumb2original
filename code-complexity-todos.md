# 代码复杂度优化任务清单

基于复杂度检查工具 [`code-complexity-check-prompt.md`](./code-complexity-check-prompt.md) 的分析结果，按优先级跟踪需要优化的文件。

> 💡 **经验教训**：简化实现通常能带来显著功能改进（如 CSS 提取：复杂实现 3 个 → 简单实现 164 个结果）

## 🚨 高优先级（急需优化）

### 1. imageAnalyzer.js - 已优化 ✅（详情见下方“已完成”）

### 2. fileManager.js - **已优化** ✅
- **原复杂度**: 7/10 → **优化后**: **3/10**
- **优化成果**:
  - ✅ **函数拆分**: `saveImage()` 从 97 行精简至 25 行（**减少 74.2%**）
  - ✅ **参数优化**: 保持 7 个参数但简化内部逻辑，清晰的职责分离
  - ✅ **职责分离**: 拆分为 6 个专职函数
    - `processFormatConversion()` - 统一转换逻辑
    - `writeImageFile()` - 文件写入（失败抛 `isCritical=true`）
    - `updateStatistics()` - 统计更新（保持最终落盘格式统计语义）
    - `collectImageInfo()` - 信息收集
    - `handleImageMemory()` - 记忆管理
  - ✅ **工具函数提取**:
    - `normalizeExtension()` - 统一扩展名改写，消除重复正则
    - `getCachedImageFormat()` - 缓存格式识别结果
    - `parseFilenameFromHeaders()` - 字符串操作替代复杂正则
  - ✅ **代码清理**: 移除未使用的 `convertWebpToPng` 导入
  - ✅ **嵌套优化**: 从多层 try/catch 降至单层错误处理
  - ✅ **测试验证**: 修复并通过所有单元测试，保持向后兼容

### 3. downloadQueue.js - **复杂度 3/10** ✅
- **状态**: ✅ **已完成优化**  
- **原始问题**:
  - `processDownloadQueue()` 函数 279 行（超标准 **9.3 倍**）
  - `processTwoPhase()` 函数 235 行（超标准 **7.8 倍**）
  - 嵌套深度达到 6 层，职责严重混杂
  - inline 和 twoPhase 模式存在大量重复代码

- **已完成优化**:
  - ✅ **拆分超长函数**: `processDownloadQueue()` 精简为路由函数，分离 `processInlineMode()` 处理内联模式
  - ✅ **拆分 twoPhase 函数**: 分离为 `analyzePhase()` 和 `downloadPhase()` 独立函数
  - ✅ **提取公共逻辑**: 创建 `calculateEffectiveSampleRate()`、`createStatsObject()`、`createAggregateStats()` 等工具函数
  - ✅ **降低嵌套深度**: 使用函数提取将嵌套层级降至 3 层以内，消除深度嵌套
  - ✅ **统一错误处理**: 创建 `handleBatchError()`、`outputFinalStats()` 等专门处理函数
  - ✅ **消除重复代码**: 统一采样计算、统计聚合、错误处理逻辑

- **重构成果**:
  - **主函数行数**: `processDownloadQueue()` 从 279 行 → 20 行（减少 **92.8%**）
  - **twoPhase函数**: `processTwoPhase()` 从 235 行 → 32 行（减少 **86.4%**） 
  - **嵌套深度**: 从 6 层 → 3 层以内（符合标准）
  - **函数数量**: 新增 9 个专职函数，职责清晰
  - **测试验证**: 58/58 测试全部通过，功能完全保持不变

- **设计原则遵循**: ✅ KISS 原则、✅ 职责单一、✅ 避免过度抽象、✅ 统一错误处理

### 4. imageFetcher.js - **已优化完成** ✅
- **原复杂度**: 6/10 → **优化后**: **3/10**
- **重构成果**:
  - ✅ **data URI 处理提取**: 独立 `parseDataUri()` 函数，返回 `{buffer, finalUrl, headers}` 或 `null`
  - ✅ **消除重复代码**: 统一 `acceptBinaryContentTypes` 配置提取，避免重复访问
  - ✅ **策略循环简化**: 新增 `executeDownloadStrategies()` 封装策略执行逻辑
  - ✅ **参数优化**: 使用对象参数模式，减少 `puppeteerFetchOnce()` 参数传递复杂度
  - ✅ **策略抽象**: 分离 `executeAxiosStrategy()` 和 `executePuppeteerStrategy()` 独立处理
  - ✅ **主函数精简**: `fetchImage()` 逻辑更清晰，职责明确

- **优化方案（已完成）**:
  - ✅ 提取 `parseDataUri(dataUri)` 函数 - 独立处理 data URI 解析，返回 `{buffer, finalUrl, headers}` 或 `null`
  - ✅ 提取公共配置 - 统一提取 `acceptBinaryContentTypes` 等配置，避免重复访问
  - ✅ 简化策略循环 - 提取策略执行函数处理不同下载策略
  - ✅ 使用选项对象模式 - 将多个参数封装为结构化对象传递
  - ✅ 函数职责分离 - 每个函数专注单一功能，提高可维护性
  - ✅ 测试验证 - 58/58 测试全部通过，功能完全保持不变

## ✅ 已完成

### imageExtractor.js - **深度优化完成** ✅
- **原复杂度**: 7/10 → **最终复杂度**: **2/10**
- **优化成果**:
  - ✅ **架构重构**：主函数从 224 行精简至 30 行（**减少 86.6%**）
  - ✅ **客户端分离**：200+ 行浏览器逻辑提取为独立脚本文件 `browser-scripts/imageExtractorClient.js`
  - ✅ **嵌套优化**：SVG 处理嵌套从 4 层降至 3 层，提取 `processInlineSvg()` 函数
  - ✅ **消除重复**：统一 `getHrefOrXlink()` 工具函数，消除 href/xlink:href 重复提取
  - ✅ **正则简化**：`extractUrlFromCss` 从复杂正则改为 21 行字符串操作
  - ✅ **错误修复**：解决 `Illegal return statement` 和 `arguments is not defined` 语法错误
  - ✅ **功能验证**：测试通过，图片提取功能正常工作

### imageAnalyzer.js - **已优化** ✅
- **原复杂度**: 8/10 → **优化后**: 4/10
- **优化成果**:
  - ✅ 拆分：`validateImageData()` / `checkContentType()` / `extractMetadata()` / `validateDimensions()` / `classifyAnalysisError()`
  - ✅ 统一内容类型策略：采用 ctBare + `mapContentTypeToFormat()`，复用 `shouldAcceptResponse()`；XML/TEXT 情况对实际 SVG 例外放行
  - ✅ `withTimeout` 增加定时器清理，避免悬挂
  - ✅ 超大文件跳过元数据解析（保留 format/size 并标记 `skipped=too_large`）
  - ✅ 严格校验模式 `strictValidation` 与错误分类一致化（`processing_timeout` / `memory_error` / `metadata_error`）
  - ✅ 日志抽样 `effectiveSampleRate` 支持与长耗时阈值告警
- **备注**: 已按 `code-complexity-check-prompt.md` 完成检查与优化，保持向后兼容并通过现有测试

## 🟢 低优先级（后续检查）

### 处理器模块 ✅ 已完成
- [x] `imageModeProcessor.js` - 处理器逻辑 ✅
- [x] `localHtmlProcessor.js` - HTML 处理器 ✅

## 📊 总体进度

- **已检查文件**: 6/8 (75%)
- **已优化文件**: 3/8 (37.5%)  
- **高优先级待优化**: 2 个
- **预计优化收益**: 显著提升图片处理成功率

## 🔧 优化工具与原则

### 使用工具
- 复杂度检查模板: [`code-complexity-check-prompt.md`](./code-complexity-check-prompt.md)
- 设计原则指导: [`design-principles.md`](./rules/design-principles.md)

### 核心原则
1. **KISS 原则**: 简单直接 > 复杂抽象
2. **统一错误处理**: 一致的捕获和处理机制
3. **单一职责**: 每个函数 ≤ 30 行，职责明确
4. **防御性编程**: 充分边界检查和错误处理

### 复杂度标准
- **函数长度**: > 30 行标记为复杂
- **参数数量**: > 4 个标记为复杂
- **嵌套深度**: > 3 层标记为复杂
- **条件分支**: > 5 个 if/else 标记为复杂

---

*最后更新: 2025-08-17*
