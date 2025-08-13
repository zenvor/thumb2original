import { logger } from '../../utils/logger.js'

/**
 * @description 使用 Puppeteer 处理图片直链或 HTML 页面。仅完成单次尝试，不含重试。
 * @param {import('puppeteer').Browser} browser 浏览器实例
 * @param {string} imageUrl 目标 URL
 * @param {object} headers 额外请求头
 * @param {number} timeout 超时时间
 * @param {Function} handleHtmlPageFn 处理 HTML 页的回调 (page, url, context, recursionDepth) => Promise<...>
 * @param {object} context 上下文（需包含 browser 等）
 * @param {number} recursionDepth 递归深度
 * @returns {Promise<{buffer: Buffer, finalUrl: string, headers: object}|null>}
 */
export async function puppeteerDownloadOnce(browser, imageUrl, headers, timeout, handleHtmlPageFn, context, recursionDepth) {
  const page = await browser.newPage()
  try {
    await page.setExtraHTTPHeaders(headers || {})
    const response = await page.goto(imageUrl, { waitUntil: 'networkidle0', timeout })
    if (!response) {
      await page.close()
      logger.warn(`Puppeteer 导航未得到响应: ${imageUrl}`)
      return null
    }
    const headersMap = response.headers()
    const contentType = headersMap['content-type']
    const contentDisposition = headersMap['content-disposition']

    if (contentType && contentType.includes('text/html')) {
      const result = await handleHtmlPageFn(page, imageUrl, context, recursionDepth)
      await page.close()
      if (result && result.actualImageUrl) {
        return { redirectTo: result.actualImageUrl }
      }
      return null
    }

    if ((contentType && contentType.startsWith('image/')) || (contentDisposition && /attachment/i.test(contentDisposition)) || !contentType) {
      const buffer = await response.buffer()
      const result = { buffer, finalUrl: response.url(), headers: headersMap }
      await page.close()
      return result
    }

    throw new Error(`不支持的 Content-Type: ${contentType || 'unknown'}`)
  } catch (error) {
    try { await page.close() } catch {}
    logger.warn(`Puppeteer 单次下载失败: ${imageUrl} - ${error.message}`)
    return null
  }
}


