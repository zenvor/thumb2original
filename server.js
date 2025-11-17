/**
 * API 服务器入口文件
 */

import http from 'http'
import { WebSocketServer } from 'ws'
import { createApp } from './server/app.js'
import { logger } from './utils/logger.js'
import { getDatabase, closeDatabase } from './lib/database/ImageAnalysisDB.js'
import { scraperConfig } from './config/config.js'

const PORT = process.env.PORT || 3000
const WS_PORT = process.env.WS_PORT || 8080
const HOST = process.env.HOST || '0.0.0.0'

async function start() {
  try {
    // 初始化数据库
    let cleanupInterval = null
    const db = getDatabase(scraperConfig)

    await db.init()
    logger.info('数据库已初始化', 'system')

    // 设置自动清理定时器
    if (scraperConfig.database.autoCleanup) {
      cleanupInterval = setInterval(() => {
        try {
          const deleted = db.cleanupOldTasks()
          if (deleted > 0) {
            logger.info(`自动清理完成: 删除 ${deleted} 个过期任务`, 'system')
          }
        } catch (error) {
          logger.warn(`自动清理失败: ${error.message}`, 'system')
        }
      }, scraperConfig.database.cleanupInterval)
      logger.info(`数据库自动清理已启用 (间隔: ${scraperConfig.database.cleanupInterval / 1000}秒)`, 'system')
    }

    const app = createApp()

    // 创建 HTTP 服务器
    const server = http.createServer(app.callback())

    // 创建 WebSocket 服务器（支持跨域）
    const wss = new WebSocketServer({
      port: WS_PORT,
      // 验证客户端连接（处理跨域）
      verifyClient: (info) => {
        // 允许所有来源的 WebSocket 连接
        // 生产环境建议根据 Origin 头进行验证
        const origin = info.origin || info.req.headers.origin

        if (origin) {
          logger.debug(`WebSocket connection from origin: ${origin}`)
        }

        // 返回 true 允许连接
        return true
      }
    })

    logger.info(`🚀 thumb2original API server starting...`)

    // 处理 WebSocket 连接
    wss.on('connection', (ws, req) => {
      // 从查询参数获取 taskId
      const url = new URL(req.url, `http://${req.headers.host}`)
      const taskId = url.searchParams.get('taskId')

      if (!taskId) {
        logger.warn('WebSocket connection rejected: missing taskId')
        ws.close(4000, 'Missing taskId parameter')
        return
      }

      logger.info(`WebSocket connection established for task: ${taskId}`)

      // 验证任务是否存在
      app.storage.get(taskId).then(task => {
        if (!task) {
          logger.warn(`WebSocket connection rejected: task ${taskId} not found`)
          ws.close(4004, 'Task not found')
          return
        }

        // 添加连接到 WebSocketManager
        app.wsManager.addConnection(taskId, ws)

        // 如果任务已经完成，立即发送完成事件
        if (task.status === 'done') {
          app.wsManager.sendComplete(taskId, {
            images_count: task.images_count,
            status: 'done'
          })
        } else if (task.status === 'failed') {
          app.wsManager.sendError(taskId, { message: task.message || 'Task failed' })
        }
      }).catch(error => {
        logger.error('Error verifying task:', error)
        ws.close(4500, 'Internal server error')
      })
    })

    wss.on('error', (error) => {
      logger.error('WebSocket server error:', error)
    })

    // 启动 HTTP 服务器
    server.listen(PORT, HOST, () => {
      logger.info(`✅ HTTP server listening on http://${HOST}:${PORT}`)
      logger.info(`✅ WebSocket server listening on ws://${HOST}:${WS_PORT}`)
      logger.info(`   Health check: http://${HOST}:${PORT}/health`)
      logger.info(`   Environment: ${process.env.NODE_ENV || 'development'}`)
    })

    // 优雅关闭
    const shutdown = () => {
      logger.info('Shutting down gracefully...')

      // 清理数据库定时器
      if (cleanupInterval) {
        clearInterval(cleanupInterval)
        logger.info('数据库自动清理已停止', 'system')
      }

      // 关闭数据库连接
      closeDatabase()

      server.close(() => {
        wss.close(() => {
          logger.info('Server closed')
          process.exit(0)
        })
      })
    }

    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
  } catch (error) {
    logger.error('Failed to start server:', error)
    process.exit(1)
  }
}

start()
