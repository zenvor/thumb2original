# Thumb2Original - 智能图片爬虫

一个基于 Node.js 和 Puppeteer 的智能网页图片爬虫工具，专门用于从缩略图获取原图。

## 特性

✅ **智能图片提取**：自动识别和提取网页中的图片链接  
✅ **多种下载方式**：支持 Puppeteer 和 Axios 两种下载方式  
✅ **智能Fallback机制**：Puppeteer下载失败时自动切换到Axios，提升成功率  
✅ **格式转换**：自动将 WebP 格式转换为 PNG  
✅ **防下载弹窗**：解决 Puppeteer 访问图片链接时的下载确认弹窗问题  
✅ **智能重试机制**：优雅的倒计时显示，避免日志刷屏  
✅ **高颜值进度条**：实时显示下载进度、速率、ETA等信息  
✅ **按需页面池管理**：智能页面池创建，大幅节省浏览器资源  
✅ **并发控制**：可配置的并发下载数量  
✅ **多种下载方式**：支持自动选择、强制Axios、Puppeteer优先等策略  

## 项目设置

```bash
npm install
```

## 运行

### 开发模式
```bash
npm run dev
```

### 演示模式
```bash
# 高颜值进度条演示
npm run demo:progress

# 静默进度条演示
npm run demo:quiet

# 传统日志模式演示
npm run demo:traditional
```

## 重要特性

### 🚀 智能Fallback机制

当Puppeteer下载失败时，系统会自动切换到Axios进行下载，显著提升下载成功率：

**工作原理：**
- ✅ 优先使用Puppeteer下载（支持复杂页面渲染）
- ✅ 检测各种失败场景：`net::ERR_ABORTED`、连接错误、超时等
- ✅ 失败时自动fallback到Axios下载同一URL
- ✅ 只有双重失败才记录为真正失败
- ✅ 下一个URL仍优先使用Puppeteer，保持策略一致性

**支持的错误类型：**
```
net::ERR_ABORTED                    // 连接中断
net::ERR_CONNECTION_CLOSED          // 连接关闭  
Navigation timeout exceeded         // 导航超时
Could not load body for request     // 请求体加载失败
```

### 🧠 按需页面池管理

全新的页面池管理策略，根据实际需求动态创建页面，大幅节省资源：

**核心优势：**
- ✅ **智能需求评估**：根据图片数量和网站特性评估所需页面数
- ✅ **资源优化**：对于纯Axios下载的网站，页面池大小为0，节省100%资源
- ✅ **精确匹配**：小型网站根据实际需求创建页面，避免资源浪费
- ✅ **性能保障**：大型网站保持足够的并发能力

**节省效果：**
- 小型网站（8张图）：从30个页面减少到8个，节省73.3%资源
- 普通相册（15张图）：节省50%页面数
- 特殊网站（如chpic.su）：完全使用Axios，页面池为0

### 🔄 优雅的重试倒计时

重新设计了重试机制，使用 `process.stdout.write` 替代传统日志输出：

**优点：**
- ✅ 在同一行显示倒计时，避免刷屏
- ✅ 彩色文字提示，更加美观
- ✅ 显示重试次数进度（第X/Y次）
- ✅ 倒计时结束自动清理输出行

**示例效果：**
```
🔄 重试倒计时 (第1/3次): 5s
```

### 📊 高颜值进度条

集成 cli-progress 库，提供专业级的进度条显示：

- ✅ 实时更新下载进度
- ✅ 显示下载速率、ETA、成功率
- ✅ 零刷屏设计，优雅的用户体验
- ✅ 可配置更新频率（realtime/fast/normal/slow）

### 🎯 灵活的下载策略

支持多种下载方式配置：

- **auto**：智能选择（默认），保持原有逻辑
- **axios**：强制使用Axios下载所有图片
- **puppeteer-priority**：优先使用Puppeteer，失败时fallback到Axios（推荐）

### Puppeteer 下载弹窗问题

当访问某些图片链接时，如果链接会直接触发文件下载，浏览器会弹出确认对话框。本项目已解决此问题：

- **浏览器启动优化**：添加禁用下载的启动参数
- **请求拦截**：设置请求拦截避免触发下载
- **优雅关闭**：实现浏览器的优雅关闭机制
- **独立下载页面**：为每个图片下载创建独立页面

详细信息请参考：[PUPPETEER_DOWNLOAD_FIX.md](./PUPPETEER_DOWNLOAD_FIX.md)

## 配置说明

主要配置文件：`src/config.js`

### 基础配置
```javascript
const config = {
  extractMode: 'singleSite',           // 解析模式: 'singleSite' | 'multipleSites'
  downloadMode: 'downloadOriginImagesByThumbnails', // 下载模式
  downloadMethod: 'auto',              // 下载方式: 'auto' | 'axios' | 'puppeteer-priority'
  url: 'https://example.com',          // 目标网站
  urls: [],                            // 多个目标网站
  retryInterval: 5,                    // 重试间隔(秒)
  retriesCount: 1,                     // 重试次数
  maxConcurrentRequests: 20,           // 最大并发数
  maxIntervalMs: 50,                   // 最大请求间隔
  minIntervalMs: 0,                    // 最小请求间隔
  downloadFolderPath: '',              // 下载文件夹路径
  logLevel: 'info',                    // 日志级别: 'debug' | 'info' | 'warn' | 'error'
}
```

### 浏览器配置
```javascript
browser: {
  headless: true,
  timeout: 30000,          // 浏览器启动超时（毫秒）
  viewport: {              // 页面视口配置
    width: 1920,
    height: 1080
  }
},
```

### 超时配置
```javascript
timeouts: {
  pageLoad: 30000,         // 页面加载超时（毫秒）
  imageDownload: 30000     // 图片下载超时（毫秒）
},
```

### 进度条配置
```javascript
enableProgressBar: true,             // 启用进度条
progressUpdateFrequency: 'realtime', // 进度条更新频率: 'realtime' | 'fast' | 'normal' | 'slow'
```

### 页面池配置
```javascript
pagePoolStrategy: 'auto', // 页面池策略: 'auto' | 'reuse' | 'progressive'
pagePool: {
  // PWS (Page Weight Score) 权重配置
  pws: {
    weights: {
      images: 0.3,      // 图片数量权重 (30%)
      domNodes: 0.25,   // DOM节点权重 (25%) 
      bytes: 0.25,      // 字节数权重 (25%)
      heap: 0.2         // 堆内存权重 (20%)
    }
  },
  // 更多详细配置...
}
```

## 项目结构

```
thumb2original/
├── src/
│   ├── config.js              # 主配置文件
│   ├── main.js                # 项目入口
│   ├── core/                  # 核心模块
│   │   ├── Crawler.js         # 爬虫主逻辑
│   │   ├── ImageExtractor.js  # 图片提取器
│   │   ├── download/          # 下载管理模块
│   │   ├── image/             # 图片处理模块
│   │   └── utils/             # 核心工具类
│   ├── utils/                 # 通用工具类
│   └── logger/                # 日志模块
├── download/                  # 下载文件夹
├── package.json               # 项目依赖
└── README.md                  # 项目文档
```

## 工具类

### RetryCountdown 重试倒计时工具

位置：`src/utils/RetryCountdown.js`

**功能：**
- 提供优雅的倒计时显示
- 支持自定义颜色和前缀文字
- 自动清理输出行
- 支持异步回调操作

**使用示例：**
```javascript
import { RetryCountdown } from './src/utils/RetryCountdown.js'

// 快速使用
await RetryCountdown.countdown(5, () => {
  console.log('重试操作!')
})

// 自定义样式
await RetryCountdown.countdown(10, async () => {
  await performRetry()
}, {
  prefix: '🔄 自定义重试倒计时',
  color: '\x1b[36m' // 青色
})
```

## 依赖

- **puppeteer**: 浏览器自动化
- **axios**: HTTP请求库
- **sharp**: 图片处理
- **cli-progress**: 进度条显示
- **consola**: 增强日志库
- **lodash**: 工具函数库

## 版本要求

- Node.js >= 16.0.0
- npm >= 7.0.0

## 许可证

ISC
