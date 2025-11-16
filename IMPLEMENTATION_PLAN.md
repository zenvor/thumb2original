# thumb2original API 实现计划

## 📋 项目目标

将 thumb2original 改造为支持 **CLI 和 API 双模式**的项目：
- **CLI 模式**：保持原有功能，直接下载图片到本地
- **API 模式**：类似 extract.pics，提供异步提取 API，返回图片元数据

---

## 🎯 核心需求

### 1. API 功能
- ✅ 创建提取任务
- ✅ 查询任务状态和图片列表
- ✅ SSE 实时进度推送
- ✅ 下载单张图片
- ✅ 下载多张图片（ZIP）

### 2. 技术选型
- **进度推送**：Server-Sent Events (SSE)
- **Web 框架**：Koa（按用户要求）
- **存储方式**：内存存储（MemoryStorage + 图片 Buffer 缓存）
- **爬虫模式**：复用现有逻辑，支持 basic 和 advanced 两种模式

### 3. 架构原则
- ✅ CLI 和 API 共享核心爬虫逻辑
- ✅ 支持 basic（仅提取）和 advanced（完整分析）两种模式
- ✅ 图片 Buffer 临时缓存，支持下载功能
- ✅ 轻量级设计，易于部署

---

## 📁 文件结构规划

```
thumb2original/
├── index.js                          # CLI 模式入口（保持不变）
├── server.js                         # API 服务器入口（新增）
│
├── server/                           # API 服务器模块（新增）
│   ├── app.js                        # Koa 应用配置
│   ├── routes/
│   │   ├── extractions.js            # 提取任务路由
│   │   └── downloads.js              # 下载路由
│   ├── services/
│   │   ├── ExtractionService.js      # 提取服务（核心业务逻辑）
│   │   └── DownloadService.js        # 下载服务
│   ├── storage/
│   │   ├── MemoryStorage.js          # 任务数据存储
│   │   └── ImageCache.js             # 图片 Buffer 缓存
│   └── sse/
│       └── SSEManager.js             # SSE 管理器
│
├── lib/                              # 核心爬虫逻辑（现有，复用）
│   ├── browserLauncher.js
│   ├── pageLoader.js
│   ├── imageExtractor.js
│   ├── imageModeProcessor.js
│   ├── downloadQueue.js
│   └── ...
│
├── utils/                            # 工具函数（现有）
├── config/                           # 配置文件（现有）
└── tests/                            # 测试文件（现有）
```

---

## 🔧 API 设计

### 端点列表

| HTTP 方法 | 路径 | 功能描述 |
|-----------|------|----------|
| POST | `/api/extractions` | 创建提取任务 |
| GET | `/api/extractions/:id` | 查询任务状态和图片列表 |
| GET | `/api/extractions/:id/stream` | SSE 实时进度推送 |
| POST | `/api/downloads/single` | 下载单张图片 |
| POST | `/api/downloads/multiple` | 下载多张图片（ZIP） |
| GET | `/health` | 健康检查 |

### 数据结构

#### 任务对象 (Extraction)
```json
{
  "id": "1234567890-abc123",
  "url": "https://example.com",
  "hash": "sha1_hash",
  "status": "pending|running|done|failed",
  "message": null,
  "status_changed_at": "2025-11-16T15:03:55.000000Z",
  "trigger": "api|web",
  "options": {
    "mode": "basic|advanced",
    "ignoreInlineImages": false
  },
  "images": null | [...],
  "images_count": 0,
  "user_id": null,
  "project_id": null,
  "created_at": "2025-11-16T15:03:55.000000Z",
  "updated_at": "2025-11-16T15:03:55.000000Z"
}
```

#### 图片对象 (Image)

**basic 模式**：
```json
{
  "id": "uuid",
  "url": "https://..."
}
```

**advanced 模式**：
```json
{
  "id": "uuid",
  "url": "https://...",
  "name": "filename",
  "basename": "filename.jpg",
  "type": "png|jpeg|webp|...",
  "size": 185446,
  "width": 1920,
  "height": 1080
}
```

#### SSE 事件格式
```javascript
// 连接建立
data: {"type":"connected","message":"SSE connection established"}

// 进度更新
data: {"type":"progress","message":"Loading page...","progress":20}
data: {"type":"progress","message":"Scrolling down...","progress":40}
data: {"type":"progress","message":"Finding images...","progress":60}
data: {"type":"progress","message":"Analyzing images...","progress":80}

// 完成
data: {"type":"complete","images_count":21,"status":"done"}

// 错误
data: {"type":"error","message":"Error message"}
```

#### 下载端点

**下载单张图片**：
```http
POST /api/downloads/single
Content-Type: application/json

{
  "extractionId": "1234567890-abc123",
  "imageId": "uuid"
}

Response:
Content-Type: image/jpeg (或 image/png, image/webp 等)
Content-Disposition: attachment; filename="image-name.jpeg"
Body: 图片二进制数据
```

**下载多张图片（ZIP）**：
```http
POST /api/downloads/multiple
Content-Type: application/json

{
  "extractionId": "1234567890-abc123",
  "imageIds": ["uuid1", "uuid2", "uuid3"]
}

Response:
Content-Type: application/zip
Content-Disposition: attachment; filename="images.zip"
Body: ZIP 压缩包二进制数据
```

**注意**：
- 下载端点需要先完成提取任务（status 为 'done'）
- 图片 Buffer 需要临时缓存在内存中
- ZIP 文件名格式：`{domain}-{timestamp}.zip`
- 确保使用正确的文件扩展名

#### 提取选项

创建提取任务时支持以下选项：

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `url` | String | ✅ | - | 要提取的网页 URL |
| `mode` | String | ❌ | `basic` | 提取模式：`basic` 或 `advanced` |
| `ignoreInlineImages` | Boolean | ❌ | `false` | 是否忽略内联图片（SVG、Base64 等） |

**模式对比**：

| 特性 | basic 模式 | advanced 模式 |
|------|-----------|---------------|
| 查找图片 | ✅ | ✅ |
| 分析元数据 | ❌ | ✅ |
| 返回字段 | id, url | id, url, name, basename, type, size, width, height |
| 处理速度 | 快 | 慢 |
| 适用场景 | 仅需要 URL 列表 | 需要完整图片信息 |

**示例请求**：
```json
{
  "url": "https://example.com",
  "mode": "advanced",
  "ignoreInlineImages": true
}
```

---

## 🏗️ 核心模块设计

### 1. SSEManager (server/sse/SSEManager.js)
**职责**：管理 SSE 连接和事件推送

**核心方法**：
- `addConnection(taskId, res)` - 添加 SSE 连接
- `removeConnection(taskId, res)` - 移除连接
- `sendProgress(taskId, message, progress)` - 发送进度
- `sendComplete(taskId, data)` - 发送完成事件
- `sendError(taskId, error)` - 发送错误事件

**特点**：
- 支持一个任务多个订阅者
- 自动清理过期连接
- 统一的事件格式

### 2. MemoryStorage (server/storage/MemoryStorage.js)
**职责**：存储提取任务数据

**核心方法**：
- `create(taskData)` - 创建任务
- `get(taskId)` - 获取任务
- `update(taskId, updates)` - 更新任务
- `cleanup(olderThanMs)` - 清理旧任务
- `getStats()` - 获取统计信息

**特点**：
- 使用 Map 存储
- 自动添加时间戳
- 支持按状态过滤

### 3. ExtractionService (server/services/ExtractionService.js)
**职责**：处理图片提取任务的核心业务逻辑

**核心方法**：
- `createExtraction(url, options)` - 创建提取任务
- `executeExtraction(taskId)` - 执行提取任务
- `formatImages(validEntries)` - 格式化图片数据

**工作流程**：
```
1. 创建任务 → 存储到 MemoryStorage
2. 异步执行：
   a. 启动浏览器 (progress: 5-10%)
   b. 加载页面 (progress: 20%)
   c. 滚动页面 (progress: 40%)
   d. 查找图片 (progress: 60%)
   e. 分析图片 (progress: 80%, twoPhaseApi 模式)
   f. 完成 (progress: 100%)
3. 更新任务状态 → 推送 SSE 事件
```

**关键点**：
- **basic 模式**：只提取 URL，不下载和分析
- **advanced 模式**：下载并分析图片，缓存 Buffer
- 复用现有的 `processDownloadQueue` 函数
- 通过 SSEManager 发送实时进度

### 4. ImageCache (server/storage/ImageCache.js)
**职责**：临时缓存图片 Buffer（用于下载端点）

**核心方法**：
- `set(extractionId, imageId, buffer, metadata)` - 缓存图片
- `get(extractionId, imageId)` - 获取图片
- `getAll(extractionId)` - 获取提取任务的所有图片
- `delete(extractionId)` - 删除提取任务的所有图片
- `cleanup(olderThanMs)` - 清理过期缓存

**特点**：
- 使用 Map 存储：`extractionId -> Map<imageId, {buffer, metadata}>`
- 自动过期机制（1小时）
- 仅在 advanced 模式下使用

### 5. DownloadService (server/services/DownloadService.js)
**职责**：处理图片下载请求

**核心方法**：
- `downloadSingle(extractionId, imageId)` - 下载单张图片
- `downloadMultiple(extractionId, imageIds)` - 下载多张图片（ZIP）
- `generateZip(images)` - 生成 ZIP 压缩包

**工作流程**：
```
单张下载：
1. 从 ImageCache 获取图片 Buffer
2. 设置正确的 Content-Type（image/jpeg, image/png 等）
3. 设置 Content-Disposition（文件名）
4. 返回二进制数据

批量下载：
1. 从 ImageCache 获取多个图片 Buffer
2. 使用 JSZip 创建压缩包
3. 设置 Content-Type: application/zip
4. 返回 ZIP 二进制数据
```

### 6. Routes (server/routes/)
**提取路由 (extractions.js)**：
```javascript
POST   /api/extractions           → 创建任务
GET    /api/extractions/:id       → 查询任务
GET    /api/extractions/:id/stream → SSE 流
```

**下载路由 (downloads.js)**：
```javascript
POST   /api/downloads/single      → 下载单张图片
POST   /api/downloads/multiple    → 下载多张图片（ZIP）
```

### 7. Koa App (server/app.js)
**职责**：配置 Koa 应用

**中间件**：
- @koa/cors - CORS 支持
- koa-bodyparser - 请求体解析
- 错误处理中间件
- 日志记录中间件

---

## 🔄 数据流设计

### 创建提取任务流程
```
客户端                  API 服务器                    爬虫引擎
  │                        │                            │
  ├─ POST /api/extractions ─→│                            │
  │                        │                            │
  │                        ├─ 生成任务 ID                │
  │                        ├─ 存储到 MemoryStorage       │
  │                        ├─ 返回任务信息 ←─────────────┤
  │←─ {id, status:pending} ─┤                            │
  │                        │                            │
  │                        ├─ 异步执行 ─→ executeExtraction()
  │                        │                            │
  │                        │                   启动浏览器 (5%)
  │                        │                   加载页面 (20%)
  │                        │                   滚动页面 (40%)
  │                        │                   查找图片 (60%)
  │                        │                   分析图片 (80%)
  │                        │                   完成 (100%)
  │                        │                            │
  │                        ├─ 更新任务状态为 done        │
  │                        │                            │
```

### SSE 实时进度推送流程
```
客户端                  API 服务器                SSEManager
  │                        │                        │
  ├─ GET /stream/:id ──────→│                        │
  │                        ├─ 添加连接 ─────────────→│
  │←─ SSE: connected ──────┤                        │
  │                        │                        │
  │                     爬虫执行中...                │
  │                        │                        │
  │                        │←─ sendProgress() ──────┤
  │←─ SSE: progress 20% ───┤                        │
  │                        │                        │
  │                        │←─ sendProgress() ──────┤
  │←─ SSE: progress 40% ───┤                        │
  │                        │                        │
  │                        │←─ sendComplete() ──────┤
  │←─ SSE: complete ────────┤                        │
  │                        ├─ 关闭连接 ─────────────→│
  │                        │                        │
```

### 查询任务状态流程
```
客户端                  API 服务器                MemoryStorage
  │                        │                        │
  ├─ GET /api/extractions/:id ─→│                   │
  │                        ├─ 查询任务 ─────────────→│
  │                        │←─ 返回任务数据 ─────────┤
  │←─ {id, status, images} ─┤                        │
  │                        │                        │
```

---

## 📝 实现步骤

### 第一阶段：核心模块 ✅ 已完成
- [x] SSEManager.js - SSE 连接管理
- [x] MemoryStorage.js - 内存存储
- [x] ExtractionService.js - 提取服务（已更新支持 basic/advanced 模式）

### 第二阶段：API 路由和服务器 ✅ 已完成
- [x] server/storage/ImageCache.js - 图片 Buffer 缓存
- [x] server/services/DownloadService.js - 下载服务
- [x] server/routes/extractions.js - 提取任务路由
- [x] server/routes/downloads.js - 下载路由
- [x] server/app.js - Koa 应用配置
- [x] server.js - 服务器入口文件

### 第三阶段：测试和示例 ✅ 已完成
- [x] 创建测试脚本 (test-api.sh)
- [ ] 创建前端示例（HTML + JavaScript）
- [x] API 文档 (API.md)

### 第四阶段：优化和完善
- [ ] 错误处理增强
- [ ] 日志系统优化
- [ ] 性能优化
- [ ] 部署指南

---

## 🧪 测试计划

### 单元测试
- [ ] SSEManager 连接管理测试
- [ ] MemoryStorage CRUD 测试
- [ ] ExtractionService 任务创建和执行测试

### 集成测试
- [ ] 完整提取流程测试
- [ ] SSE 事件推送测试
- [ ] 并发任务测试

### 手动测试
- [ ] 使用 cURL 测试 API
- [ ] 使用浏览器测试 SSE
- [ ] 测试各种网站的提取

---

## 📦 依赖更新

**现有依赖**（保持）：
- puppeteer
- puppeteer-extra
- puppeteer-extra-plugin-stealth
- sharp
- image-size
- axios
- cheerio-without-node-native
- pino
- log-update

**新增依赖**：
- koa - Web 框架
- @koa/router - Koa 路由
- @koa/cors - CORS 支持
- koa-bodyparser - 请求体解析
- jszip - 生成 ZIP 压缩包

**移除依赖**：
- express（改用 Koa）
- cors（改用 @koa/cors）
- socket.io（不需要 WebSocket）

---

## 🚀 部署和运行

### 开发模式
```bash
# 安装依赖
npm install

# 启动 API 服务器
npm run server

# 或使用开发模式（自动重启）
npm run dev
```

### 生产模式
```bash
# 使用 PM2
pm2 start server.js --name thumb2original-api

# 或使用 Docker
docker build -t thumb2original .
docker run -d -p 3000:3000 thumb2original
```

### 环境变量
```bash
PORT=3000              # API 服务器端口
HOST=0.0.0.0           # 绑定地址
NODE_ENV=production    # 环境模式
```

---

## 📊 性能考虑

### 并发控制
- 使用异步任务处理，不阻塞 API 响应
- 限制同时运行的浏览器实例数量
- 定期清理已完成的任务

### 内存管理
- 定期清理 1 小时前的已完成任务
- 图片分析使用 twoPhaseApi 模式，不存储 Buffer
- SSE 连接自动清理

### 资源限制
```javascript
// 建议配置
{
  maxConcurrentTasks: 3,        // 最大并发任务数
  taskCleanupInterval: 600000,  // 清理间隔（10分钟）
  taskMaxAge: 3600000,          // 任务最大保留时间（1小时）
  sseTimeout: 300000            // SSE 连接超时（5分钟）
}
```

---

## ⚠️ 注意事项

### 1. 与 CLI 模式的区别
| 特性 | CLI 模式 | API 模式（basic） | API 模式（advanced） |
|------|----------|------------------|---------------------|
| 下载图片 | ✅ 直接下载到本地 | ❌ 仅返回 URL | ✅ 临时缓存（用于下载端点） |
| 元数据分析 | ✅ | ❌ | ✅ |
| 输出结果 | 本地文件 | JSON（仅 URL） | JSON（完整元数据） |
| 进度显示 | 控制台日志 | SSE 事件 | SSE 事件 |

### 2. basic vs advanced 模式
**basic 模式**：
- 仅提取图片 URL
- 不下载图片
- 不分析元数据
- 处理速度快
- 返回字段：id, url

**advanced 模式**：
- 提取图片 URL
- 下载并分析图片
- 获取完整元数据（尺寸、格式、文件大小等）
- 临时缓存 Buffer（用于下载端点）
- 返回字段：id, url, name, basename, type, size, width, height

### 3. 安全考虑
- 添加请求频率限制
- 验证输入 URL 格式
- 设置浏览器资源限制
- 添加超时控制

---

## 📚 文档计划

### API 文档
- [ ] API 端点说明
- [ ] 请求/响应示例
- [ ] 错误码说明
- [ ] SSE 事件格式

### 使用指南
- [ ] 快速开始
- [ ] 完整示例（cURL、JavaScript、Python）
- [ ] 前端集成指南
- [ ] 部署指南

### 开发文档
- [ ] 架构设计说明
- [ ] 代码结构说明
- [ ] 扩展指南

---

## 🎯 成功标准

### 功能完整性
- ✅ 创建提取任务并返回任务 ID
- ✅ 异步执行爬取和分析
- ✅ SSE 实时推送进度（5个阶段）
- ✅ 查询任务返回完整的图片列表
- ✅ 支持缩略图转原图（imageMode: originals_only）

### 性能指标
- API 响应时间 < 200ms（创建任务）
- SSE 事件延迟 < 100ms
- 支持至少 3 个并发任务
- 单个任务处理时间与 CLI 模式相当

### 稳定性
- 错误处理完善，不会崩溃
- 自动清理资源（浏览器、连接、内存）
- 支持长时间运行

---

## 🔄 后续扩展方向

### 短期（v2.1）
- [ ] 添加任务取消功能
- [ ] 支持 Webhook 通知
- [ ] 添加图片下载端点（单个/ZIP）

### 中期（v2.2）
- [ ] Redis 持久化存储
- [ ] 任务队列（BullMQ）
- [ ] 认证和授权

### 长期（v3.0）
- [ ] 分布式部署
- [ ] 图片 CDN 托管
- [ ] 管理后台界面

---

## ✅ 审批检查清单

请确认以下内容：

- [ ] API 设计符合 extract.pics 风格
- [ ] 使用 SSE 而不是 WebSocket
- [ ] 复用现有爬虫逻辑，使用 twoPhaseApi 模式
- [ ] 文件结构清晰合理
- [ ] 数据结构符合预期
- [ ] 实现步骤可行
- [ ] 性能和安全考虑充分

---

**请审阅此计划，确认后我将开始实施！**
