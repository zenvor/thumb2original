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

> 说明：旧字段 `retryDelaySeconds` 已弃用，仍被兼容为毫秒转换；请迁移到 `retryDelayMs`。

## 目录结构

```
thumb2original/
├── config/                  # 配置文件
│   └── config.js           # 主配置文件
├── lib/                     # 核心功能模块
│   ├── downloadManager.js  # 下载管理
│   ├── htmlProcessor.js    # HTML处理
│   └── imageDownloader.js  # 图片下载
├── utils/                   # 工具函数
│   ├── logger.js           # 日志工具
│   ├── imageUtils.js       # 图片处理工具
│   ├── fileUtils.js        # 文件操作工具
│   ├── fileNameSanitizer.js # 文件名处理
│   └── imageUrlConverter.js # URL转换
├── html/                    # 本地HTML文件目录
│   └── 网站名称/
│       ├── page1.html
│       └── page2.html
├── download/                # 下载的图片目录
│   ├── 页面标题1/
│   └── 页面标题2/
├── index.js                # 主入口文件
├── package.json
└── README.md
```

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
