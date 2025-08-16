import { logger } from '../utils/logger.js'
import { getSiteConfig } from '../config/config.js'
import { axiosFetchOnce } from './fetcher/axiosFetcher.js'
import { puppeteerFetchOnce } from './fetcher/puppeteerFetcher.js'
import { handleHtmlPage } from './fetcher/htmlPageHandler.js'
import { decideDownloadOrder } from './fetcher/strategySelector.js'

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
 * @description 访问/获取（fetch）单个图像（Axios 或 Puppeteer，无内部重试）。
 * @param {string} imageUrl 图像 URL
 * @param {object} context 包含 browser 与 config 的上下文
 * @param {number} recursionDepth 递归层级，限制 HTML 跳转深度
 * @returns {Promise<{buffer: Buffer, finalUrl: string, headers: object}|null>}
 */
export async function fetchImage(imageUrl, context, recursionDepth = 0) {
  logger.download(`开始访问图片: ${imageUrl}`)
  const { config, browser } = context
  const timeout = 300 * 1000

  if (recursionDepth > 3) {
    logger.error(`递归深度超过限制，停止处理: ${imageUrl}`)
    return null
  }

  // data:image/* 直接解码为 Buffer，避免网络请求
  if (typeof imageUrl === 'string' && imageUrl.startsWith('data:')) {
    try {
      const comma = imageUrl.indexOf(',')
      if (comma > 0) {
        const meta = imageUrl.slice(5, comma) // 去掉 'data:'
        const data = imageUrl.slice(comma + 1)
        const isBase64 = /;base64/i.test(meta)
        const buffer = isBase64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data))
        return { buffer, finalUrl: imageUrl, headers: { 'content-type': meta.split(';')[0] || 'image/svg+xml' } }
      }
    } catch (e) {
      logger.warn(`解析 data:image 失败，跳过: ${e.message}`)
    }
  }

  const siteConfig = getSiteConfig(imageUrl)
  const headers = buildHeaders(siteConfig)

  // 根据站点配置或测试上下文动态决定访问顺序
  const order = Array.isArray(context?.strategyOrder) ? context.strategyOrder : decideDownloadOrder(siteConfig)
  const handleHtmlPageImpl = context?.handleHtmlPage || handleHtmlPage
  for (const strategy of order) {
    if (strategy === 'axios') {
      const acceptBinaryContentTypes = context?.config?.analysis?.acceptBinaryContentTypes
      const result = await axiosFetchOnce(imageUrl, headers, timeout, { acceptBinaryContentTypes })
      if (result) return result
    } else if (strategy === 'puppeteer') {
      const acceptBinaryContentTypes = context?.config?.analysis?.acceptBinaryContentTypes
      const result = await puppeteerFetchOnce(
        browser, imageUrl, headers, timeout, handleHtmlPageImpl, context, recursionDepth,
        { acceptBinaryContentTypes }
      )
      if (result && result.redirectTo) {
        return await fetchImage(result.redirectTo, context, recursionDepth + 1)
      }
      if (result) return result
    }
  }

  return null
}


