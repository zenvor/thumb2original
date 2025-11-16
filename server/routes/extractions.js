/**
 * 提取任务路由
 */

import Router from '@koa/router'
import { logger } from '../../utils/logger.js'

export function createExtractionsRouter(extractionService, storage, sseManager) {
  const router = new Router({ prefix: '/api/extractions' })

  /**
   * POST /api/extractions
   * 创建提取任务
   */
  router.post('/', async (ctx) => {
    try {
      const { url, mode, ignoreInlineImages } = ctx.request.body

      // 验证参数
      if (!url) {
        ctx.status = 400
        ctx.body = { error: 'URL is required' }
        return
      }

      // 验证 URL 格式
      try {
        new URL(url)
      } catch {
        ctx.status = 400
        ctx.body = { error: 'Invalid URL format' }
        return
      }

      // 验证 mode
      if (mode && !['basic', 'advanced'].includes(mode)) {
        ctx.status = 400
        ctx.body = { error: 'Mode must be "basic" or "advanced"' }
        return
      }

      // 创建提取任务
      const task = await extractionService.createExtraction(url, {
        mode: mode || 'basic',
        ignoreInlineImages: ignoreInlineImages || false,
        trigger: 'api'
      })

      logger.info(`Created extraction task: ${task.id}`)

      ctx.status = 201
      ctx.body = task
    } catch (error) {
      logger.error('Error creating extraction:', error)
      ctx.status = 500
      ctx.body = { error: error.message || 'Internal server error' }
    }
  })

  /**
   * GET /api/extractions/:id
   * 查询任务状态和图片列表
   */
  router.get('/:id', async (ctx) => {
    try {
      const { id } = ctx.params

      const task = await storage.get(id)
      if (!task) {
        ctx.status = 404
        ctx.body = { error: 'Task not found' }
        return
      }

      ctx.body = task
    } catch (error) {
      logger.error('Error getting extraction:', error)
      ctx.status = 500
      ctx.body = { error: error.message || 'Internal server error' }
    }
  })

  /**
   * GET /api/extractions/:id/stream
   * SSE 实时进度推送
   */
  router.get('/:id/stream', async (ctx) => {
    const { id } = ctx.params

    // 验证任务存在
    const task = await storage.get(id)
    if (!task) {
      ctx.status = 404
      ctx.body = { error: 'Task not found' }
      return
    }

    // 设置 SSE 响应头
    ctx.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    })

    ctx.status = 200

    // 获取原始 response 对象
    const res = ctx.res

    // 添加 SSE 连接
    sseManager.addConnection(id, res)

    logger.info(`SSE connection established for task: ${id}`)

    // 如果任务已经完成，立即发送完成事件
    if (task.status === 'done') {
      sseManager.sendComplete(id, {
        images_count: task.images_count,
        status: 'done'
      })
    } else if (task.status === 'failed') {
      sseManager.sendError(id, { message: task.message || 'Task failed' })
    }

    // 监听连接关闭
    res.on('close', () => {
      sseManager.removeConnection(id, res)
      logger.info(`SSE connection closed for task: ${id}`)
    })

    // 保持连接打开
    await new Promise((resolve) => {
      res.on('finish', resolve)
      res.on('close', resolve)
    })
  })

  return router
}
