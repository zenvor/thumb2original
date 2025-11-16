# 🏛️ 架构设计文档

## 📋 目录

1. [系统架构](#系统架构)
2. [核心模块](#核心模块)
3. [数据流](#数据流)
4. [设计决策](#设计决策)
5. [扩展性](#扩展性)

---

## 🎯 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户层                                │
├─────────────┬───────────────────────────────────────────────┤
│   CLI 工具  │              Web 客户端                        │
│  (cli.js)   │         (浏览器/HTTP客户端)                    │
└──────┬──────┴────────────────┬──────────────────────────────┘
       │                       │
       │                       ↓
       │              ┌─────────────────┐
       │              │  HTTP Server    │
       │              │  (Express)      │
       │              └────────┬────────┘
       │                       │
       └───────┬───────────────┤
               ↓               ↓
       ┌──────────────┐  ┌─────────────┐
       │ScraperEngine │  │TaskManager  │
       │ (核心引擎)   │  │ (任务队列)  │
       └──────┬───────┘  └──────┬──────┘
              │                 │
              └────────┬────────┘
                       ↓
       ┌────────────────────────────────┐
       │       业务逻辑层 (lib/)         │
       ├────────────────────────────────┤
       │ • Browser Launcher (浏览器)     │
       │ • Page Loader (页面加载)        │
       │ • Image Extractor (图片提取)    │
       │ • Image Fetcher (图片获取)      │
       │ • Image Analyzer (图片分析)     │
       │ • Download Queue (下载队列)     │
       │ • File Manager (文件管理)       │
       └────────────────────────────────┘
                       ↓
       ┌────────────────────────────────┐
       │      工具层 (utils/)            │
       ├────────────────────────────────┤
       │ • Logger (日志)                 │
       │ • Errors (错误处理)             │
       │ • Image Utils (图片工具)        │
       │ • File Utils (文件工具)         │
       └────────────────────────────────┘
```

---

## 🧩 核心模块

### 1. ScraperEngine (lib/core/ScraperEngine.js)

**职责**: 爬虫核心引擎，封装完整的爬取生命周期

**关键特性**:
- 状态管理（idle → running → completed/failed）
- 事件驱动（progress, complete, error, statusChange）
- 资源管理（浏览器生命周期）
- 错误恢复

**状态机**:
```
     idle
      ↓
  initializing
      ↓
    running ──→ failed
      ↓
  completed
```

**公共接口**:
```javascript
class ScraperEngine {
  constructor(config, options)
  async run()                    // 运行爬虫
  async cancel()                 // 取消运行
  getStatus()                    // 获取状态快照
  updateStatus(status, data)     // 更新状态
  emitProgress(data)             // 发送进度
}
```

### 2. TaskManager (server/TaskManager.js)

**职责**: 任务队列管理和并发控制

**关键特性**:
- 任务生命周期管理
- 并发数控制
- 队列调度
- 事件广播

**任务状态**:
```
pending → queued → running → completed/failed/cancelled
```

**公共接口**:
```javascript
class TaskManager extends EventEmitter {
  createTask(config, options)    // 创建任务
  async runTask(taskId)          // 运行任务
  getTask(taskId)                // 获取任务状态
  getAllTasks()                  // 获取所有任务
  async cancelTask(taskId)       // 取消任务
  deleteTask(taskId)             // 删除任务
  cleanupCompletedTasks(ms)      // 清理已完成任务
  getStats()                     // 统计信息
}
```

### 3. ScraperServer (server/index.js)

**职责**: HTTP API 服务器和 WebSocket 服务

**关键特性**:
- RESTful API 路由
- WebSocket 实时通讯
- CORS 支持
- 错误处理中间件

**API 端点**:
```
GET    /health                    # 健康检查
POST   /api/tasks                 # 创建任务
GET    /api/tasks                 # 获取所有任务
GET    /api/tasks/:taskId         # 获取任务状态
POST   /api/tasks/:taskId/cancel  # 取消任务
DELETE /api/tasks/:taskId         # 删除任务
POST   /api/tasks/cleanup         # 清理已完成任务
GET    /api/docs                  # API 文档
```

**WebSocket 事件**:
```
task:created      # 任务创建
task:queued       # 任务进入队列
task:started      # 任务开始
task:progress     # 任务进度
task:status       # 状态变化
task:completed    # 任务完成
task:failed       # 任务失败
task:cancelled    # 任务取消
task:deleted      # 任务删除
```

### 4. 业务逻辑层 (lib/)

#### Browser Launcher
```javascript
// lib/browserLauncher.js
export async function launchBrowser(config)
```
- 启动 Puppeteer 浏览器
- 应用反检测配置
- 连接监控

#### Page Loader
```javascript
// lib/pageLoader.js
export async function loadAndScrollPage(page, url, config)
```
- 页面加载和导航
- 滚动加载
- 等待策略

#### Image Extractor
```javascript
// lib/imageExtractor.js
export async function extractImageUrls(page, url, options)
```
- 从页面提取图片 URL
- 支持多种图片来源（img, srcset, CSS 等）
- URL 去重和验证

#### Image Mode Processor
```javascript
// lib/imageModeProcessor.js
export async function processUrlsByImageMode(page, urls, baseUrl, mode, config)
```
- 缩略图转原图
- 图片 URL 转换规则
- 站点特定处理

#### Download Queue
```javascript
// lib/downloadQueue.js
export async function processDownloadQueue(urls, targetDir, context, imageList)
```
- 并发下载控制
- 重试机制
- 进度跟踪
- 两阶段处理（twoPhase mode）

#### Image Fetcher
```javascript
// lib/imageFetcher.js
export async function fetchImage(url, browser, maxRetries, config)
```
- 图片下载（Axios/Puppeteer 双策略）
- 内容类型验证
- 错误处理

#### Image Analyzer
```javascript
// lib/imageAnalyzer.js
export async function analyzeImage(buffer, url, config)
```
- 图片格式识别
- 尺寸提取
- 元数据解析
- 验证规则

#### File Manager
```javascript
// lib/fileManager.js
export async function saveImage(buffer, filePath, url, stats, imageList, config, analysisResult)
export async function createDownloadDirectory(baseDir, title)
```
- 文件保存
- 格式转换
- 目录管理
- 文件名生成和去重

---

## 🔄 数据流

### CLI 模式数据流

```
1. 用户配置 (config/config.js)
   ↓
2. cli.js 初始化
   ↓
3. 创建 ScraperEngine
   ↓
4. engine.run()
   ├─→ 验证配置
   ├─→ 启动浏览器
   ├─→ 加载页面
   ├─→ 提取图片 URL
   ├─→ 处理图片模式
   ├─→ 下载队列处理
   │   ├─→ 并发获取图片
   │   ├─→ 分析图片
   │   └─→ 保存文件
   └─→ 清理资源
   ↓
5. 输出结果到控制台
```

### API 模式数据流

```
1. HTTP 请求 (POST /api/tasks)
   ↓
2. ScraperServer 接收请求
   ↓
3. TaskManager.createTask(config)
   ↓
4. TaskManager.runTask(taskId)
   ├─→ 检查并发数
   ├─→ 如超出 → 进入队列
   └─→ 否则 → 创建 ScraperEngine
   ↓
5. engine.run()
   ├─→ (同 CLI 模式)
   ├─→ 每个步骤触发事件
   │   ├─→ task:progress
   │   ├─→ task:status
   │   └─→ task:completed/failed
   └─→ 事件通过 WebSocket 推送
   ↓
6. 返回任务状态 (HTTP 响应)
```

### 事件流

```
TaskManager Events:
  task:created ──┐
  task:started ──┤
  task:progress ─┼─→ ScraperServer ──→ Socket.IO ──→ Web 客户端
  task:completed─┤
  task:failed ───┘

ScraperEngine Callbacks:
  onProgress ────→ TaskManager ──→ emit('task:progress')
  onComplete ────→ TaskManager ──→ emit('task:completed')
  onError ───────→ TaskManager ──→ emit('task:failed')
  onStatusChange ─→ TaskManager ──→ emit('task:status')
```

---

## 🎨 设计决策

### 1. 为什么分离 ScraperEngine？

**决策**: 将核心爬虫逻辑抽象为独立的 `ScraperEngine` 类

**原因**:
- ✅ **复用性**: CLI 和 API 模式共享相同逻辑
- ✅ **可测试性**: 便于单元测试和集成测试
- ✅ **可维护性**: 单一职责，逻辑清晰
- ✅ **扩展性**: 可以轻松添加新的运行模式（如 GUI）

### 2. 为什么使用 EventEmitter？

**决策**: TaskManager 继承 EventEmitter

**原因**:
- ✅ **解耦**: 任务执行和状态通知解耦
- ✅ **实时性**: 支持实时进度推送
- ✅ **灵活性**: 订阅者可以选择监听哪些事件
- ✅ **Node.js 原生**: 无需额外依赖

### 3. 为什么选择 Express？

**决策**: 使用 Express 作为 HTTP 框架

**原因**:
- ✅ **成熟稳定**: 业界标准，社区支持好
- ✅ **中间件生态**: 丰富的插件（CORS, body-parser 等）
- ✅ **简单易用**: 学习曲线平缓
- ✅ **性能足够**: 对于此场景性能已足够

**备选方案**:
- Fastify（更高性能，但生态较小）
- Koa（更现代，但需要更多配置）

### 4. 为什么使用 Socket.IO？

**决策**: 使用 Socket.IO 实现 WebSocket

**原因**:
- ✅ **兼容性**: 自动降级到轮询
- ✅ **房间/命名空间**: 便于实现订阅机制
- ✅ **重连机制**: 自动处理断线重连
- ✅ **双向通信**: 支持客户端主动订阅

### 5. 任务状态为什么存在内存中？

**决策**: 当前版本任务状态存储在内存（Map）

**原因**:
- ✅ **简单**: 无需额外的数据库依赖
- ✅ **快速**: 读写性能最佳
- ✅ **适用场景**: 对于单机部署足够

**后续扩展**:
```javascript
// 可选：添加 Redis 持久化
class PersistentTaskManager extends TaskManager {
  constructor(options) {
    super(options)
    this.redis = new Redis(options.redisUrl)
  }

  async createTask(config) {
    const taskId = super.createTask(config)
    await this.redis.set(`task:${taskId}`, JSON.stringify(this.getTask(taskId)))
    return taskId
  }

  async getTask(taskId) {
    const cached = await this.redis.get(`task:${taskId}`)
    if (cached) return JSON.parse(cached)
    return super.getTask(taskId)
  }
}
```

### 6. 为什么保留 index.js？

**决策**: 保持 `index.js` 不变，新增 `cli.js`

**原因**:
- ✅ **向后兼容**: 不破坏现有用户的使用方式
- ✅ **渐进式迁移**: 用户可以选择何时迁移
- ✅ **文档清晰**: 新用户使用 `cli.js`，老用户继续使用 `index.js`

---

## 🚀 扩展性

### 1. 添加新的存储后端

```javascript
// lib/storage/StorageAdapter.js
export class StorageAdapter {
  async save(key, value) { throw new Error('Not implemented') }
  async load(key) { throw new Error('Not implemented') }
  async delete(key) { throw new Error('Not implemented') }
}

// lib/storage/RedisAdapter.js
export class RedisAdapter extends StorageAdapter {
  constructor(redisUrl) {
    super()
    this.redis = new Redis(redisUrl)
  }

  async save(key, value) {
    await this.redis.set(key, JSON.stringify(value))
  }

  async load(key) {
    const data = await this.redis.get(key)
    return data ? JSON.parse(data) : null
  }
}

// 使用
const taskManager = new TaskManager({
  storage: new RedisAdapter('redis://localhost')
})
```

### 2. 添加认证中间件

```javascript
// server/middleware/auth.js
export function authMiddleware(options) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '')

    if (!token || !validateToken(token)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    req.user = decodeToken(token)
    next()
  }
}

// 在 server/index.js 中使用
import { authMiddleware } from './middleware/auth.js'

setupRoutes() {
  this.app.use('/api', authMiddleware({ secret: process.env.JWT_SECRET }))
  // ... 其他路由
}
```

### 3. 添加速率限制

```javascript
import rateLimit from 'express-rate-limit'

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100 // 限制 100 个请求
})

this.app.use('/api', limiter)
```

### 4. 添加自定义爬虫策略

```javascript
// lib/strategies/CustomStrategy.js
export class CustomStrategy {
  async extract(page, url, config) {
    // 自定义提取逻辑
  }
}

// 在 ScraperEngine 中注册
engine.registerStrategy('custom', new CustomStrategy())
```

### 5. 添加 GraphQL API

```javascript
import { ApolloServer } from '@apollo/server'
import { expressMiddleware } from '@apollo/server/express4'

const typeDefs = `
  type Task {
    id: ID!
    status: String!
    progress: JSON
  }

  type Query {
    task(id: ID!): Task
    tasks: [Task!]!
  }

  type Mutation {
    createTask(config: JSON!): Task!
    cancelTask(id: ID!): Task!
  }
`

const resolvers = {
  Query: {
    task: (_, { id }) => taskManager.getTask(id),
    tasks: () => taskManager.getAllTasks()
  },
  Mutation: {
    createTask: (_, { config }) => {
      const taskId = taskManager.createTask(config)
      taskManager.runTask(taskId)
      return taskManager.getTask(taskId)
    },
    cancelTask: async (_, { id }) => {
      await taskManager.cancelTask(id)
      return taskManager.getTask(id)
    }
  }
}

const apolloServer = new ApolloServer({ typeDefs, resolvers })
await apolloServer.start()

this.app.use('/graphql', expressMiddleware(apolloServer))
```

### 6. 集成消息队列

```javascript
import Bull from 'bull'

class QueuedTaskManager extends TaskManager {
  constructor(options) {
    super(options)
    this.queue = new Bull('scraper-tasks', options.redisUrl)

    this.queue.process(async (job) => {
      const { config } = job.data
      const engine = new ScraperEngine(config)
      return await engine.run()
    })
  }

  async runTask(taskId) {
    const task = this.getTask(taskId)
    await this.queue.add({ config: task.config })
  }
}
```

---

## 📊 性能考虑

### 1. 并发控制

```javascript
// 根据 CPU 核心数动态调整
import os from 'os'

const maxConcurrent = Math.max(1, os.cpus().length - 1)
const taskManager = new TaskManager({ maxConcurrent })
```

### 2. 内存管理

```javascript
// 定期清理已完成任务
setInterval(() => {
  const deleted = taskManager.cleanupCompletedTasks(3600000) // 1小时
  if (deleted > 0) {
    logger.info(`清理了 ${deleted} 个已完成任务`)
  }
}, 600000) // 每10分钟
```

### 3. 资源限制

```javascript
// 限制任务队列大小
class LimitedTaskManager extends TaskManager {
  createTask(config, options) {
    if (this.tasks.size >= this.maxTasks) {
      throw new Error('任务队列已满')
    }
    return super.createTask(config, options)
  }
}
```

---

## 🔒 安全考虑

### 1. 输入验证

```javascript
import Joi from 'joi'

const configSchema = Joi.object({
  scrapeMode: Joi.string().valid('single_page', 'multiple_pages', 'local_html').required(),
  targetUrl: Joi.string().uri().when('scrapeMode', {
    is: 'single_page',
    then: Joi.required()
  }),
  imageMode: Joi.string().valid('all', 'originals_only').required()
})

// 在 API 中使用
app.post('/api/tasks', async (req, res) => {
  const { error, value } = configSchema.validate(req.body.config)
  if (error) {
    return res.status(400).json({ error: error.message })
  }
  // ... 创建任务
})
```

### 2. CSRF 保护

```javascript
import csrf from 'csurf'

const csrfProtection = csrf({ cookie: true })
this.app.use(csrfProtection)
```

### 3. HTTPS 强制

```javascript
this.app.use((req, res, next) => {
  if (!req.secure && process.env.NODE_ENV === 'production') {
    return res.redirect('https://' + req.headers.host + req.url)
  }
  next()
})
```

---

## 📚 相关文档

- [API 使用指南](./API_GUIDE.md)
- [迁移指南](./MIGRATION_GUIDE.md)
- [测试指南](./tests/TESTING_GUIDE.md)
