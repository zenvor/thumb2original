// 公共 API 门面：保持对外 API 兼容性，内部委托给拆分后的模块
import { orchestrateDownload, orchestrateScraping } from './scraperOrchestrator.js'
import { saveImage as saveImageImpl } from './fileManager.js'

/**
 * @description 保存图像 Buffer 到文件系统（兼容性接口）。
 * @param {Buffer} buffer - 图像 Buffer。
 * @param {string} filePath - 目标文件路径。
 * @param {string} imageUrl - 原始图像 URL，用于错误记录。
 * @param {object} stats - 用于跟踪下载统计的对象。
 * @param {Array} [imageInfoList] - 图片信息列表，用于收集下载的图片信息。
 * @returns {Promise<void>}
 */
export async function saveImage(buffer, filePath, imageUrl, stats, imageInfoList = null, config = undefined, analysisResult = undefined) {
  // 委托给新的文件管理器
  return await saveImageImpl(buffer, filePath, imageUrl, stats, imageInfoList, config, analysisResult)
}

/**
 * @description 管理和执行图片下载任务，包括并发控制和重试机制。
 * @param {string[]} imageUrls - 要下载的图片 URL 列表。
 * @param {object} context - 全局上下文对象。
 * @returns {Promise<void>}
 */
export async function downloadManager(imageUrls, context) {
  // 委托给新的编排器
  return await orchestrateDownload(imageUrls, context)
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
  // 委托给新的编排器，适配新的参数结构
  const handlers = { loadAndScrollPage, extractImageUrls, processUrlsByImageMode }
  return await orchestrateScraping(url, browser, config, handlers)
}
