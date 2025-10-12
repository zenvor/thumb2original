import { logger } from '../../utils/logger.js'
import { shouldAcceptResponse } from '../../utils/contentPolicy.js'

/**
 * @typedef {object} PuppeteerFetchConfig
 * @property {import('puppeteer').Browser} browser 浏览器实例
 * @property {string} imageUrl 目标 URL
 * @property {object} [headers] 额外请求头
 * @property {number} [timeout] 超时时间
 * @property {object} context 上下文（需包含 browser 等）
 * @property {number} recursionDepth 递归深度
 * @property {boolean|string[]} [acceptBinaryContentTypes] 内容可接受性策略配置
 */

/**
 * @description 使用 Puppeteer 处理图片直链或 HTML 页面。仅完成单次尝试，不含重试。
 * @param {PuppeteerFetchConfig} config 配置对象
 * @returns {Promise<{buffer: Buffer, finalUrl: string, headers: object} | {redirectTo: string} | null>}
 */
export async function puppeteerFetchOnce(config) {
  // 输入验证
  if (!config || typeof config !== 'object') {
    logger.warn('Puppeteer获取失败：无效的配置参数')
    return null
  }
  
  const { browser, imageUrl, headers, timeout, context, recursionDepth, acceptBinaryContentTypes } = config
  
  if (!browser) {
    logger.warn('Puppeteer获取失败：缺少浏览器实例')
    return null
  }
  
  if (!imageUrl || typeof imageUrl !== 'string') {
    logger.warn('Puppeteer获取失败：无效的URL参数')
    return null
  }
  
  if (timeout && (typeof timeout !== 'number' || timeout <= 0)) {
    logger.warn('Puppeteer获取失败：无效的超时参数')
    return null
  }

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

    // 处理 HTML 页面 - 新策略：直接标记为失败，依赖重试机制
    if (ctBare.includes('text/html')) {
      await page.close()
      logger.info(
        `检测到 HTML 响应，标记为失败以触发重试: ${imageUrl}`,
        logger.categories.NETWORK,
        { ctBare: ctBare || '', finalUrl: response.url() }
      )
      return null
    }

    // 处理二进制内容
    const isAllowed = shouldAcceptResponse(headersMap, acceptBinaryContentTypes)
    if (isAllowed) {
      const buffer = await response.buffer()
      const result = { buffer, finalUrl: response.url(), headers: headersMap }
      await page.close()
      return result
    }

    await page.close()
    logger.info(
      `返回内容不是图片或不在允许范围，已标记失败以触发重试: ${imageUrl} Content-Type=${ctBare || '(empty)'}`,
      logger.categories.NETWORK,
      {
        status: response.status(),
        finalUrl: response.url(),
        contentType: contentType || '',
        ctBare: ctBare || '',
        contentLength: headersMap['content-length'] || '',
        contentDisposition: headersMap['content-disposition'] || '',
        policyMode: Array.isArray(acceptBinaryContentTypes)
          ? 'custom'
          : (acceptBinaryContentTypes === true ? 'relaxed' : 'strict'),
        recursionDepth
      }
    )
    return null
  } catch (error) {
    try { 
      await page.close() 
    } catch (closeError) {
      logger.warn(`页面关闭失败: ${closeError.message}`)
    }
    logger.warn(`Puppeteer 单次访问失败: ${imageUrl} - ${error.message}`)
    return null
  }
}
