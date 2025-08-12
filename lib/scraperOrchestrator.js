import { logger } from '../utils/logger.js'
import { createDownloadDirectory, completeHtmlProcessing } from './fileManager.js'
import { processDownloadQueue } from './downloadQueue.js'

/**
 * @description 单个 URL 的完整抓取流程编排。
 * @param {string} url - 目标网站 URL。
 * @param {object} browser - Puppeteer 浏览器实例。
 * @param {object} config - 用户配置。
 * @param {Function} loadAndScrollPage - 页面加载函数。
 * @param {Function} extractImageUrls - 图片URL提取函数。
 * @param {Function} processUrlsByImageMode - URL处理函数。
 * @returns {Promise<void>}
 */
export async function orchestrateScraping(url, browser, config, loadAndScrollPage, extractImageUrls, processUrlsByImageMode) {
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
    
    await orchestrateDownload(finalImageUrls, context)
    
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

/**
 * @description 编排下载流程，包括目录创建、队列处理和完成记录。
 * @param {string[]} imageUrls - 要下载的图片 URL 列表。
 * @param {object} context - 全局上下文对象。
 * @returns {Promise<void>}
 */
export async function orchestrateDownload(imageUrls, context) {
  const { config, pageTitle, htmlFilePath, isResumeDownload, totalImageCount, downloadedCount } = context

  const baseDownloadDir = config.outputDirectory || './download'
  const targetDownloadDir = await createDownloadDirectory(baseDownloadDir, pageTitle)

  // 用于收集所有成功下载的图片信息
  const downloadedImages = []
  // 为图片信息列表添加HTML文件路径引用，用于实时写入
  downloadedImages.htmlFilePath = htmlFilePath

  try {
    await processDownloadQueue(imageUrls, targetDownloadDir, context, downloadedImages)
  } finally {
    // 最终确认HTML文件处理完成（HTML记忆管理已在下载过程中实时写入）
    await completeHtmlProcessing(htmlFilePath, downloadedImages, {
      downloadedCount,
      totalImageCount,
      isResumeDownload
    })
  }
}
