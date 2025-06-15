// download/DownloadUtils.js
import fs from 'fs'

/**
 * 🛠️ 下载工具函数库
 * 提供与下载流程相关的通用辅助函数。
 */

/**
 * 创建目标目录
 * @param {string} dirPath - 目录路径
 * @param {import('../Logger').Logger} logger - 日志记录器实例
 * @param {boolean} [enableProgressBar] - 是否启用进度条模式
 */
export function createTargetDirectory(dirPath, logger, enableProgressBar = false) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
    // 在启用进度条模式时，抑制文件夹创建成功的日志输出，避免与进度条显示冲突
    if (enableProgressBar) {
      logger.debug(`文件夹${dirPath}创建成功`)
    } else {
      logger.success(`文件夹${dirPath}创建成功`)
    }
  }
}

/**
 * 生成随机间隔时间
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number}
 */
export function generateRandomInterval(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min)
}

/**
 * 判断指定URL是否应该使用Puppeteer
 * @param {string} imageUrl - 图片URL
 * @param {string} currentUrl - 当前页面URL
 * @param {Object} config - 配置对象
 * @returns {boolean}
 */
export function shouldUsePuppeteer(imageUrl, currentUrl, config) {
  const downloadMethod = config.downloadMethod
  const downloadMode = config.downloadMode

  // 根据用户配置的下载方式决定使用哪种下载方法
  switch (downloadMethod) {
    case 'axios':
      // 强制使用Axios下载所有图片
      return false
    
    case 'puppeteer-priority':
      // 优先使用Puppeteer（当前默认行为）
      return shouldUsePuppeteerAuto(imageUrl, currentUrl, downloadMode)
    
    case 'auto':
    default:
      // 智能选择（保持原有逻辑）
      return shouldUsePuppeteerAuto(imageUrl, currentUrl, downloadMode)
  }
}

/**
 * 智能选择是否使用Puppeteer（原有逻辑）
 * @param {string} imageUrl - 图片URL
 * @param {string} currentUrl - 当前页面URL
 * @param {string} downloadMode - 下载模式
 * @returns {boolean}
 */
function shouldUsePuppeteerAuto(imageUrl, currentUrl, downloadMode) {
  if (currentUrl.includes('https://chpic.su') && downloadMode === 'downloadOriginImagesByThumbnails') {
    return false
  }
  if (imageUrl.includes('direct-download') || imageUrl.includes('cdn.example.com')) {
    return false
  }
  return true
}

/**
 * 估算需要使用Puppeteer的请求数量
 * @param {string[]} imageUrls - 图片URL数组
 * @param {string} currentUrl - 当前页面URL
 * @param {number} maxConcurrentRequests - 最大并发数
 * @param {Object} config - 配置对象
 * @returns {number}
 */
export function estimatePuppeteerNeeds(imageUrls, currentUrl, maxConcurrentRequests, config) {
  const batchSize = Math.min(maxConcurrentRequests, imageUrls.length)
  let puppeteerCount = 0
  for (let i = 0; i < batchSize; i++) {
    if (shouldUsePuppeteer(imageUrls[i], currentUrl, config)) {
      puppeteerCount++
    }
  }
  return puppeteerCount
}