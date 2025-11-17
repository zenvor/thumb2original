/**
 * 下载路由
 */

import Router from '@koa/router'
import { logger } from '../../utils/logger.js'

export function createDownloadsRouter(downloadService) {
  const router = new Router({ prefix: '/api/downloads' })

  /**
   * POST /api/downloads/single
   * 下载单张图片
   */
  router.post('/single', async (ctx) => {
    try {
      const { extractionId, imageId } = ctx.request.body

      // 验证参数
      if (!extractionId) {
        ctx.status = 400
        ctx.body = { error: 'extractionId is required' }
        return
      }

      if (!imageId) {
        ctx.status = 400
        ctx.body = { error: 'imageId is required' }
        return
      }

      // 下载图片
      const result = await downloadService.downloadSingle(extractionId, imageId)

      // 设置响应头
      ctx.type = result.contentType
      ctx.set('Content-Length', result.buffer.length)
      ctx.set('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`)
      ctx.set('Cache-Control', 'no-cache')

      ctx.body = result.buffer

      logger.info(`Downloaded single image: ${imageId} from extraction: ${extractionId}`)
    } catch (error) {
      logger.error('Error downloading single image:', error)

      if (error.message.includes('not found')) {
        ctx.status = 404
        ctx.body = { error: error.message }
      } else if (error.message.includes('not done')) {
        ctx.status = 400
        ctx.body = { error: error.message }
      } else if (error.message.includes('only available for advanced mode')) {
        ctx.status = 400
        ctx.body = { error: error.message }
      } else {
        ctx.status = 500
        ctx.body = { error: error.message || 'Internal server error' }
      }
    }
  })

  /**
   * POST /api/downloads/multiple
   * 下载多张图片（ZIP）
   */
  router.post('/multiple', async (ctx) => {
    try {
      const { extractionId, imageIds } = ctx.request.body

      // 验证参数
      if (!extractionId) {
        ctx.status = 400
        ctx.body = { error: 'extractionId is required' }
        return
      }

      if (!imageIds || !Array.isArray(imageIds) || imageIds.length === 0) {
        ctx.status = 400
        ctx.body = { error: 'imageIds must be a non-empty array' }
        return
      }

      // 下载图片（ZIP）
      const result = await downloadService.downloadMultiple(extractionId, imageIds)

      // 设置响应头
      ctx.type = result.contentType
      ctx.set('Content-Length', result.buffer.length)
      ctx.set('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`)
      ctx.set('Cache-Control', 'no-cache')

      ctx.body = result.buffer

      logger.info(`Downloaded ${imageIds.length} images as ZIP from extraction: ${extractionId}`)
    } catch (error) {
      logger.error('Error downloading multiple images:', error)

      if (error.message.includes('not found')) {
        ctx.status = 404
        ctx.body = { error: error.message }
      } else if (error.message.includes('not done')) {
        ctx.status = 400
        ctx.body = { error: error.message }
      } else if (error.message.includes('only available for advanced mode')) {
        ctx.status = 400
        ctx.body = { error: error.message }
      } else {
        ctx.status = 500
        ctx.body = { error: error.message || 'Internal server error' }
      }
    }
  })

  return router
}
