import { logger } from '../utils/logger.js'
import { createDownloadDirectory, completeHtmlProcessing } from './fileManager.js'
import { processDownloadQueue } from './downloadQueue.js'
import { handleFatalError } from '../utils/errors.js'

/**
 * @description 创建并配置 Puppeteer 页面
 * @param {object} browser - Puppeteer 浏览器实例
 * @param {object} config - 用户配置
 * @returns {Promise<object>} 配置好的页面实例
 */
async function createAndConfigurePage(browser, config) {
  if (!browser.isConnected()) {
    throw new Error('浏览器连接已断开')
  }
  
  const page = await browser.newPage()
  
  // 设置页面错误处理
  page.on('error', (error) => {
    logger.error(`页面错误: ${error.message}`)
  })
  
  page.on('pageerror', (error) => {
    logger.error(`页面脚本错误: ${error.message}`)
  })
  
  // 设置视口和超时
  await page.setViewport({ 
    width: 1800, 
    height: 1000,
    deviceScaleFactor: 1
  })
  
  page.setDefaultTimeout(config.stability?.pageTimeout || 60000)
  page.setDefaultNavigationTimeout(config.stability?.navigationTimeout || 60000)
  
  return page
}

/**
 * @description 处理连接错误，提供诊断建议
 * @param {Error} error - 错误对象
 * @param {string} url - 目标 URL
 */
function handleConnectionError(error, url) {
  logger.error(`抓取 ${url} 时发生错误: ${error.message}`)
  
  if (error.message.includes('Protocol error') || error.message.includes('Connection closed')) {
    logger.error('检测到连接断开错误，建议:')
    logger.error('1. 检查网络连接是否稳定')
    logger.error('2. 尝试减少并发数量')
    logger.error('3. 增加请求间隔时间')
  }
  
  console.error(error.stack)
}

/**
 * @description 安全关闭页面
 * @param {object} page - Puppeteer 页面实例
 * @param {string} url - 目标 URL
 */
async function closePageSafely(page, url) {
  if (page && !page.isClosed()) {
    try {
      await page.close()
      logger.process(`页面 ${url} 已关闭。`)
    } catch (closeError) {
      logger.error(`关闭页面时发生错误: ${closeError.message}`)
    }
  }
}

/**
 * @description 单个 URL 的完整抓取流程编排
 * @param {string} url - 目标网站 URL
 * @param {object} browser - Puppeteer 浏览器实例
 * @param {object} config - 用户配置
 * @param {object} handlers - 处理函数集合
 * @param {Function} handlers.loadAndScrollPage - 页面加载函数
 * @param {Function} handlers.extractImageUrls - 图片URL提取函数
 * @param {Function} handlers.processUrlsByImageMode - URL处理函数
 * @returns {Promise<object|void>} 不同模式返回不同：twoPhaseApi/inline/twoPhase 返回处理结果对象；无图片时返回 void
 */
export async function orchestrateScraping(url, browser, config, handlers) {
  const { loadAndScrollPage, extractImageUrls, processUrlsByImageMode } = handlers
  let page
  
  try {
    page = await createAndConfigurePage(browser, config)
    
    const pageTitle = await loadAndScrollPage(page, url, config)
    const imageUrls = await extractImageUrls(page, url, config.imageDiscovery)
    const finalImageUrls = await processUrlsByImageMode(page, imageUrls, url, config.imageMode, config)

    if (finalImageUrls.length === 0) {
      logger.warn('此 URL 无需下载图片。')
      return
    }

    const context = { browser, config, pageTitle }
    const result = await orchestrateDownload(finalImageUrls, context)
    return result
    
  } catch (error) {
    handleConnectionError(error, url)
    handleFatalError(error, `URL: ${url}`, logger)
  } finally {
    await closePageSafely(page, url)
  }
}

/**
 * @description 编排下载流程，包括目录创建（按需）、队列处理和完成记录
 * @param {string[]} imageUrls - 要下载的图片 URL 列表
 * @param {object} context - 全局上下文对象
 * @returns {Promise<object|void>} 根据模式返回处理结果对象
 */
export async function orchestrateDownload(imageUrls, context) {
  const { config, pageTitle, htmlFilePath, isResumeDownload, totalImageCount, downloadedCount } = context

  // twoPhaseApi 不创建下载目录
  const mode = config?.analysis?.mode || 'inline'
  const baseDownloadDir = config.outputDirectory || './download'
  let targetDownloadDir = undefined
  if (mode !== 'twoPhaseApi') {
    targetDownloadDir = await createDownloadDirectory(baseDownloadDir, pageTitle)
  }

  const downloadedImages = []
  downloadedImages.htmlFilePath = htmlFilePath

  let result
  try {
    result = await processDownloadQueue(imageUrls, targetDownloadDir, context, downloadedImages)
  } finally {
    await completeHtmlProcessing(htmlFilePath, downloadedImages, {
      downloadedCount,
      totalImageCount,
      isResumeDownload
    })
  }

  return result
}
