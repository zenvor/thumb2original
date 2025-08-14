### TL;DR 摘要

- 本方案将原“下载阶段”细化为“访问/获取（fetch）→ 分析（analyze）→ 写盘（save）”三阶段。新增 `lib/imageAnalyzer.js`，在 `fetchImage`（访问/获取）与 `saveImage`（写盘）之间插入分析调用。
- 目标：提前筛掉无效图片、提升稳健性，并为可选的 `twoPhase` 模式铺路。并发/重试/最终类型统计保持不变。
- P0：落地分析能力与统计与日志；P1：可观测性与 axios 容错增强；P2：`twoPhase` 模式与临时文件管控。
- 关键约束：最小侵入、KISS、统一错误处理、向后兼容。

---

## 文档导航（阅读指南）

- 目录（快速跳转）：
  - **第一部分：项目概览**
    - [背景](#背景)
    - [现状梳理（关键点）](#现状梳理关键点)
    - [目标与边界](#目标与边界)
  - **第二部分：核心设计方案**
    - [设计方案（最小侵入）](#设计方案最小侵入)
    - [与现有模块的协调关系](#与现有模块的协调关系)
  - **第三部分：实现规范**
    - [实现细节微调](#实现细节微调)
    - [错误分类细化](#错误分类细化)
    - [配置项预留](#配置项预留)
    - [统计维度扩展](#统计维度扩展)
    - [实现要点补充](#实现要点补充)
  - **第四部分：进阶功能**
    - [twoPhase 模式（可选，非默认）](#twophase-模式可选非默认)
  - **第五部分：实施指南**
    - [开发优先级与阶段划分](#开发优先级与阶段划分)
    - [变更清单（按文件）](#变更清单按文件)
    - [开发步骤（建议里程碑）](#开发步骤建议里程碑)
  - **第六部分：质量保证**
    - [一致性与裁决原则](#一致性与裁决原则)
    - [回滚与风险控制](#回滚与风险控制)
    - [验收标准（DoD）](#验收标准dod)

提示：文档中使用 P0/P1/P2 标签表示“必须/建议/可选”。如无特别说明，默认遵循 KISS 原则与向后兼容。

#---

# 第一部分：项目概览

## 背景

- 现有流程（runner）：Waiting for browser → Loading page → Scrolling down → Finding images → Downloading images。
- 现状说明：当前“Downloading images”内部包含两个连续动作：先访问/获取（fetch），随后直接写盘（save）。
- 需求：在现有 fetch → save 的中间新增“Analyzing images（分析阶段）”，形成 fetch → analyze → save 的三阶段流水，最小侵入地插入分析能力。

### 现状梳理（关键点）

- 入口与编排
  - `index.js` 负责整体跑批与日志头；调用 `downloadManager` → `orchestrateDownload`。
  - `lib/scraperOrchestrator.js` 的 `orchestrateDownload` 创建下载目录并调用队列处理。
- 队列与单元处理
  - `lib/downloadQueue.js` 的 `processDownloadQueue` 内部执行并发分批下载：
    - 为每个 url 调用 `lib/imageDownloader.js::fetchImage`（axios/puppeteer 二选一，必要时递归 html）。
    - 命名：`lib/fileManager.js::generateFileName`
    - 写盘：`lib/fileManager.js::saveImage`（包含格式统一转换 `format.convertTo` 和统计回写）。
- 图像工具
  - `utils/imageUtils.js` 提供 `identifyImageFormat`、`getImageMetadata`、`convertImageFormat` 等；
  - `utils/htmlMemoryManager.js` 在写盘后记录图片信息（基于文件路径）。

### 目标与边界

- 明确三阶段拆分，日志与进度条可见：
  - 访问/获取（fetch）：通过 Axios/Puppeteer 拉取图像，得到 `buffer`/`headers`/`finalUrl`。
  - 分析（analyze）：在内存中的同一份 `buffer` 上完成格式/尺寸/大小/可用性分析（不触发再次网络获取）。
  - 写盘（save）：仅负责将二进制数据写入本地，保持当前 `saveImage` 的职责与类型统计口径不变。
- 保持 KISS，尽量少改动现有函数签名与数据流；不新增全局状态；遵循统一错误处理。
- 不改变类型统计的口径：仍按“最终落盘格式”统计（即分析阶段不干扰计数）。

#---

# 第二部分：核心设计方案

## 设计方案（最小侵入）

### 流程示意图（文字版）

```
旧流程（现状）:
[URL] -> fetchImage() (访问/获取) -> generateFileName() -> saveImage() (写盘) -> [完成]

新流程（inline 模式，三阶段）:
[URL] -> fetchImage() (访问/获取)
                 |
                 v
        +------------------+
        |  analyzeImage()  |
        +------------------+
           | isValid?  |
           | Yes       | No
           v           v
 generateFileName()  记录失败原因 -> [跳过写盘]
           |
           v
       saveImage() (写盘) -> [完成]
```

术语统一：本文统一使用 `twoPhaseRefetch` 指代 twoPhase 模式下的“重新拉取同一图片”的行为（默认禁止）。

1) 新增模块 `lib/imageAnalyzer.js`
- 导出 `analyzeImage(imageData, url)`：
  - 入参：`imageData` 为 `fetchImage()` 返回的 `{buffer, headers, finalUrl}` 对象，`url` 为原始 URL
  - 返回：`{ isValid, reason?, metadata: { format, width, height, size, finalUrl } }`
  - 实现：
    - 使用 `identifyImageFormat(imageData.buffer)` 得到原始格式（不进行任何转换）。
    - 使用 `getImageMetadata(imageData.buffer)` 获取尺寸等元数据，若失败则尝试 `image-size` 兜底（`getImageMetadata` 已内部做兜底）。
    - `size` 取 `imageData.buffer.length`，`finalUrl` 取 `imageData.finalUrl`。
    - 内容类型白名单过滤（借鉴 @crawler-api/，并做统一与扩展）：基于 `headers['content-type']` 与 `headers['content-disposition']` 判定：
      - 允许前缀：`image/`
      - 允许二进制类：`application/octet-stream`、`application/x-binary`、`application/x-octet-stream`、`binary/octet-stream`
      - 允许 `content-disposition` 含 `attachment`
      - 允许缺失或空的 `content-type`（与 puppeteer 分支对齐）
      - 不将 `text/xml` / `application/xml` / `text/plain` 纳入白名单，避免误收；但分析阶段若 buffer 嗅探为 SVG 仍视为有效
      - 不满足则 `isValid=false`，`reason='unsupported_content_type'`
    - 综合格式与元数据判定 `isValid`（如格式为 Unknown 且元数据失败时视为无效）。
  - 日志：`logger.info` 简要输出（格式/尺寸/大小），遇到异常用 `logger.warn`，不抛出致命错误。

2) 改造 `processDownloadQueue`
- **保持现有并发机制**：继续使用 `config.concurrentDownloads` 控制并发数，每个并发单元内按以下三步顺序处理：
- **精确集成位置**：在 `downloadQueue.js` 的现有处理流程中，于 `fetchImage` 成功获取图片数据后、调用 `saveImage` 写盘前，插入 `analyzeImage` 调用进行质量检查。如果分析失败则计入统计并跳过后续写盘操作，如果分析成功则继续现有的文件名生成和保存流程。
- **进度统计优化**：在现有的 `stats` 统计对象中新增 `analyzed` 字段用于记录已分析的图片数量，与现有的 `total`、`successful`、`failed` 等字段并列，便于实时展示分析进度。
- **日志策略**：
  - 队列开始时：输出统一的阶段头信息，提示开始分析与下载流程
  - 分析成功后：增加分析计数，并输出每张图片的分析详情（格式、尺寸、大小等）
  - 现有进度显示：扩展显示分析进度，实时展示已分析数量与总数的比例

  - （可选增强）若 `axios` 分支需要更宽松的内容类型接受范围：在 `lib/downloader/axiosDownloader.js` 增加配置项 `acceptBinaryContentTypes`（可为布尔或字符串数组，默认启用内建白名单），与上述白名单一致，并接受缺失 `content-type` 的情况。
  - 头部白名单仅作“快速放行/拒绝”的提示层；最终裁决在分析阶段基于 buffer 嗅探与元数据判定。
  - 传递分析结果以避免重复分析：`analyzeImage` 成功后返回 `analysisResult`，在调用 `saveImage` 时以新增的可选参数传入：`saveImage(buffer, filePath, imageUrl, stats, downloadedImages, config, analysisResult?)`；`saveImage` 内部若收到 `analysisResult`，将跳过重复的 `identifyImageFormat` 与可能的尺寸解析，仅在缺失字段时兜底。
  - 分析失败的重试边界：细分“可重试/不可重试”并复用既有下载重试框架：
    - 可重试：`processing_timeout`、`memory_error`、`content_too_small`（疑似截断）→ 作为“下载失败”加入 `stats.failedUrls`，进入下一轮重试。
    - 不可重试：`unsupported_content_type`、`unknown_format`、`invalid_dimensions`、多数 `metadata_error` → 仅计入 `analysisFailures` 与 `analysisFailedUrls`，不加入重试队列。

3) 日志与用户可见体验
- 在 `lib/downloadQueue.js` 的 `processDownloadQueue` 内：
  - 在进入分析流程时输出阶段头：`logger.header('Analyzing images ...')`
  - 在进入写盘流程时输出阶段头：`logger.header('Downloading images ...')`
- 在 `index.js`（网络模式）与 `localHtmlProcessor.js`（本地 HTML 模式）中：
  - 保持现有的 `Finding images` 日志，无需额外修改
  - 不改变已有"类型统计：PNG X，JPEG Y ..."的输出逻辑（仍在队列结束后汇总）。

4) 与现有模块的协调关系（调整后）
- **分析与保存协同**：分析阶段产出 `analysisResult`，在调用 `saveImage` 时以可选参数传入，避免重复嗅探与解析；`saveImage` 仍保持格式转换/统计/记忆职责不变。
- **避免重复分析**：若 `saveImage` 收到 `analysisResult`，跳过重复 `identifyImageFormat`，仅在缺失字段时兜底检测；若与内部嗅探结果冲突，以 `analysisResult` 优先并输出告警日志（不中断流程）。
- **统计口径一致**：分析阶段不干扰类型统计，仍按 `saveImage` 最终落盘格式计数。
- **记忆管理不变**：`htmlMemoryManager` 继续在写盘后基于文件路径生成记录。

### 与现有模块的协调关系

根据前面的设计方案，新的 `analyzeImage` 功能将插入到现有的下载流程中。以下明确各模块的职责边界：

### 保持不变的模块
- `lib/imageDownloader.js`：继续负责获取图片数据，返回 `imageData` 对象
- `lib/fileManager.js`：继续负责图片保存、格式转换、文件命名等
- `lib/downloadQueue.js`：继续负责并发控制、重试逻辑、进度统计

### 新增模块
- `lib/imageAnalyzer.js`：专门负责图片分析，包括格式检测、元数据提取、有效性验证

### 集成点
在 `downloadQueue.js` 中的 `fetchImage` 和 `saveImage` 之间插入分析逻辑，确保数据流的连续性和一致性。

---

# 第三部分：实现规范

## 实现细节微调

- 日志粒度
  - 单张图片的分析详情使用 debug 级或采用抽样输出，避免大型批次日志刷屏
  - 阶段头与阶段性统计使用 info 级，保证用户可见性与简洁性

- 失败统计
  - 分析失败时除 `stats.failed++` 外，同时执行 `stats.analysisFailedUrls.push(url)` 便于后续追溯（分析失败不进入下载重试）

- 失败原因枚举
  - 在 `analyzeImage` 的返回中标准化 `reason` 字段，建议值：
    - `unsupported_content_type`（不在白名单，且非 attachment 且非缺失）
    - `unknown_format`（buffer 嗅探无法识别为图片）
    - `metadata_error`（获取元数据异常或关键字段缺失）
    - （可选）`invalid_dimensions`（尺寸异常，如 0x0 或明显非法）

- 性能注意
  - `getImageMetadata`（sharp）对大图存在 CPU 压力，分析阶段可记录耗时过长的样本（如 >N ms）到 debug/info 以便后续优化

#### 错误分类细化

- 新增并标准化 `reason` 枚举：
  - `unsupported_content_type`（不在白名单，且非 attachment 且非缺失）
  - `unknown_format`（buffer 嗅探无法识别为图片）
  - `metadata_error`（获取元数据异常或关键字段缺失）
  - `invalid_dimensions`（尺寸异常，如 0x0 或明显非法）
  - `content_too_small`（buffer 太小，如 < minBufferSize）
  - `processing_timeout`（分析超时，超过 timeoutMs）
  - `memory_error`（内存不足或 Sharp 分配失败）

- 建议判定顺序（由轻到重）：
  1) content-type 白名单快速判定
  2) minBufferSize（过小直接判定为 `content_too_small`）
  3) 格式嗅探（`unknown_format`）
  4) metadata/尺寸（`metadata_error` / `invalid_dimensions`）
  5) 超时/内存错误兜底（`processing_timeout` / `memory_error`）

##### 重试边界与处理策略（新增）

- 分析失败的可重试性：
  - 可重试：`processing_timeout`、`memory_error`、`content_too_small`
  - 不可重试：`unsupported_content_type`、`unknown_format`、`invalid_dimensions`、`metadata_error`（默认）
- 实现策略：在队列中，若为可重试原因，则按“下载失败”处理（推入 `stats.failedUrls`，进入既有重试回路）；否则仅计入 `analysisFailures`，不影响下载重试。
- 注：如需放宽 `metadata_error` 的重试（例如仅在 buffer 极小 < 8KB 时视为可重试），可通过配置开关在后续迭代引入（保持 P0 KISS，默认禁用）。

#### 配置项预留

- 在 `config/config.js` 预留：

```javascript
analysis: {
  preset: 'balanced',      // 新增：预设模式 'strict' | 'balanced' | 'loose'
  enableDetailLog: false, // 是否启用详细日志
  sampleRate: 100,        // 抽样输出比例（每N张输出一次）
  timeoutMs: 10000,       // 单张图片分析超时时间
  minBufferSize: 100,     // 最小 buffer 大小阈值（bytes）
  maxAnalyzableSizeInMB: 50 // 超大文件阈值（MB）：超过时可跳过元数据解析以保护 CPU
}
```

- 在 `lib/configValidator.js` 做默认填充与边界校验：
  - `sampleRate >= 1`
  - `timeoutMs >= 1000`
  - `minBufferSize >= 0`
  - `maxAnalyzableSizeInMB >= 1`
  - `preset` 可选 `'strict'|'balanced'|'loose'`，若提供则优先生效并映射为：
    - strict：`minBufferSize=1024`、`timeoutMs=5000`、`maxAnalyzableSizeInMB=20`
    - balanced（默认）：`minBufferSize=100`、`timeoutMs=10000`、`maxAnalyzableSizeInMB=50`
    - loose：`minBufferSize=0`、`timeoutMs=15000`、`maxAnalyzableSizeInMB=100`

#### 统计维度扩展

- 在 `downloadQueue` 的 `stats` 上扩展：

```javascript
stats: {
  // ...现有字段
  analyzed: 0,
  analysisFailures: {
    unsupported_content_type: 0,
    unknown_format: 0,
    metadata_error: 0,
    content_too_small: 0,
    processing_timeout: 0,
    memory_error: 0,
    invalid_dimensions: 0
  },
  analysisFailedUrls: [] // 仅用于日志追溯；不进入重试队列
}
```

- 策略：分析失败属于“不可重试”类，不加入 `failedUrls`（该数组用于下载重试）；只在上述 `analysisFailures` 与 `analysisFailedUrls` 记录。
 - 策略（调整）：仅对“不可重试”分析失败保持不入重试队列；对“可重试”原因（见上节）则将 URL 归入 `failedUrls`，复用现有下载重试机制。

#### 实现要点补充

- 日志粒度：
  - 单张分析日志采用 debug 或按 `sampleRate` 抽样；阶段头与汇总用 info
  - 动态采样（建议）：当单次任务图片总数 > 1000 时，提升有效采样率为 `effectiveSampleRate = Math.max(analysis.sampleRate, 500)`；当 > 5000 时提升为 `Math.max(analysis.sampleRate, 1000)`，以降低大批次的日志刷屏风险

- 超时实现：
  - 对 `getImageMetadata`/格式嗅探采用 `Promise.race([task, timeout])` 包裹；超时时标记 `processing_timeout`

- 内存错误识别：
  - 捕获 `RangeError`、`ERR_OUT_OF_MEMORY`、包含 `Allocation failed`/`Cannot allocate memory` 的异常，标记 `memory_error`

- 性能顺序：
  - 先执行 content-type 白名单与 `minBufferSize` 判定，再进行 `identifyImageFormat` 与 `getImageMetadata`

- 超大文件策略（保护 CPU）：
  - 当 `buffer.length` 对应大小超过 `analysis.maxAnalyzableSizeInMB` 阈值时：
    - 严禁将该 buffer 传入 `sharp`，仅做轻量格式嗅探与大小统计；
    - 在 `metadata` 中设置 `width/height=null` 并添加 `skipped: 'too_large'` 标记；
    - 判定有效性依赖 content-type 与嗅探结果，不触发重试；写盘阶段的统一转换保持不变。

- SVG 元数据兼容性：
  - Sharp 对部分环境的 SVG 尺寸解析可能依赖 `librsvg`。若运行环境缺失导致尺寸解析失败，可回退到轻量解析：从 SVG 文本中解析 `width`/`height` 或 `viewBox`（如 `viewBox="0 0 W H"`）估算尺寸；解析失败时仍可视为有效图片，但在 `metadata` 中仅保留 `format='svg'` 与 `size`。
  - 若 SVG 不提供像素尺寸或仅有相对单位，统一标记尺寸为 `unknown`（`width/height=null`），不作为失败理由。

### 变更清单（按文件）

- 新增：`lib/imageAnalyzer.js`
  - `analyzeImage(imageData, url)` 导出函数，接收 `fetchImage` 返回的数据结构
  - 返回 `{ isValid, reason?, metadata: { format, width, height, size, finalUrl } }`

- 修改：`lib/downloadQueue.js`
  - 在 `fetchImage` 与 `saveImage` 之间精确插入 `analyzeImage` 调用
  - 扩展 `stats` 对象，新增 `analyzed` 字段用于分析计数
  - 分析失败时计入 `stats.failed` 并跳过写盘，分析成功时计入 `stats.analyzed`
  - 在队列开始时输出统一阶段头日志，优化进度显示
  - 可重试分析失败（`processing_timeout`/`memory_error`/`content_too_small`）将 URL 归入 `failedUrls` 以复用既有重试回路；其余原因仅计入 `analysisFailures`

- （可选）修改：`lib/downloader/axiosDownloader.js`
  - 支持 `acceptBinaryContentTypes` 配置，放宽对 `content-type` 的判定（允许缺失 `content-type`），便于下载部分站点返回的二进制流（与分析阶段的白名单保持一致）。

- 修改：`lib/fileManager.js`
  - `saveImage` 新增可选参数 `analysisResult?`：`saveImage(buffer, filePath, imageUrl, stats, downloadedImages, config, analysisResult?)`
  - 若提供 `analysisResult`，跳过重复格式嗅探；当与内部嗅探冲突时，以 `analysisResult` 为准并输出告警（不中断流程）。

---

# 第六部分：质量保证

## 一致性与裁决原则

- axios 与 puppeteer 分支在 headers 判定上对齐：接受 `image/*`、二进制类、`attachment`、以及缺失 `content-type`。
- headers 白名单仅作提示层；最终以“分析阶段”的 buffer 嗅探（`identifyImageFormat`/SVG 兜底）与 `getImageMetadata` 的结果决定有效性。

- 可选修改：`config/config.js`
  - 可为 analysis 相关功能预留配置位置（如详细日志级别、内容类型检查严格程度）

- 注意：`index.js` 与 `localHtmlProcessor.js` 
  - 无需修改阶段头日志（由 downloadQueue 统一输出）
  - 保持现有的最终统计输出逻辑不变

---

## 测试策略

- 单元测试（`lib/imageAnalyzer.js`）：
  - 覆盖所有失败 `reason` 场景：`unsupported_content_type`、`unknown_format`、`metadata_error`、`invalid_dimensions`、`content_too_small`、`processing_timeout`、`memory_error`。
  - 覆盖 SVG 场景（含正常与无法解析尺寸的回退路径）。
  - 覆盖超大文件阈值策略（超过 `maxAnalyzableSizeInMB` 时跳过元数据解析）。

- 集成测试（`lib/downloadQueue.js`）：
  - 验证分析成功/失败的分支是否正确调用或跳过 `saveImage`。
  - 验证 `stats` 累计：`analyzed`、`analysisFailures{...}`、`analysisFailedUrls` 是否正确更新；分析失败不进入下载重试队列。

- 端到端测试（本地 HTML 与网络模式）：
  - 准备异常样本集：损坏图片、扩展名伪装的非图片、超小尺寸图片、缺失/异常 `content-type`、SVG。
  - 验证阶段日志可见性与最终类型统计与现状一致。

#### 边界样本准备（建议）

- 头部正常/内容截断：服务端返回 200 且 `Content-Type: image/*`，但仅返回部分内容（可模拟中途断流或直接截断 buffer），用于验证 `content_too_small` 与可重试路径
- 非图片内容混入：在图像数据尾部追加随机字节，触发解析失败（验证 `unknown_format`/`metadata_error` 分类）
- 超大文件：≥100MB 大图，验证“跳过尺寸解析”的策略与内存保护是否生效

# 第四部分：进阶功能

## twoPhase 模式（可选，非默认）

- 目标：为未来抽取 `crawler-core` 并接入 `crawler-api` 做准备，支持“分析完成后统一输出，再进入下载阶段”的编排；默认仍为 `inline` 模式。

- 重要约束（与你的要求对齐）：
  - “并发完成全量 Analyze”并非“一次性把所有图片全并发发出”，而是严格遵守 `config.concurrentDownloads` 的并发上限，采用队列模式逐批处理直到全部 URL 分析完毕。
  - 禁用 twoPhaseRefetch（分析后再次从网络拉取同一图片）。分析阶段获取到的二进制数据将被持久化到本地临时文件，下载阶段直接复用临时文件，避免二次下载与带宽浪费。

- 数据流（两段流水线）：
  1) 分析阶段（Analyze Stage）
     - 进队列并按并发上限执行：`fetchImage(url)` → `analyzeImage(imageData, url)`。
     - 若有效：将 `imageData.buffer` 写入临时文件（`analysis.tempDir`），记录 `{ url, tempPath, headers, metadata }`，随即释放内存 buffer（避免堆积）。
     - 若无效：记录失败原因枚举与 URL（不进入下载队列）。
     - 阶段结束：输出分析汇总（含原因细分统计）。
  2) 下载阶段（Download Stage）
     - 读取分析通过的清单（包含 `tempPath` 与 `metadata`），按并发上限读取临时文件为 buffer，调用现有 `generateFileName` 与 `saveImage`（执行统一格式转换/统计/记忆）。
     - 下载阶段完成后，统一清理临时文件与目录（或按配置保留）。

- 配置（新增 `config.analysis` 字段扩展）：
  - `mode: 'inline' | 'twoPhase'`（默认 `inline`）
  - `tempDir: string`（默认 `./.tmp_analysis`，用于临时持久化 buffer）
  - `cleanupTempOnComplete: boolean`（默认 `true`，下载阶段完成后清理临时文件）
  - `maxHoldBuffers: number`（默认 `0`，表示分析阶段不在内存中保留 buffer，写入临时文件后立即释放）
  - `concurrentDownloads` 仍复用现有顶层配置，不新增并发维度。

- 统计与清理：
  - 新增统计项（建议）：`tempFilesCreated`、`tempBytesWritten`、`tempCleanupRemoved`。
  - 失败保护：若程序异常退出，下一次启动时对 `tempDir` 进行清理（可按 mtime 或文件标记）。
  - I/O 权衡：当批量处理大量小图片时，频繁的临时文件写入/读取可能成为瓶颈。可通过适度提高 `analysis.maxHoldBuffers`（例如设置为一个小的正整数）以在内存中短暂批量持有 buffer 后再统一落盘，或仅在高并发/小图场景下启用该策略。

- 变更点（规划）：
- 新增 `lib/tempFileStore.js`（或在 `fileManager` 内补充临时写入/读取/清理能力）。
  - 在 `downloadQueue`：若 `analysis.mode === 'twoPhase'`，先执行“全量分析队列”→“汇总输出”→“下载队列”三步编排。
  - `saveImage` 保持不变；twoPhase 下载阶段自临时文件读取 buffer 后再调用 `saveImage`。

#---

# 第五部分：实施指南

## 开发优先级与阶段划分

#### P0 必须（当前迭代立即落地，范围收敛）
- 新增模块 `lib/imageAnalyzer.js`（精简版）：
  - P0 仅实现：content-type 白名单、`minBufferSize`、格式嗅探与超时/内存错误识别；返回 `{ isValid, reason?, metadata }`（`metadata` 可不含尺寸）。
- 集成 `lib/downloadQueue.js`：
  - 在 `fetchImage` 与 `saveImage` 之间插入分析；按“可重试/不可重试”边界处理失败（可重试进入既有重试回路）。
  - 扩展 `stats`：新增 `analyzed`、`analysisFailures{...}`、`analysisFailedUrls`；类型统计与记忆管理保持不变（按最终落盘格式）。
- `lib/fileManager.js`：
  - 为 `saveImage` 增加可选参数 `analysisResult?` 并复用格式结果，避免重复分析（P0 即可落地，改动面小）。
- 配置与校验：
  - 在 `config/config.js` 预留 `analysis` 默认配置（含 `preset`，默认为 `balanced`）。
  - 在 `lib/configValidator.js` 填充默认值并做边界校验（含 `preset` 合法性与映射）。
- 日志策略：
  - 单张分析日志用 debug 或按 `sampleRate` 抽样；阶段头与汇总用 info；保留现有阶段统计与最终类型统计。
- 不改动内容：并发/重试框架整体、类型统计口径、`htmlMemoryManager` 时机与结构。

完成标准（P0 DoD）
- 控制台可见“Analyzing images / Downloading images”两个阶段头；分析详情按策略输出；统计新增项生效。
- 可重试的分析失败进入既有重试回路；不可重试的分析失败仅记录而不重试。
- `saveImage` 能复用 `analysisResult`，避免重复格式嗅探；写盘与最终类型统计无回归；本地/网络模式均通过回归。

#### P1 建议（下一迭代增强）
- `axiosDownloader`：可选配置 `acceptBinaryContentTypes`（布尔或字符串数组），与白名单一致，并接受缺失 `content-type`；最终裁决仍由分析阶段完成。
- 性能可观测：记录单张分析耗时并对超时样本打标；必要时输出采样日志。
- 汇总输出增强：在队列尾部输出分析失败原因细分汇总（承接 `analysisFailures` 结构）。
- 可调控：将抽样比例、日志级别在 `analysis` 配置中参数化。
 - 元数据增强：在不触发内存峰值的前提下，补充尺寸解析（按 `maxAnalyzableSizeInMB` 与采样策略执行）。

#### P2 可选（twoPhase 模式与临时文件管控）
- 实现 `analysis.mode='twoPhase'` 的完整双阶段编排（严格遵守并发上限，逐批完成“全量分析”后再统一进入下载阶段）。
- 新增 `lib/tempFileStore.js` 或在 `fileManager` 中提供临时文件写入/读取/清理能力，避免 twoPhaseRefetch。
- 配置扩展：`analysis.tempDir`、`analysis.cleanupTempOnComplete`、`analysis.maxHoldBuffers`（默认 0，写入即释放）。
- 冷启动清理策略：应用启动时清理陈旧临时文件（基于 mtime 或标记）。
- 与 `crawler-core` 的接口对齐：规划 `analyzeUrls()` 与 `downloadUrls()` 的稳定 API。

### 开发步骤（建议里程碑）

- 第 1 步：创建 `lib/imageAnalyzer.js`，实现与单测（如有）。
- 第 2 步：在 `processDownloadQueue` 中插入分析阶段调用与统一日志输出，不改动并发/重试框架。
- 第 3 步：优化进度显示逻辑，支持分析/下载/失败的实时计数展示。
- 第 4 步：回归测试（本地 HTML 模式与网络模式），验证：
  - a) 分析阶段日志是否可见且正确累计；
  - b) 写盘功能/格式转换与类型统计无回归；
  - c) 错误处理：无法识别/无效图像是否正确跳过且不影响后续；
  - d) 并发/重试逻辑正常；
  - e) 断点续传（memory）不受影响。
- 第 5 步：代码审查与清理多余日志；准备 README 配置板块更新（后续再做）。

### 实施任务清单（Checklist，可勾选）

#### P0 必须（当前迭代）
- [ ] 创建 feature 分支：`feat/analyze-stage`
- [ ] 新增 `lib/imageAnalyzer.js`
  - [ ] 实现 `analyzeImage(imageData, url)`（P0 精简版）：内容类型白名单、`minBufferSize`、格式嗅探、`timeout`/`memory_error` 分类
  - [ ] 超大文件策略：超过 `analysis.maxAnalyzableSizeInMB` 跳过尺寸解析，并在 `metadata.skipped='too_large'` 标记
  - [ ] SVG：无法解析尺寸时设为 `unknown`，不视为失败
- [ ] 修改 `lib/downloadQueue.js`
  - [ ] 在 `fetchImage` 与 `saveImage` 之间插入 `analyzeImage`
  - [ ] 扩展 `stats`：`analyzed`、`analysisFailures{...}`、`analysisFailedUrls`
  - [ ] 日志：阶段头 `Analyzing images ...` / `Downloading images ...`；抽样/级别按配置
  - [ ] 分析失败：按“可重试/不可重试”边界处理（可重试加入 `failedUrls`）
- [ ] 配置与校验
  - [ ] `config/config.js` 预留 `analysis` 字段（含 `preset`）
  - [ ] `lib/configValidator.js` 填充默认值并做边界校验；实现 `preset` 到具体阈值的映射
- [ ] 测试
  - [ ] `imageAnalyzer` 单测：失败原因覆盖、SVG 尺寸 `unknown`、超大文件 `skipped` 标记
  - [ ] 边界样本：100MB+ 大图、损坏图片（头部正常/内容截断）、网络中断导致的部分下载（模拟）
  - [ ] `downloadQueue` 集成测试：可重试与不可重试路径、`analysisResult` 传递给 `saveImage`
  - [ ] E2E：本地 HTML/网络模式回归（并发/重试/断点续传不回归）
- [ ] 清理多余日志与降噪

#### P1 建议（下一迭代）
- [ ] `axiosDownloader` 支持 `acceptBinaryContentTypes`
- [ ] 记录分析耗时并标记超时样本（可观测性）
- [ ] 队列尾部输出分析失败原因细分汇总（承接 `analysisFailures`）
- [ ] 参数化抽样比例与日志级别（如 `enableDetailLog`）

#### P2 可选（twoPhase 模式）
- [ ] `analysis.mode='twoPhase'` 编排实现（遵守并发上限）
- [ ] 新增 `lib/tempFileStore.js` 或在 `fileManager` 内补充临时文件能力
- [ ] 扩展配置：`analysis.tempDir`、`cleanupTempOnComplete`、`maxHoldBuffers`
- [ ] 冷启动清理临时文件策略（mtime/标记）
- [ ] 与 `crawler-core` 接口对齐：`analyzeUrls()` / `downloadUrls()`

### 回滚与风险控制

- 所有改动集中在新增模块与 `processDownloadQueue` 内部次级流程；
- 如遇异常，最小回滚策略：
  - 移除 `analyzeImage` 调用，恢复“下载即写盘”的原行为；
  - 保留新增文件不引用即可。

### 验收标准（DoD）

- 控制台/日志中明确出现两个阶段头：Analyzing images / Downloading images。
- 分析阶段对每张图片至少输出一条简要信息（格式+尺寸，失败时告警）。
- 写盘与最终类型统计与现状一致（计数基于最终落盘格式）。
- 性能与稳定性不劣化（并发/重试/断点续传行为不变）。


