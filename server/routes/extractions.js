/**
 * 提取任务路由
 */

import Router from '@koa/router'
import { logger } from '../../utils/logger.js'

export function createExtractionsRouter(extractionService, storage) {
  const router = new Router({ prefix: '/api/extractions' })

  /**
   * POST /api/extractions
   * 创建提取任务
   */
  router.post('/', async (ctx) => {
    try {
      const { url, mode, ignoreInlineImages, imageMode } = ctx.request.body

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

      // 验证 imageMode
      if (imageMode && !['all', 'originals_only'].includes(imageMode)) {
        ctx.status = 400
        ctx.body = { error: 'imageMode must be "all" or "originals_only"' }
        return
      }

      // 创建提取任务
      const task = await extractionService.createExtraction(url, {
        mode: mode || 'basic',
        ignoreInlineImages: ignoreInlineImages || false,
        imageMode: imageMode || 'all',
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

  return router
}
