import { logger } from '../utils/logger.js'
import { getSiteConfig } from '../config/config.js'
import { axiosDownloadOnce } from './downloader/axiosDownloader.js'
import { puppeteerDownloadOnce } from './downloader/puppeteerDownloader.js'
import { handleHtmlPage } from './downloader/htmlPageHandler.js'
import { decideDownloadOrder } from './downloader/strategySelector.js'

/**
 * @description 构建请求头（基于站点配置）。
 * @param {object} siteConfig 站点配置
 */
function buildHeaders(siteConfig) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
  }
  if (siteConfig.customHeaders) Object.assign(headers, siteConfig.customHeaders)
  if (siteConfig.needsReferer) headers['Referer'] = siteConfig.refererUrl
  return headers
}

/**
 * @description 使用 Axios 或 Puppeteer 下载单个图像（无内部重试）。
 * @param {string} imageUrl 图像 URL
 * @param {object} context 包含 browser 与 config 的上下文
 * @param {number} recursionDepth 递归层级，限制 HTML 跳转深度
 * @returns {Promise<{buffer: Buffer, finalUrl: string, headers: object}|null>}
 */
export async function fetchImage(imageUrl, context, recursionDepth = 0) {
  logger.download(`开始下载图片: ${imageUrl}`)
  const { config, browser } = context
  const timeout = 300 * 1000

  if (recursionDepth > 3) {
    logger.error(`递归深度超过限制，停止处理: ${imageUrl}`)
    return null
  }

  const siteConfig = getSiteConfig(imageUrl)
  const headers = buildHeaders(siteConfig)

  // 根据站点配置或测试上下文动态决定下载顺序
  const order = Array.isArray(context?.strategyOrder) ? context.strategyOrder : decideDownloadOrder(siteConfig)
  const handleHtmlPageImpl = context?.handleHtmlPage || handleHtmlPage
  for (const strategy of order) {
    if (strategy === 'axios') {
      const result = await axiosDownloadOnce(imageUrl, headers, timeout)
      if (result) return result
    } else if (strategy === 'puppeteer') {
      const result = await puppeteerDownloadOnce(browser, imageUrl, headers, timeout, handleHtmlPageImpl, context, recursionDepth)
      if (result && result.redirectTo) {
        return await fetchImage(result.redirectTo, context, recursionDepth + 1)
      }
      if (result) return result
    }
  }

  return null
}