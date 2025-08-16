import { logger } from '../../utils/logger.js'
import { shouldAcceptResponse } from '../../utils/contentPolicy.js'

/**
 * @description 使用 Puppeteer 处理图片直链或 HTML 页面。仅完成单次尝试，不含重试。
 * @param {import('puppeteer').Browser} browser 浏览器实例
 * @param {string} imageUrl 目标 URL
 * @param {object} headers 额外请求头
 * @param {number} timeout 超时时间
 * @param {Function} handleHtmlPageFn 处理 HTML 页的回调 (page, url, context, recursionDepth) => Promise<...>
 * @param {object} context 上下文（需包含 browser 等）
 * @param {number} recursionDepth 递归深度
 * @param {{ acceptBinaryContentTypes: boolean|string[] }} [options] 内容可接受性策略配置（调用方显式传入）
 * - options.acceptBinaryContentTypes: 参见 `utils/contentPolicy.js` 中的 AcceptBinaryContentTypes 语义
 * @returns {Promise<{buffer: Buffer, finalUrl: string, headers: object} | {redirectTo: string} | null>}
 */
export async function puppeteerFetchOnce(browser, imageUrl, headers, timeout, handleHtmlPageFn, context, recursionDepth, options = {}) {
  const page = await browser.newPage()
  try {
    await page.setExtraHTTPHeaders(headers || {})
    const response = await page.goto(imageUrl, { waitUntil: 'networkidle0', timeout })
    if (!response) {
      await page.close()
      logger.warn(`Puppeteer 访问未得到响应: ${imageUrl}`)
      return null
    }
    const headersMap = response.headers()
    const contentType = headersMap['content-type']
    const ctLower = (contentType || '').toLowerCase()
    const ctBare = ctLower ? ctLower.split(';')[0].trim() : ''

    if (ctBare.includes('text/html')) {
      const result = await handleHtmlPageFn(page, imageUrl, context, recursionDepth)
      await page.close()
      if (result && result.actualImageUrl) {
        return { redirectTo: result.actualImageUrl }
      }
      return null
    }

    const accept = options?.acceptBinaryContentTypes
    const isAllowed = shouldAcceptResponse(headersMap, accept)
    if (isAllowed) {
      const buffer = await response.buffer()
      const result = { buffer, finalUrl: response.url(), headers: headersMap }
      await page.close()
      return result
    }

    await page.close()
    logger.info(`Puppeteer 响应类型不被允许，将回退: ${imageUrl} ct=${ctBare || '(empty)'}`)
    return null
  } catch (error) {
    try { await page.close() } catch {}
    logger.warn(`Puppeteer 单次访问失败: ${imageUrl} - ${error.message}`)
    return null
  }
}






