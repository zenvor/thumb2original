import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger.js'
import { sanitizeFileName } from '../utils/fileNameSanitizer.js'
import { identifyImageFormat, convertWebpToPng, getFileNameFromUrl } from '../utils/imageUtils.js'
import { fetchImage } from './imageDownloader.js'
import { htmlMemoryManager } from '../utils/htmlMemoryManager.js'

/**
 * @description 等待指定的毫秒数。
 * @param {number} ms - 等待的毫秒数。
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @description 保存图像 Buffer 到文件系统。
 * @param {Buffer} buffer - 图像 Buffer。
 * @param {string} filePath - 目标文件路径。
 * @param {string} imageUrl - 原始图像 URL，用于错误记录。
 * @param {object} stats - 用于跟踪下载统计的对象。
 * @param {Array} [imageInfoList] - 图片信息列表，用于收集下载的图片信息。
 * @returns {Promise<void>}
 */
export async function saveImage(buffer, filePath, imageUrl, stats, imageInfoList = null) {
  // 如果没有提供下载ID，生成一个新的

  try {
    let finalBuffer = buffer
    let finalFilePath = filePath

    if (identifyImageFormat(buffer) === 'webp') {
      logger.process(`正在转换 WebP 图片: ${imageUrl}`)
      const pngBuffer = await convertWebpToPng(buffer)
      if (pngBuffer) {
        finalBuffer = pngBuffer
        finalFilePath = filePath.replace(/\.webp$/i, '.png')
        logger.success(`成功将 WebP 转换为 PNG。`)
      } else {
        throw new Error(`转换 WebP 缓冲区失败。`)
      }
    }

    try {
      await fs.writeFile(finalFilePath, finalBuffer)
      stats.successful++
      logger.success(`已下载 (${stats.successful}/${stats.total}): ${finalFilePath}`, logger.categories.DOWNLOAD)
    } catch (writeError) {
      // 写入失败快速抛错 + 终止任务
      const criticalError = new Error(`写入文件失败，任务终止: ${finalFilePath} - ${writeError.message}`)
      criticalError.isCritical = true
      criticalError.originalError = writeError
      logger.error(`严重错误 - 文件写入失败，立即终止任务: ${writeError.message}`)
      throw criticalError
    }
    
    // 收集图片信息用于记忆管理
    if (imageInfoList) {
      try {
        const imageInfo = await htmlMemoryManager.generateImageInfo(finalFilePath, imageUrl)
        if (imageInfoList.htmlFilePath) {
          await htmlMemoryManager.appendImageInfo(imageInfoList.htmlFilePath, imageInfo)
        } 
      } catch (error) {
        logger.warn(`收集图片信息失败 ${finalFilePath}: ${error.message}`)
      }
    }
  } catch (error) {
    stats.failed++
    stats.failedUrls.push(imageUrl)
    logger.error(`保存图片失败 ${imageUrl}: ${error.message}`)
  }
}

/**
 * @description 管理和执行图片下载任务，包括并发控制和重试机制。
 * @param {string[]} imageUrls - 要下载的图片 URL 列表。
 * @param {object} context - 全局上下文对象。
 * @returns {Promise<void>}
 */
export async function downloadManager(imageUrls, context) {
  const { config, pageTitle, htmlFilePath, isResumeDownload, totalImageCount, downloadedCount } = context

  const baseDownloadDir = config.outputDirectory || './download'
  const targetDownloadDir = path.join(baseDownloadDir, sanitizeFileName(pageTitle))
  await fs.mkdir(targetDownloadDir, { recursive: true })
  logger.process(`已创建下载文件夹: ${targetDownloadDir}`)

  // 为整个下载批次创建一个唯一标识符
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`

  // 断点续传信息显示
  if (isResumeDownload) {
    logger.header(`断点续传模式：总共 ${totalImageCount} 张图片，已完成 ${downloadedCount} 张，还需下载 ${imageUrls.length} 张`)
  }

  // 用于收集所有成功下载的图片信息
  const downloadedImages = []
  // 为图片信息列表添加HTML文件路径引用，用于实时写入
  downloadedImages.htmlFilePath = htmlFilePath
  let urlsToProcess = [...imageUrls]
  let currentRetry = 0

  logger.startProgress()
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
          // 为每个图片生成唯一的下载ID

          
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

          let fileName
          // 特定网站的文件名提取逻辑
          if (imageUrl.includes('chpic.su') && imageData.headers['content-disposition']) {
            const match = imageData.headers['content-disposition'].match(/filename=["']?([^"]+)/)
            const type = imageUrl.split('?type=')[1] || ''
            if (match && match[1]) {
              fileName = `${type}_${match[1].split('_-_')[1]}`
            }
          }

          if (!fileName) {
            fileName = getFileNameFromUrl(imageUrl, imageData.buffer)
          }

          const validatedFileName = sanitizeFileName(fileName)
          const filePath = path.join(targetDownloadDir, validatedFileName)
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
    logger.stopProgress()
  }

  if (urlsToProcess.length > 0) {
    logger.error(`所有重试后，仍有 ${urlsToProcess.length} 张图片下载失败:`)
    urlsToProcess.forEach((url) => logger.error(`- ${url}`))
  }

  // 最终确认HTML文件处理完成（HTML记忆管理已在下载过程中实时写入）
  if (htmlFilePath) {
    try {
      // 计算实际的总下载数量（包括之前已下载的）
      const actualTotalDownloaded = (downloadedCount || 0) + downloadedImages.length
      const expectedTotal = totalImageCount || downloadedImages.length
      
      if (downloadedImages.length > 0 || isResumeDownload) {
        // 写入最终完成记录
        await htmlMemoryManager.completeProcessing(htmlFilePath, {
          totalImages: actualTotalDownloaded,
          expectedTotal: expectedTotal,
          isResumeDownload: isResumeDownload || false
        })
        
        if (isResumeDownload) {
          logger.success(`HTML文件处理完成（断点续传），总计下载 ${actualTotalDownloaded}/${expectedTotal} 张图片，本次新增 ${downloadedImages.length} 张`)
        } else {
          logger.success(`HTML文件处理完成，共下载 ${downloadedImages.length} 张图片`)
        }
      } else {
        // 即使没有下载图片，也要标记为已处理
        await htmlMemoryManager.completeProcessing(htmlFilePath, {
          totalImages: 0,
          note: 'no_images_downloaded'
        })
        logger.info(`HTML文件处理完成，但未下载任何图片`)
      }
    } catch (error) {
      logger.error(`写入最终完成记录失败: ${error.message}`)
    }
  }
}

/**
 * @description 单个 URL 的完整抓取流程。
 * @param {string} url - 目标网站 URL。
 * @param {object} browser - Puppeteer 浏览器实例。
 * @param {object} config - 用户配置。
 * @param {Function} loadAndScrollPage - 页面加载函数。
 * @param {Function} extractImageUrls - 图片URL提取函数。
 * @param {Function} processUrlsByImageMode - URL处理函数。
 */
export async function scrapeUrl(url, browser, config, loadAndScrollPage, extractImageUrls, processUrlsByImageMode) {
  let page
  
  try {
    // 检查浏览器是否仍然连接
    if (!browser.isConnected()) {
      throw new Error('浏览器连接已断开')
    }
    
    page = await browser.newPage()
    
    // 设置页面错误处理
    page.on('error', (error) => {
      logger.error(`页面错误: ${error.message}`)
    })
    
    page.on('pageerror', (error) => {
      logger.error(`页面脚本错误: ${error.message}`)
    })
    
    // 设置更稳定的视口
    await page.setViewport({ 
      width: 1800, 
      height: 1000,
      deviceScaleFactor: 1
    })
    
    // 设置页面超时
     page.setDefaultTimeout(config.stability?.pageTimeout || 60000)
     page.setDefaultNavigationTimeout(config.stability?.navigationTimeout || 60000)

    const pageTitle = await loadAndScrollPage(page, url, config)
    let imageUrls = await extractImageUrls(page, url)

    const finalImageUrls = await processUrlsByImageMode(page, imageUrls, url, config.imageMode)

    if (finalImageUrls.length === 0) {
      logger.warn('此 URL 无需下载图片。')
      return
    }

    const context = {
      browser,
      config,
      pageTitle,
    }
    await downloadManager(finalImageUrls, context)
    
  } catch (error) {
    logger.error(`抓取 ${url} 时发生错误: ${error.message}`)
    
    // 如果是连接错误，提供更详细的信息
    if (error.message.includes('Protocol error') || error.message.includes('Connection closed')) {
      logger.error('检测到连接断开错误，建议:')
      logger.error('1. 检查网络连接是否稳定')
      logger.error('2. 尝试减少并发数量')
      logger.error('3. 增加请求间隔时间')
    }
    
    console.error(error.stack)
  } finally {
    if (page && !page.isClosed()) {
      try {
        await page.close()
        logger.process(`页面 ${url} 已关闭。`)
      } catch (closeError) {
        logger.error(`关闭页面时发生错误: ${closeError.message}`)
      }
    }
  }
}