# 🚀 CLI/API 双模式迁移指南

## 📋 概述

本指南将帮助你将 thumb2original 从纯 CLI 工具升级为支持 CLI 和 API 双模式的项目。

---

## ✅ 已完成的改造

### 1. 新增文件

```
thumb2original/
├── lib/core/
│   └── ScraperEngine.js          # 核心引擎（CLI 和 API 共享）
├── server/
│   ├── index.js                  # API 服务器
│   └── TaskManager.js            # 任务管理器
├── cli.js                        # CLI 入口（新）
├── server.js                     # API 服务器入口
├── examples/
│   └── api-client.html           # Web 客户端示例
├── API_GUIDE.md                  # API 使用文档
└── MIGRATION_GUIDE.md            # 本文件
```

### 2. 修改的文件

- `package.json`: 添加新的依赖和脚本
- `index.js`: 保持向后兼容（仍可使用）

### 3. 核心架构变化

**之前的架构**:
```
index.js (CLI入口)
  ↓
直接调用业务逻辑
  ↓
浏览器 → 抓取 → 下载
```

**新的架构**:
```
┌─────────────┐         ┌─────────────┐
│   cli.js    │         │  server.js  │
│  (CLI模式)  │         │  (API模式)  │
└──────┬──────┘         └──────┬──────┘
       │                       │
       └───────┬───────────────┘
               ↓
       ┌──────────────┐
       │ScraperEngine │ (核心引擎)
       └──────┬───────┘
              ↓
       业务逻辑层 (lib/)
       ├── browserLauncher
       ├── pageLoader
       ├── imageExtractor
       ├── downloadQueue
       └── ...
```

---

## 📦 安装新依赖

```bash
npm install express cors socket.io
```

---

## 🎯 使用方式

### CLI 模式（保持不变）

```bash
# 方式一：原有方式（仍可用）
npm start
node index.js

# 方式二：新的 CLI 入口
npm run cli
node cli.js
```

### API 服务器模式（新增）

```bash
# 启动服务器
npm run server

# 开发模式（自动重启）
npm run dev

# 自定义端口
PORT=8080 npm run server
```

---

## 🔄 代码迁移指南

### 场景 1: 从代码中调用爬虫

**之前的方式**:
```javascript
import { scraperConfig } from './config/config.js'
import { runImageScraper } from './index.js'

await runImageScraper(scraperConfig)
```

**现在的方式**:
```javascript
import { ScraperEngine } from './lib/core/ScraperEngine.js'

const engine = new ScraperEngine(scraperConfig, {
  onProgress: (progress) => {
    console.log('进度:', progress)
  },
  onComplete: (summary) => {
    console.log('完成:', summary)
  }
})

await engine.run()
```

### 场景 2: 集成到现有 Express 应用

```javascript
import express from 'express'
import { ScraperServer } from './server/index.js'

const app = express()

// 创建爬虫服务器（但不启动独立的 HTTP 服务器）
const scraperServer = new ScraperServer({ standalone: false })

// 挂载到现有应用
app.use('/scraper', scraperServer.router)

app.listen(3000)
```

### 场景 3: 作为库使用

```javascript
import { TaskManager } from './server/TaskManager.js'

const taskManager = new TaskManager({ maxConcurrent: 3 })

// 监听任务事件
taskManager.on('task:completed', ({ taskId, result }) => {
  console.log(`任务 ${taskId} 完成`)
})

// 创建并运行任务
const taskId = taskManager.createTask({
  scrapeMode: 'single_page',
  targetUrl: 'https://example.com'
})

await taskManager.runTask(taskId)
```

---

## 🏗️ 核心组件说明

### 1. ScraperEngine (lib/core/ScraperEngine.js)

**职责**: 封装爬虫的完整生命周期

**特性**:
- ✅ 状态管理（idle, running, completed, failed）
- ✅ 进度回调
- ✅ 错误处理
- ✅ 资源清理

**使用示例**:
```javascript
const engine = new ScraperEngine(config, {
  onProgress: (progress) => {
    // 处理进度更新
    console.log(progress.status, progress.currentUrl)
  },
  onComplete: (summary) => {
    // 处理完成事件
    console.log('耗时:', summary.duration)
  },
  onError: (error) => {
    // 处理错误
    console.error(error)
  },
  onStatusChange: (status, data) => {
    // 处理状态变化
    console.log('状态:', status)
  }
})

// 运行
await engine.run()

// 获取状态
const status = engine.getStatus()

// 取消（如果运行中）
await engine.cancel()
```

### 2. TaskManager (server/TaskManager.js)

**职责**: 管理多个爬虫任务的队列和并发

**特性**:
- ✅ 任务队列
- ✅ 并发控制
- ✅ 事件系统
- ✅ 任务持久化（内存中）

**使用示例**:
```javascript
const manager = new TaskManager({ maxConcurrent: 3 })

// 创建任务
const taskId = manager.createTask(config)

// 运行任务
await manager.runTask(taskId)

// 监听事件
manager.on('task:progress', ({ taskId, progress }) => {
  console.log(`任务 ${taskId}:`, progress)
})

// 获取任务状态
const task = manager.getTask(taskId)

// 取消任务
await manager.cancelTask(taskId)

// 统计信息
const stats = manager.getStats()
```

### 3. ScraperServer (server/index.js)

**职责**: 提供 HTTP API 和 WebSocket 服务

**特性**:
- ✅ RESTful API
- ✅ WebSocket 实时推送
- ✅ CORS 支持
- ✅ 错误处理

**使用示例**:
```javascript
const server = new ScraperServer({
  port: 3000,
  host: '0.0.0.0',
  maxConcurrent: 3,
  corsOrigin: '*'
})

await server.start()

// 优雅退出
process.on('SIGTERM', async () => {
  await server.stop()
})
```

---

## 🔧 配置说明

### 环境变量

创建 `.env` 文件（可选）:

```env
# 服务器配置
PORT=3000
HOST=0.0.0.0
MAX_CONCURRENT=3
CORS_ORIGIN=*

# 爬虫配置（可选，优先级低于 config.js）
SCRAPE_MODE=single_page
IMAGE_MODE=originals_only
OUTPUT_DIR=./download
```

### 程序化配置

```javascript
// server-config.js
export const serverConfig = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT || '3'),
  corsOrigin: process.env.CORS_ORIGIN || '*'
}

// 使用
import { ScraperServer } from './server/index.js'
import { serverConfig } from './server-config.js'

const server = new ScraperServer(serverConfig)
await server.start()
```

---

## 📊 性能优化建议

### 1. 并发控制

```javascript
// 根据服务器资源调整并发数
const taskManager = new TaskManager({
  maxConcurrent: 5  // 增加并发数以提高吞吐量
})
```

### 2. 任务清理

```javascript
// 定期清理已完成任务以释放内存
setInterval(() => {
  const count = taskManager.cleanupCompletedTasks(3600000) // 1小时前的任务
  console.log(`清理了 ${count} 个任务`)
}, 600000) // 每10分钟清理一次
```

### 3. 日志级别

```javascript
// config/logConfig.js
export const defaultLogConfig = {
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  showDownloadProgress: false  // 生产环境关闭进度显示
}
```

---

## 🐛 常见问题

### Q1: 原有的 index.js 还能用吗？

**A**: 可以！为了向后兼容，`index.js` 保持不变。但建议迁移到新的 `cli.js`。

### Q2: 如何同时运行多个任务？

**A**: 使用 API 模式，TaskManager 会自动管理并发：

```javascript
const tasks = []
for (const url of urls) {
  const taskId = taskManager.createTask({ targetUrl: url })
  tasks.push(taskManager.runTask(taskId))
}
await Promise.all(tasks)
```

### Q3: 如何持久化任务状态？

**A**: 当前版本使用内存存储。如需持久化，可以扩展 TaskManager：

```javascript
// 示例：添加 Redis 持久化
import Redis from 'ioredis'

class PersistentTaskManager extends TaskManager {
  constructor(options) {
    super(options)
    this.redis = new Redis()
  }

  async createTask(config) {
    const taskId = super.createTask(config)
    await this.redis.set(`task:${taskId}`, JSON.stringify(this.getTask(taskId)))
    return taskId
  }
}
```

### Q4: 如何添加认证？

**A**: 在 Express 中添加中间件：

```javascript
// server/index.js
setupMiddleware() {
  this.app.use(cors())
  this.app.use(express.json())

  // 添加认证中间件
  this.app.use('/api', (req, res, next) => {
    const token = req.headers.authorization
    if (!token || token !== `Bearer ${process.env.API_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    next()
  })
}
```

### Q5: 如何部署到生产环境？

**A**: 推荐使用 PM2 或 Docker：

**使用 PM2**:
```bash
npm install -g pm2
pm2 start server.js --name thumb2original-api
pm2 save
pm2 startup
```

**使用 Docker**:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

---

## 📚 下一步

1. **测试新架构**: 运行 `npm run server` 启动 API 服务器
2. **尝试 API**: 打开 `examples/api-client.html` 测试 Web 界面
3. **阅读文档**: 查看 `API_GUIDE.md` 了解完整 API
4. **集成到项目**: 根据你的需求选择 CLI 或 API 模式

---

## 🤝 贡献

发现问题或有改进建议？欢迎提交 Issue 或 Pull Request！

---

## 📄 相关文档

- [API 使用指南](./API_GUIDE.md)
- [测试指南](./tests/TESTING_GUIDE.md)
- [本地 HTML 模式](./LOCAL_HTML_MODE.md)
