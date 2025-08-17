# 缩略图转原图爬虫工具

一个功能强大的图片爬虫工具，支持从网页和本地HTML文件中提取图片URL，并自动将缩略图转换为原图进行下载。

## 功能特性

- **多种爬虫模式**：
  - `single_page`：单页面爬虫模式
  - `multiple_pages`：多页面爬虫模式
  - `local_html`：**本地HTML爬虫模式**（新增）

- **智能图片处理**：
  - 自动识别图片格式
  - 缩略图到原图URL转换
  - WebP格式自动转换为PNG
  - 图片去重处理

- **高级下载功能**：
  - 并发下载控制
  - 失败重试机制
  - 随机延迟防反爬
  - 进度实时显示

- **🛡️ 反检测功能**（新增）：
  - 集成 puppeteer-extra + stealth 插件
  - 自动隐藏浏览器自动化痕迹
  - 模拟真实用户行为
  - 绕过 Cloudflare 等反爬虫系统
  - 可配置的反检测强度

## 项目安装

```bash
npm install
```

### 安装Chrome浏览器（Puppeteer需要）

```bash
npx puppeteer browsers install chrome
```

## 使用方法

### 1. 配置

所有配置项均在 `config/config.js` 文件中设置：

```javascript
const scraperConfig = {
  scrapeMode: 'single_page', // 或 'multiple_pages'
  targetUrl: 'https://example.com/gallery',
  imageMode: 'originals_only',
  
  // 反检测配置（新增）
  antiDetection: {
    enableStealth: true,        // 启用 stealth 插件
    enableAdvancedArgs: true,   // 启用高级浏览器参数
    windowSize: '1366,768',     // 浏览器窗口大小
    userAgent: null,            // 自定义 User Agent
    randomizeFingerprint: false // 随机化浏览器指纹
  },

  // 下载与重试（单位统一为毫秒）
  maxRetries: 5,
  retryDelayMs: 5000,
  concurrentDownloads: 10,
  minRequestDelayMs: 2000,
  maxRequestDelayMs: 4000,
}
```



```javascript
const scraperConfig = {
  scrapeMode: 'local_html',
  htmlDirectory: './html',
  imageMode: 'originals_only',
  
  // 记忆功能（推荐开启）
  enableMemory: true,
  memoryDirectory: './memory',
  forceReprocess: false,
  lazyMemoryCreation: true,
  maxFilesPerRun: 200,
  confirmLargeRun: false,

  // 下载与重试（单位统一为毫秒）
  maxRetries: 5,
  retryDelayMs: 5000,
  concurrentDownloads: 10,
  minRequestDelayMs: 2000,
  maxRequestDelayMs: 4000,
}
```

详细说明请参考：[本地HTML爬虫模式使用说明](./LOCAL_HTML_MODE.md)

### 2. 运行爬虫

```bash
# 推荐使用 npm start
npm start

# 或者直接运行主入口
node index.js
```

## 配置选项

| 配置项 | 说明 | 可选值 |
|--------|------|--------|
| `scrapeMode` | 爬虫模式 | `single_page`, `multiple_pages`, `local_html` |
| `imageMode` | 图片模式 | `all`, `originals_only` |
| `htmlDirectory` | HTML文件目录 | 相对或绝对路径 |
| `outputDirectory` | 输出目录 | 默认为 `./download` |
| `concurrentDownloads` | 并发下载数 | 数字，默认10 |
| `maxRetries` | 最大重试次数 | 数字，默认5 |
| `retryDelayMs` | 重试间隔（毫秒） | 数字，默认5000 |
| `minRequestDelayMs` | 批次最小延迟（毫秒） | 数字，默认2000 |
| `maxRequestDelayMs` | 批次最大延迟（毫秒） | 数字，默认4000 |

### 图片格式转换说明

- AVIF/SVG 仅识别不转换（参与统计，不改变原始格式）。
- 全局转换策略 `format.convertTo` 仅支持 `'jpeg' | 'png' | 'webp' | 'tiff' | 'none'`；默认建议按需开启（不强制转换）。
- 暂不暴露更细的质量/压缩参数（如 quality/effort/subsampling 等），以保持代码简洁与稳定；如后续有明确体积/画质目标再评估开放。

### 图片分析与下载接收策略（analysis）

- `analysis.acceptBinaryContentTypes`：控制 Axios 获取阶段对响应类型的放宽策略。
  - 布尔：`true`（默认）放宽到 `image/*`、缺失 `content-type`、常见二进制（如 `application/octet-stream`）；`false` 仅允许 `image/*`。
  - 字符串数组：允许 `image/*` 与数组中显式列出的类型；若数组包含空字符串 `''`，则缺失 `content-type` 也放行。
  - 生效路径：`lib/imageFetcher.js` → `axiosFetcher`。
  
- 严格校验（元数据解析）：
  - `analysis.strictValidation`：布尔，默认 `false`。为 `true` 时，元数据解析异常将直接判定为失败（`reason: 'metadata_error'`）；为 `false` 时不中断，标记 `metadata.parseErrorContinue = true` 并计入观测统计。

#### 典型场景建议

- 严格质量管控（追求数据绝对可靠）
  - 适用：生成高价值数据集、必须保证每张图片元数据完整的任务。
  - 配置：开启严格模式，发现解析异常即失败。

  ```js
  // config/config.js 片段
  analysis: {
    preset: 'balanced',
    strictValidation: true,
    // 其他按需...
  }
  ```

- 容错优先（尽量不丢图，后续再清洗）
  - 适用：抓取来源复杂、偶发元数据异常但仍希望保存图片。
  - 配置：保持默认（strictValidation: false），并结合观测计数做事后统计。

  ```js
  // 默认即为 false，如需显式：
  analysis: {
    preset: 'balanced',
    strictValidation: false
  }
  ```

- 内容类型放宽建议（Axios 获取阶段）
  - 来源规范：设为 `false` 或精简数组，仅放行 `image/*` 或少量类型。
  - 来源混杂：使用“数组模式”精确列出允许类型；如需放行缺失 content-type，数组中加入空字符串 `''`。

  ```js
  analysis: {
    acceptBinaryContentTypes: [
      'application/octet-stream',
      'application/x-binary',
      '', // 放行缺失 content-type
    ]
  }
  ```

- twoPhase 模式选择
  - 大批量/关注写盘次数与资源峰值：`mode: 'twoPhase'`，可配合 `maxHoldBuffers` 批量落盘并启用临时目录清理。
  - 小批量/简单直奔落盘：保持 `inline` 默认模式，逻辑更简单。

- 观测与调试项：
  - `analysis.enableDetailLog`：启用细粒度采样日志（默认 false）。
  - `analysis.logAnalyzeCost`：输出每张图的分析耗时（默认 false）。
  - `analysis.longCostWarnMs`：超过该耗时阈值输出 info 警告（默认 2000ms）。
  - `analysis.sampleRate`：采样率（每 N 张输出一次，默认 100）。

#### 内容类型放宽配置详解（Axios）

- 判定规则优先级（只会命中其中一种）：
  1. 当 `analysis.acceptBinaryContentTypes` 为“数组”时：仅按数组判定。始终允许 `image/*`；如需放行“缺失 content-type”，请在数组中加入空字符串 `''`。
  2. 当其为 `true` 时：放行 `image/*`、缺失 `content-type`、以及内置二进制类型（`application/octet-stream`、`application/x-binary`、`application/x-octet-stream`、`binary/octet-stream`）。当前内置白名单不包含 `application/binary`。
  3. 当其为 `false`（或未配置）时：仅放行 `image/*`。

- 按需配置（推荐，精细控制）：

```javascript
// config/config.js
analysis: {
  // 仅示例项，其他 analysis 字段按需保留
  acceptBinaryContentTypes: [
    'application/binary',
    'application/octet-stream',
    'application/x-binary',
    'application/x-octet-stream',
    'binary/octet-stream',
    '' // 允许缺失 content-type
  ]
}
```

- 最小化放行：只额外允许 `application/binary`（缺失 content-type 不放行）：

```javascript
analysis: {
  acceptBinaryContentTypes: ['application/binary']
}
```

- 代码层扩展“内置白名单”（全局放宽）：

```javascript
// crawler-runner/lib/fetcher/axiosFetcher.js（示例片段）
const isBinaryByDefaultList = (
  ctLower === 'application/octet-stream' ||
  // 如需全局放行 application/binary，可在此处加入：
  // ctLower === 'application/binary' ||
  ctLower === 'application/x-binary' ||
  ctLower === 'application/x-octet-stream' ||
  ctLower === 'binary/octet-stream'
)
```

说明：当你采用“数组模式”时，以上内置白名单不会参与判定；当设置为 `true` 时才会使用内置白名单并放行缺失 `content-type`。

#### 分析失败原因与可观测性

- 失败原因 keys（聚合并出现在日志/返回值中）：`unsupported_content_type`、`unknown_format`、`content_too_small`、`processing_timeout`、`memory_error`、`invalid_dimensions`、`metadata_error`。
- 当 `analysis.strictValidation = false` 且发生元数据解析异常时，将累加观测计数：`analysisObservations.metadata_parse_error_continue`，不阻塞下载保存。
- `processDownloadQueue()` 的返回对象包含 `analysisObservations` 字段；inline 与 twoPhase 两种路径都会统计。

### twoPhase 模式（P2）

- `analysis.mode`：`'inline' | 'twoPhase'`（默认 `inline`）。`twoPhase` 下将分两阶段执行：先全量分析并把有效项写入临时文件，再统一进入下载阶段。
- `analysis.tempDir`：临时文件目录（默认 `./.tmp_analysis`）。
- `analysis.cleanupTempOnStart`：是否在任务开始前清理临时目录（默认 `true`）。
- `analysis.cleanupTempOnComplete`：是否在下载阶段完成后删除临时文件（默认 `true`）。
- `analysis.maxHoldBuffers`：分析阶段内存短暂持有的 buffer 数量上限（默认 `0` 表示不持有，实时落盘）。当 >0 时，将在每批次内按阈值成组写入临时文件以减少 I/O 次数。

> 说明：旧字段 `retryDelaySeconds` 已弃用，仍被兼容为毫秒转换；请迁移到 `retryDelayMs`。


## 模块化架构

项目采用模块化设计，代码组织清晰：

- **config/**: 配置管理模块
- **lib/**: 核心功能模块
- **utils/**: 通用工具模块
- **index.js**: 简洁的主入口文件

## 📚 详细文档

- [本地HTML爬虫模式使用说明](./LOCAL_HTML_MODE.md)

## 开发和调试

```bash
# 直接运行主入口
node index.js
```

## 测试

- 运行：`npm test`
- 详细说明与最佳实践（如为何使用 mockClear 而非 mockReset）：参见 [tests/TESTING_GUIDE.md](./tests/TESTING_GUIDE.md)
