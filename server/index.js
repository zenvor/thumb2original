/**
 * API 服务器 - 提供 RESTful API 和 WebSocket 支持
 */

import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { Server as SocketIO } from 'socket.io'
import { TaskManager } from './TaskManager.js'
import { logger } from '../utils/logger.js'
import { defaultLogConfig } from '../config/logConfig.js'

export class ScraperServer {
  constructor(options = {}) {
    this.port = options.port || 3000
    this.host = options.host || '0.0.0.0'

    // Express 应用
    this.app = express()
    this.httpServer = createServer(this.app)

    // Socket.IO
    this.io = new SocketIO(this.httpServer, {
      cors: {
        origin: options.corsOrigin || '*',
        methods: ['GET', 'POST']
      }
    })

    // 任务管理器
    this.taskManager = new TaskManager({
      maxConcurrent: options.maxConcurrent || 3
    })

    this.setupMiddleware()
    this.setupRoutes()
    this.setupWebSocket()
    this.setupTaskEvents()
  }

  /**
   * 设置中间件
   */
  setupMiddleware() {
    this.app.use(cors())
    this.app.use(express.json({ limit: '10mb' }))
    this.app.use(express.urlencoded({ extended: true }))

    // 请求日志
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, 'server')
      next()
    })
  }

  /**
   * 设置路由
   */
  setupRoutes() {
    // 健康检查
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        uptime: process.uptime(),
        stats: this.taskManager.getStats()
      })
    })

    // 创建任务
    this.app.post('/api/tasks', async (req, res) => {
      try {
        const { config, options } = req.body

        if (!config) {
          return res.status(400).json({
            error: 'Missing config parameter'
          })
        }

        const taskId = this.taskManager.createTask(config, options)

        // 立即开始执行
        await this.taskManager.runTask(taskId)

        res.json({
          taskId,
          status: 'created',
          message: 'Task created and queued successfully'
        })

      } catch (error) {
        logger.error(`创建任务失败: ${error.message}`)
        res.status(500).json({
          error: error.message
        })
      }
    })

    // 获取任务状态
    this.app.get('/api/tasks/:taskId', (req, res) => {
      const { taskId } = req.params
      const task = this.taskManager.getTask(taskId)

      if (!task) {
        return res.status(404).json({
          error: 'Task not found'
        })
      }

      res.json(task)
    })

    // 获取所有任务
    this.app.get('/api/tasks', (req, res) => {
      const tasks = this.taskManager.getAllTasks()
      res.json({
        tasks,
        stats: this.taskManager.getStats()
      })
    })

    // 取消任务
    this.app.post('/api/tasks/:taskId/cancel', async (req, res) => {
      try {
        const { taskId } = req.params
        await this.taskManager.cancelTask(taskId)

        res.json({
          taskId,
          status: 'cancelled',
          message: 'Task cancelled successfully'
        })
      } catch (error) {
        res.status(500).json({
          error: error.message
        })
      }
    })

    // 删除任务
    this.app.delete('/api/tasks/:taskId', (req, res) => {
      try {
        const { taskId } = req.params
        const deleted = this.taskManager.deleteTask(taskId)

        if (!deleted) {
          return res.status(404).json({
            error: 'Task not found'
          })
        }

        res.json({
          taskId,
          message: 'Task deleted successfully'
        })
      } catch (error) {
        res.status(500).json({
          error: error.message
        })
      }
    })

    // 清理已完成任务
    this.app.post('/api/tasks/cleanup', (req, res) => {
      const { olderThanMs } = req.body
      const count = this.taskManager.cleanupCompletedTasks(olderThanMs)

      res.json({
        message: `Cleaned up ${count} completed tasks`
      })
    })

    // API 文档
    this.app.get('/api/docs', (req, res) => {
      res.json({
        endpoints: [
          { method: 'GET', path: '/health', description: '健康检查' },
          { method: 'POST', path: '/api/tasks', description: '创建新任务' },
          { method: 'GET', path: '/api/tasks', description: '获取所有任务' },
          { method: 'GET', path: '/api/tasks/:taskId', description: '获取任务状态' },
          { method: 'POST', path: '/api/tasks/:taskId/cancel', description: '取消任务' },
          { method: 'DELETE', path: '/api/tasks/:taskId', description: '删除任务' },
          { method: 'POST', path: '/api/tasks/cleanup', description: '清理已完成任务' }
        ],
        websocket: {
          url: '/socket.io',
          events: [
            'task:created',
            'task:started',
            'task:progress',
            'task:completed',
            'task:failed',
            'task:cancelled'
          ]
        }
      })
    })

    // 404 处理
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not found',
        path: req.path
      })
    })
  }

  /**
   * 设置 WebSocket
   */
  setupWebSocket() {
    this.io.on('connection', (socket) => {
      logger.info(`客户端连接: ${socket.id}`, 'websocket')

      // 订阅任务更新
      socket.on('subscribe', (taskId) => {
        if (taskId) {
          socket.join(`task:${taskId}`)
          logger.info(`客户端 ${socket.id} 订阅任务 ${taskId}`)
        } else {
          socket.join('all-tasks')
          logger.info(`客户端 ${socket.id} 订阅所有任务`)
        }
      })

      // 取消订阅
      socket.on('unsubscribe', (taskId) => {
        if (taskId) {
          socket.leave(`task:${taskId}`)
        } else {
          socket.leave('all-tasks')
        }
      })

      socket.on('disconnect', () => {
        logger.info(`客户端断开连接: ${socket.id}`, 'websocket')
      })
    })
  }

  /**
   * 设置任务事件监听
   */
  setupTaskEvents() {
    // 转发所有任务事件到 WebSocket
    const events = [
      'task:created',
      'task:queued',
      'task:started',
      'task:progress',
      'task:status',
      'task:completed',
      'task:failed',
      'task:cancelled',
      'task:deleted'
    ]

    events.forEach(event => {
      this.taskManager.on(event, (data) => {
        const { taskId } = data

        // 发送给订阅该任务的客户端
        if (taskId) {
          this.io.to(`task:${taskId}`).emit(event, data)
        }

        // 发送给订阅所有任务的客户端
        this.io.to('all-tasks').emit(event, data)
      })
    })
  }

  /**
   * 启动服务器
   */
  async start() {
    // 初始化日志
    logger.initConfig(defaultLogConfig)

    return new Promise((resolve) => {
      this.httpServer.listen(this.port, this.host, () => {
        logger.info(`服务器启动成功`, 'server')
        logger.info(`HTTP: http://${this.host}:${this.port}`, 'server')
        logger.info(`API 文档: http://${this.host}:${this.port}/api/docs`, 'server')
        resolve()
      })
    })
  }

  /**
   * 停止服务器
   */
  async stop() {
    return new Promise((resolve) => {
      this.io.close(() => {
        this.httpServer.close(() => {
          logger.info('服务器已关闭', 'server')
          resolve()
        })
      })
    })
  }
}

// 如果直接运行此文件，启动服务器
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new ScraperServer({
    port: process.env.PORT || 3000,
    maxConcurrent: 3
  })

  server.start().catch(error => {
    logger.error(`服务器启动失败: ${error.message}`)
    process.exit(1)
  })

  // 优雅退出
  process.on('SIGTERM', async () => {
    logger.info('收到 SIGTERM 信号，准备关闭...')
    await server.stop()
    process.exit(0)
  })

  process.on('SIGINT', async () => {
    logger.info('收到 SIGINT 信号，准备关闭...')
    await server.stop()
    process.exit(0)
  })
}
