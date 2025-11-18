# thumb2original

一个功能强大的图片爬虫工具，支持从网页和本地HTML文件中提取图片，自动将缩略图转换为原图，并提供完整的图片分析和下载功能。

## ✨ 亮点

- 🚀 **双模式运行**：CLI 命令行模式 + API 服务器模式
- 🎯 **智能转换**：自动识别并转换缩略图为原图
- 🔍 **图片分析**：提取图片元数据（尺寸、格式、大小等）
- 🛡️ **反检测**：集成 Puppeteer Stealth 绕过反爬虫系统
- 📦 **数据库支持**：SQLite 数据库持久化存储
- ⚡ **实时进度**：WebSocket 实时推送任务进度
- 🌐 **API 服务**：类似 extract.pics 的 RESTful API

## 📋 功能特性

### 核心功能

- **🎭 双运行模式**
  - **CLI 模式**：命令行爬虫，适合批量处理和自动化脚本
  - **API 服务器模式**：提供 HTTP API + WebSocket，适合 Web 应用集成

- **🔄 多种爬虫模式**
  - `single_page`：单页面爬虫
  - `multiple_pages`：多页面爬虫
  - `local_html`：本地 HTML 文件爬虫

- **🖼️ 智能图片处理**
  - 自动识别图片格式（JPEG, PNG, WebP, AVIF, SVG 等）
  - 缩略图到原图 URL 智能转换
  - 原图匹配功能（Try to Match Original）
  - 图片元数据提取（尺寸、格式、大小）
  - 格式转换支持（WebP → PNG/JPEG 等）
  - 图片去重处理

- **⚡ 高级下载功能**
  - 并发下载控制（可配置）
  - 智能重试机制
  - 随机延迟防反爬
  - 进度实时显示
  - 两阶段下载模式（分析 + 下载）

- **🛡️ 反检测功能**
  - 集成 puppeteer-extra + stealth 插件
  - 自动隐藏浏览器自动化痕迹
  - 模拟真实用户行为
  - 绕过 Cloudflare 等反爬虫系统
  - 可配置的反检测强度

- **💾 数据库支持**
  - SQLite 数据库持久化
  - 任务状态管理
  - 图片数据缓存
  - 自动清理过期数据

- **🌐 API 服务**
  - RESTful API 接口
  - WebSocket 实时进度推送
  - 支持基础模式（仅 URL）和高级模式（完整分析）
  - 单图/批量 ZIP 下载
  - CORS 跨域支持

## 🚀 快速开始

### 安装依赖

```bash
# 安装项目依赖
npm install

# 安装 Chrome 浏览器（Puppeteer 需要）
npx puppeteer browsers install chrome
```

### 运行模式

#### 1️⃣ CLI 模式（命令行爬虫）

```bash
# 配置 config/config.js 后运行
npm start
```

#### 2️⃣ API 服务器模式

```bash
# 开发模式（自动重载）
npm run dev

# 生产模式
npm run server
```

服务启动后：
- HTTP API: `http://localhost:3000`
- WebSocket: `ws://localhost:8080`
- 健康检查: `http://localhost:3000/health`

详细 API 文档请参考：[API.md](./API.md)

## 📖 CLI 模式使用

### 1. 配置爬虫

编辑 `config/config.js` 配置文件：

#### 网页爬虫模式

```javascript
const scraperConfig = {
  scrapeMode: 'single_page',  // 'single_page' 或 'multiple_pages'
  targetUrl: 'https://example.com/gallery',
  imageMode: 'originals_only', // 'all' 或 'originals_only'

  // 反检测配置
  antiDetection: {
    enableStealth: true,
    enableAdvancedArgs: true,
  },

  // 下载与重试
  maxRetries: 5,
  retryDelayMs: 5000,
  concurrentDownloads: 10,
}
```

#### 本地 HTML 模式

```javascript
const scraperConfig = {
  scrapeMode: 'local_html',
  htmlDirectory: './html',
  imageMode: 'originals_only',

  // 记忆功能（避免重复处理）
  enableMemory: true,
  memoryDirectory: './memory',
}
```

> 📚 详细配置说明请参考下方的[配置选项](#配置选项)章节

### 2. 运行爬虫

```bash
npm start
```

## ⚙️ 配置选项

### 基础配置

| 配置项 | 说明 | 可选值 | 默认值 |
|--------|------|--------|--------|
| `scrapeMode` | 爬虫模式 | `single_page`, `multiple_pages`, `local_html` | - |
| `imageMode` | 图片模式 | `all`, `originals_only` | `all` |
| `targetUrl` | 目标网页URL | URL字符串 | - |
| `htmlDirectory` | 本地HTML目录 | 路径字符串 | `./html` |
| `outputDirectory` | 输出目录 | 路径字符串 | `./download` |

### 下载配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `concurrentDownloads` | 并发下载数 | 10 |
| `maxRetries` | 最大重试次数 | 5 |
| `retryDelayMs` | 重试间隔（毫秒） | 5000 |
| `minRequestDelayMs` | 批次最小延迟（毫秒） | 2000 |
| `maxRequestDelayMs` | 批次最大延迟（毫秒） | 4000 |

### 反检测配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `antiDetection.enableStealth` | 启用 Stealth 插件 | `true` |
| `antiDetection.enableAdvancedArgs` | 启用高级浏览器参数 | `true` |
| `antiDetection.windowSize` | 浏览器窗口大小 | `'1366,768'` |
| `antiDetection.userAgent` | 自定义 User Agent | `null` |

### 数据库配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `database.dbPath` | 数据库文件路径 | `'./data/images.db'` |
| `database.autoCleanup` | 自动清理过期数据 | `true` |
| `database.cleanupInterval` | 清理间隔（毫秒） | `600000` (10分钟) |
| `database.taskRetentionMs` | 任务保留时长（毫秒） | `3600000` (1小时) |

### 高级配置

#### 图片分析模式

```javascript
analysis: {
  mode: 'inline',              // 'inline' 或 'twoPhase'
  strictValidation: false,     // 严格元数据校验
  acceptBinaryContentTypes: true, // 接受二进制内容类型
  enableDetailLog: false,      // 启用详细日志
}
```

#### 图片格式转换

```javascript
format: {
  convertTo: 'none',  // 'jpeg' | 'png' | 'webp' | 'tiff' | 'none'
}
```

> 📚 更多高级配置选项和详细说明，请查看 `config/config.js` 文件中的注释


## 🏗️ 项目架构

```
thumb2original/
├── config/              # 配置文件
│   ├── config.js        # 主配置文件
│   └── database-example.js
├── lib/                 # 核心功能模块
│   ├── database/        # 数据库相关
│   ├── fetcher/         # 图片获取策略
│   ├── imageExtractor.js    # 图片提取
│   ├── imageAnalyzer.js     # 图片分析
│   ├── downloadQueue.js     # 下载队列
│   └── ...
├── server/              # API 服务器
│   ├── app.js           # Koa 应用
│   ├── routes/          # API 路由
│   ├── services/        # 业务服务
│   └── websocket/       # WebSocket 管理
├── utils/               # 工具函数
├── tests/               # 测试文件
├── index.js             # CLI 模式入口
└── server.js            # API 服务器入口
```

## 📚 文档

- [API 文档](./API.md) - HTTP API 和 WebSocket 接口说明
- [测试指南](./tests/TESTING_GUIDE.md) - 测试编写规范和最佳实践

## 🧪 测试

```bash
# 运行测试
npm test

# 监听模式
npm run test:watch
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

ISC License
