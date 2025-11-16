# API 服务器使用指南

## 📖 概述

thumb2original 现在支持两种运行模式：

1. **CLI 模式**：命令行工具，直接运行爬虫
2. **API 模式**：HTTP API 服务器，支持远程调用和任务管理

---

## 🚀 快速开始

### 安装依赖

```bash
npm install express cors socket.io
```

### 运行模式

#### 1. CLI 模式（原有方式）

```bash
# 方式一：使用 npm script
npm start

# 方式二：直接运行
node cli.js

# 方式三：使用原有入口（兼容）
node index.js
```

#### 2. API 服务器模式

```bash
# 方式一：使用 npm script
npm run server

# 方式二：直接运行
node server.js

# 方式三：自定义端口和配置
PORT=8080 MAX_CONCURRENT=5 node server.js
```

---

## 🔧 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务器端口 | 3000 |
| `HOST` | 绑定地址 | 0.0.0.0 |
| `MAX_CONCURRENT` | 最大并发任务数 | 3 |
| `CORS_ORIGIN` | CORS 允许的来源 | * |

---

## 📡 API 接口文档

### 基础信息

- **Base URL**: `http://localhost:3000`
- **Content-Type**: `application/json`

### 接口列表

#### 1. 健康检查

```
GET /health
```

**响应示例**:
```json
{
  "status": "ok",
  "uptime": 123.456,
  "stats": {
    "total": 5,
    "pending": 1,
    "running": 2,
    "completed": 2,
    "failed": 0
  }
}
```

#### 2. 创建任务

```
POST /api/tasks
```

**请求体**:
```json
{
  "config": {
    "scrapeMode": "single_page",
    "imageMode": "originals_only",
    "targetUrl": "https://example.com/gallery",
    "outputDirectory": "./download",
    "maxRetries": 3,
    "concurrentDownloads": 10
  },
  "options": {}
}
```

**响应示例**:
```json
{
  "taskId": "task_1234567890_abc123",
  "status": "created",
  "message": "Task created and queued successfully"
}
```

#### 3. 获取任务状态

```
GET /api/tasks/:taskId
```

**响应示例**:
```json
{
  "id": "task_1234567890_abc123",
  "status": "running",
  "createdAt": 1234567890000,
  "startedAt": 1234567891000,
  "completedAt": null,
  "progress": {
    "status": "running",
    "currentUrl": "https://example.com/gallery",
    "urlIndex": 1,
    "totalUrls": 1,
    "elapsedTime": 5000
  },
  "result": null,
  "error": null,
  "config": {
    "scrapeMode": "single_page",
    "imageMode": "originals_only",
    "targetUrl": "https://example.com/gallery"
  }
}
```

#### 4. 获取所有任务

```
GET /api/tasks
```

**响应示例**:
```json
{
  "tasks": [
    {
      "id": "task_1234567890_abc123",
      "status": "completed",
      "createdAt": 1234567890000,
      "startedAt": 1234567891000,
      "completedAt": 1234567900000
    }
  ],
  "stats": {
    "total": 5,
    "pending": 0,
    "running": 1,
    "completed": 4,
    "failed": 0
  }
}
```

#### 5. 取消任务

```
POST /api/tasks/:taskId/cancel
```

**响应示例**:
```json
{
  "taskId": "task_1234567890_abc123",
  "status": "cancelled",
  "message": "Task cancelled successfully"
}
```

#### 6. 删除任务

```
DELETE /api/tasks/:taskId
```

**响应示例**:
```json
{
  "taskId": "task_1234567890_abc123",
  "message": "Task deleted successfully"
}
```

#### 7. 清理已完成任务

```
POST /api/tasks/cleanup
```

**请求体**:
```json
{
  "olderThanMs": 3600000
}
```

**响应示例**:
```json
{
  "message": "Cleaned up 3 completed tasks"
}
```

#### 8. API 文档

```
GET /api/docs
```

---

## 🔌 WebSocket 实时通讯

### 连接

```javascript
import { io } from 'socket.io-client'

const socket = io('http://localhost:3000')
```

### 订阅任务更新

```javascript
// 订阅特定任务
socket.emit('subscribe', 'task_1234567890_abc123')

// 订阅所有任务
socket.emit('subscribe')
```

### 监听事件

```javascript
// 任务创建
socket.on('task:created', (data) => {
  console.log('任务创建:', data)
})

// 任务开始
socket.on('task:started', (data) => {
  console.log('任务开始:', data)
})

// 任务进度
socket.on('task:progress', (data) => {
  console.log('进度更新:', data.progress)
})

// 任务完成
socket.on('task:completed', (data) => {
  console.log('任务完成:', data.result)
})

// 任务失败
socket.on('task:failed', (data) => {
  console.log('任务失败:', data.error)
})

// 任务取消
socket.on('task:cancelled', (data) => {
  console.log('任务取消:', data)
})
```

### 取消订阅

```javascript
// 取消订阅特定任务
socket.emit('unsubscribe', 'task_1234567890_abc123')

// 取消订阅所有任务
socket.emit('unsubscribe')
```

---

## 💡 使用示例

### 示例 1: 使用 cURL 创建任务

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "scrapeMode": "single_page",
      "imageMode": "originals_only",
      "targetUrl": "https://example.com/gallery",
      "outputDirectory": "./download"
    }
  }'
```

### 示例 2: 使用 JavaScript (Node.js)

```javascript
import fetch from 'node-fetch'

async function createTask() {
  const response = await fetch('http://localhost:3000/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: {
        scrapeMode: 'single_page',
        imageMode: 'originals_only',
        targetUrl: 'https://example.com/gallery'
      }
    })
  })

  const data = await response.json()
  console.log('任务ID:', data.taskId)

  // 轮询任务状态
  const taskId = data.taskId
  const checkStatus = async () => {
    const statusRes = await fetch(`http://localhost:3000/api/tasks/${taskId}`)
    const task = await statusRes.json()
    console.log('任务状态:', task.status)

    if (task.status === 'running' || task.status === 'pending') {
      setTimeout(checkStatus, 2000)
    } else {
      console.log('任务完成:', task)
    }
  }

  checkStatus()
}

createTask()
```

### 示例 3: 使用 WebSocket 实时监控

```javascript
import { io } from 'socket.io-client'
import fetch from 'node-fetch'

const socket = io('http://localhost:3000')

// 订阅所有任务
socket.emit('subscribe')

// 监听进度
socket.on('task:progress', (data) => {
  console.log(`任务 ${data.taskId} 进度:`, data.progress)
})

socket.on('task:completed', (data) => {
  console.log(`任务 ${data.taskId} 完成:`, data.result)
})

// 创建任务
async function createTask() {
  const response = await fetch('http://localhost:3000/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: {
        scrapeMode: 'multiple_pages',
        imageMode: 'all',
        targetUrls: [
          'https://example.com/page1',
          'https://example.com/page2'
        ]
      }
    })
  })

  const data = await response.json()
  console.log('任务创建:', data.taskId)
}

createTask()
```

### 示例 4: Python 客户端

```python
import requests
import time

# 创建任务
response = requests.post('http://localhost:3000/api/tasks', json={
    'config': {
        'scrapeMode': 'single_page',
        'imageMode': 'originals_only',
        'targetUrl': 'https://example.com/gallery'
    }
})

task_id = response.json()['taskId']
print(f'任务ID: {task_id}')

# 轮询任务状态
while True:
    status_response = requests.get(f'http://localhost:3000/api/tasks/{task_id}')
    task = status_response.json()

    print(f'任务状态: {task["status"]}')

    if task['status'] in ['completed', 'failed', 'cancelled']:
        print(f'任务完成: {task}')
        break

    time.sleep(2)
```

---

## 🏗️ 架构说明

### 核心组件

1. **ScraperEngine** (`lib/core/ScraperEngine.js`)
   - 爬虫核心引擎
   - CLI 和 API 共享的业务逻辑
   - 支持进度回调和状态管理

2. **TaskManager** (`server/TaskManager.js`)
   - 任务队列管理
   - 并发控制
   - 事件发射器

3. **ScraperServer** (`server/index.js`)
   - Express HTTP 服务器
   - Socket.IO WebSocket 支持
   - RESTful API 路由

### 运行模式对比

| 特性 | CLI 模式 | API 模式 |
|------|----------|----------|
| 运行方式 | 命令行直接执行 | HTTP API 调用 |
| 并发任务 | 单任务 | 多任务队列 |
| 进度监控 | 控制台日志 | WebSocket 实时推送 |
| 远程访问 | ❌ | ✅ |
| 适用场景 | 本地一次性抓取 | 服务端持续运行 |

---

## 🔒 安全建议

1. **生产环境部署**
   - 使用反向代理（Nginx/Apache）
   - 启用 HTTPS
   - 限制 CORS 来源
   - 添加身份验证

2. **资源限制**
   - 设置合理的 `MAX_CONCURRENT`
   - 限制任务队列大小
   - 定期清理已完成任务

3. **监控告警**
   - 监控内存使用
   - 监控任务失败率
   - 设置超时限制

---

## 🐛 故障排查

### 服务器无法启动

```bash
# 检查端口是否被占用
lsof -i :3000

# 使用其他端口
PORT=8080 node server.js
```

### 任务一直处于 pending 状态

- 检查并发数限制 `MAX_CONCURRENT`
- 查看是否有任务卡住
- 重启服务器

### WebSocket 连接失败

- 检查 CORS 配置
- 确认防火墙规则
- 查看浏览器控制台错误

---

## 📝 更新日志

### v2.0.0 (API 模式)
- ✨ 新增 API 服务器模式
- ✨ 支持任务队列和并发控制
- ✨ WebSocket 实时进度推送
- 🔧 重构核心逻辑为 ScraperEngine
- 📚 完整的 API 文档

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
