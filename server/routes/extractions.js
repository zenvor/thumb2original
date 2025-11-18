/**
 * 提取任务路由
 */

import Router from '@koa/router'
import { logger } from '../../utils/logger.js'
import { getDatabase } from '../../lib/database/ImageAnalysisDB.js'

export function createExtractionsRouter(extractionService, storage) {
  const router = new Router({ prefix: '/api/extractions' })
  const db = getDatabase()

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
   * 支持 ?view=all|original 参数切换视图
   */
  router.get('/:id', async (ctx) => {
    try {
      const { id } = ctx.params
      const { view } = ctx.query

      const task = await storage.get(id)
      if (!task) {
        ctx.status = 404
        ctx.body = { error: 'Task not found' }
        return
      }

      // 根据 view 参数从数据库查询对应的图片
      if (view === 'original' || view === 'all') {
        const imageMode = view === 'original' ? 'original' : 'all'

        // 从数据库获取对应模式的图片
        const imagesFromDb = db.getImagesByMode(id, imageMode, true)

        if (imagesFromDb.length === 0 && view === 'original') {
          ctx.status = 400
          ctx.body = { error: 'Original images not matched yet' }
          return
        }

        // 格式化为 API 响应格式
        const images = imagesFromDb.map(img => ({
          id: img.id,
          url: img.url,
          name: extractFileName(img.url),
          basename: extractFileName(img.url) ? `${extractFileName(img.url)}.${img.format}` : undefined,
          size: img.width && img.height ? img.width * img.height : 0,
          type: img.format,
          width: img.width,
          height: img.height
        }))

        ctx.body = {
          ...task,
          images,
          images_count: images.length,
          current_view: view
        }
      } else {
        // 默认返回当前视图（从内存存储）
        ctx.body = task
      }
    } catch (error) {
      logger.error('Error getting extraction:', error)
      ctx.status = 500
      ctx.body = { error: error.message || 'Internal server error' }
    }
  })

  // 辅助函数：提取文件名
  function extractFileName(url) {
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname
      const filename = pathname.split('/').pop()
      return filename ? filename.replace(/\.[^/.]+$/, '') : null
    } catch {
      return null
    }
  }

  /**
   * POST /api/extractions/:id/match-original
   * 匹配原图 - 对已有任务的图片进行原图转换和分析
   */
  router.post('/:id/match-original', async (ctx) => {
    try {
      const { id } = ctx.params

      const task = await storage.get(id)
      if (!task) {
        ctx.status = 404
        ctx.body = { error: 'Task not found' }
        return
      }

      if (task.status !== 'done') {
        ctx.status = 400
        ctx.body = { error: 'Task is not completed yet' }
        return
      }

      // 如果已经匹配过，从数据库查询结果
      if (task.original_matched) {
        logger.info(`Task ${id} already matched, returning cached results from database`)

        const imagesFromDb = db.getImagesByMode(id, 'original', true)
        const images = imagesFromDb.map(img => ({
          id: img.id,
          url: img.url,
          name: extractFileName(img.url),
          basename: extractFileName(img.url) ? `${extractFileName(img.url)}.${img.format}` : undefined,
          size: img.width && img.height ? img.width * img.height : 0,
          type: img.format,
          width: img.width,
          height: img.height
        }))

        ctx.body = {
          success: true,
          matched_count: images.length,
          images: images,
          from_cache: true
        }
        return
      }

      logger.info(`Starting original matching for task: ${id}`)

      // 执行匹配
      const result = await extractionService.matchOriginalImages(id)

      ctx.body = result
    } catch (error) {
      logger.error('Error matching original images:', error)
      ctx.status = 500
      ctx.body = { error: error.message || 'Internal server error' }
    }
  })

  return router
}
