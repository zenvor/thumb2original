import { logger } from '../utils/logger.js'
import { fetchImage } from './imageDownloader.js'
import { saveImage, generateFileName } from './fileManager.js'
import path from 'path'

/**
 * @description 等待指定的毫秒数。
 * @param {number} ms - 等待的毫秒数。
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @description 管理和执行图片下载任务，包括并发控制和重试机制。
 * @param {string[]} imageUrls - 要下载的图片 URL 列表。
 * @param {string} targetDownloadDir - 目标下载目录。
 * @param {object} context - 全局上下文对象。
 * @param {Array} downloadedImages - 用于收集下载图片信息的数组。
 * @returns {Promise<void>}
 */
export async function processDownloadQueue(imageUrls, targetDownloadDir, context, downloadedImages) {
  const { config, htmlFilePath, isResumeDownload, totalImageCount, downloadedCount } = context

  // 为整个下载批次创建一个唯一标识符
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`

  // 断点续传信息显示
  if (isResumeDownload) {
    logger.header(`断点续传模式：总共 ${totalImageCount} 张图片，已完成 ${downloadedCount} 张，还需下载 ${imageUrls.length} 张`)
  }

  let urlsToProcess = [...imageUrls]
  let currentRetry = 0

  try {
    while (urlsToProcess.length > 0 && currentRetry <= config.maxRetries) {
      if (currentRetry > 0) {
        logger.warn(
          `[${batchId}] --- 开始第 ${currentRetry}/${config.maxRetries} 次重试，处理 ${urlsToProcess.length} 张失败的图片 ---`
        )
        await delay(config.retryDelaySeconds * 1000)
      }

      const stats = {
        total: urlsToProcess.length,
        successful: 0,
        failed: 0,
        failedUrls: [],
      }

      const { concurrentDownloads, minRequestDelayMs, maxRequestDelayMs } = config

      for (let i = 0; i < urlsToProcess.length; i += concurrentDownloads) {
        const batch = urlsToProcess.slice(i, i + concurrentDownloads)

        const downloadPromises = batch.map(async (imageUrl, index) => {
          // 为 imx.to 域名添加额外的单个请求延迟
          if (imageUrl.includes('imx.to') && index > 0) {
            const singleRequestDelay = Math.floor(Math.random() * 1000) + 500 // 500-1500ms 随机延迟
            logger.debug(`图片请求延迟 ${singleRequestDelay} 毫秒: ${imageUrl}`, logger.categories.NETWORK)
            await delay(singleRequestDelay)
          }
          
          const imageData = await fetchImage(imageUrl, context, 0)
          if (!imageData) {
            stats.failed++
            stats.failedUrls.push(imageUrl)
            return
          }

          const fileName = generateFileName(imageUrl, imageData.buffer, imageData.headers)
          const filePath = path.join(targetDownloadDir, fileName)
          await saveImage(imageData.buffer, filePath, imageUrl, stats, downloadedImages)
        })

        try {
          await Promise.all(downloadPromises)
          
          // 显示当前批次进度
          const currentProgress = Math.min(i + concurrentDownloads, urlsToProcess.length)
          // 更新次级进度条 (level 1)
          logger.progress(currentProgress, urlsToProcess.length, `批次 ${Math.floor(i / concurrentDownloads) + 1} 完成`, 1)
        } catch (error) {
          const isBrowserError =
            error.message.includes('Connection closed') ||
            error.message.includes('Navigating frame was detached') ||
            error.message.includes('Session closed')

          if (error.isCritical || isBrowserError) {
            const reason = error.isCritical ? '关键错误' : '浏览器连接断开'
            logger.error(`[${batchId}] 遇到${reason}，立即终止所有下载任务: ${error.message}`)
            if (isBrowserError) {
              logger.error(`[${batchId}] 检测到浏览器实例关闭或页面已分离，这是严重错误，将终止程序。`)
            }
            logger.error(`[${batchId}] 数据一致性保障：任务已安全终止，避免数据丢失`)
            throw error // 立即终止整个下载流程
          }
          // 非关键错误继续处理
          logger.warn(`[${batchId}] 批次处理中出现错误，但非关键错误，继续处理: ${error.message}`)
        }

        if (i + concurrentDownloads < urlsToProcess.length) {
          const randomInterval =
            Math.floor(Math.random() * (maxRequestDelayMs - minRequestDelayMs + 1)) + minRequestDelayMs
          logger.debug(`[${batchId}] 等待 ${randomInterval} 毫秒后开始下一批次...`, logger.categories.NETWORK)
          await delay(randomInterval)
        }
      }

      logger.header(`[${batchId}] --- 批处理完成 (尝试次数 ${currentRetry}) ---`)
      logger.success(`[${batchId}] 成功下载: ${stats.successful}/${stats.total}`)
      if (stats.failed > 0) {
        logger.error(`[${batchId}] 下载失败: ${stats.failed}/${stats.total}`)
      }

      urlsToProcess = [...stats.failedUrls]
      currentRetry++
    }
  } finally {
    // 进度启停交由入口统一控制
  }

  if (urlsToProcess.length > 0) {
    logger.error(`所有重试后，仍有 ${urlsToProcess.length} 张图片下载失败:`)
    urlsToProcess.forEach((url) => logger.error(`- ${url}`))
  }
}
