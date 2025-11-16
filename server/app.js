/**
 * Koa 应用配置
 */

import Koa from 'koa'
import cors from '@koa/cors'
import bodyParser from 'koa-bodyparser'
import { logger } from '../utils/logger.js'
import { MemoryStorage } from './storage/MemoryStorage.js'
import { ImageCache } from './storage/ImageCache.js'
import { WebSocketManager } from './websocket/WebSocketManager.js'
import { ExtractionService } from './services/ExtractionService.js'
import { DownloadService } from './services/DownloadService.js'
import { createExtractionsRouter } from './routes/extractions.js'
import { createDownloadsRouter } from './routes/downloads.js'

export function createApp() {
  const app = new Koa()

  // 创建服务实例
  const storage = new MemoryStorage()
  const imageCache = new ImageCache()
  const wsManager = new WebSocketManager()
  const extractionService = new ExtractionService(storage, wsManager, imageCache)
  const downloadService = new DownloadService(storage, imageCache)

  // 错误处理中间件
  app.use(async (ctx, next) => {
    try {
      await next()
    } catch (err) {
      logger.error('Unhandled error:', err)
      ctx.status = err.status || 500
      ctx.body = {
        error: err.message || 'Internal server error'
      }
    }
  })

  // 日志中间件
  app.use(async (ctx, next) => {
    const start = Date.now()
    await next()
    const ms = Date.now() - start
    logger.info(`${ctx.method} ${ctx.url} - ${ctx.status} - ${ms}ms`)
  })

  // CORS
  app.use(cors({
    origin: '*',
    credentials: true,
    maxAge: 86400
  }))

  // Body parser
  app.use(bodyParser({
    jsonLimit: '10mb'
  }))

  // 路由
  const extractionsRouter = createExtractionsRouter(extractionService, storage)
  const downloadsRouter = createDownloadsRouter(downloadService)

  app.use(extractionsRouter.routes())
  app.use(extractionsRouter.allowedMethods())
  app.use(downloadsRouter.routes())
  app.use(downloadsRouter.allowedMethods())

  // 健康检查
  app.use(async (ctx) => {
    if (ctx.path === '/health') {
      const stats = await storage.getStats()
      const cacheStats = imageCache.getStats()
      const wsStats = wsManager.getStats()

      ctx.body = {
        status: 'ok',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        tasks: stats,
        cache: cacheStats,
        websocket: wsStats
      }
    } else {
      ctx.status = 404
      ctx.body = { error: 'Not found' }
    }
  })

  // 定期清理任务（每10分钟）
  setInterval(async () => {
    try {
      const deletedTasks = await storage.cleanup(3600000) // 1小时
      const deletedImages = await imageCache.cleanup(3600000) // 1小时

      if (deletedTasks > 0 || deletedImages > 0) {
        logger.info(`Cleanup completed: ${deletedTasks} tasks, ${deletedImages} images`)
      }
    } catch (error) {
      logger.error('Cleanup error:', error)
    }
  }, 600000)

  // 导出 wsManager 以便 server.js 可以设置 WebSocket 服务器
  app.wsManager = wsManager
  app.storage = storage

  return app
}
