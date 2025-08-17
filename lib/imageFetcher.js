import { logger } from '../utils/logger.js'
import { getSiteConfig } from '../config/config.js'
import { axiosFetchOnce } from './fetcher/axiosFetcher.js'
import { puppeteerFetchOnce } from './fetcher/puppeteerFetcher.js'
import { handleHtmlPage } from './fetcher/htmlPageHandler.js'
import { decideDownloadOrder } from './fetcher/strategySelector.js'

/**
 * 解析 data URI 为图片数据
 * @param {string} dataUri - data:image/* URI
 * @returns {object|null} - {buffer, finalUrl, headers} 或 null
 */
function parseDataUri(dataUri) {
  try {
    const comma = dataUri.indexOf(',')
    if (comma <= 0) return null
    
    const meta = dataUri.slice(5, comma) // 去掉 'data:'
    const data = dataUri.slice(comma + 1)
    const isBase64 = /;base64/i.test(meta)
    const buffer = isBase64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data))
    
    return {
      buffer,
      finalUrl: dataUri,
      headers: { 'content-type': meta.split(';')[0] || 'image/svg+xml' }
    }
  } catch (e) {
    logger.warn(`解析 data:image 失败，跳过: ${e.message}`)
    return null
  }
}

/**
 * 构建请求头（基于站点配置）
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
 * 执行 Axios 策略下载
 */
async function executeAxiosStrategy(imageUrl, headers, timeout, options) {
  return await axiosFetchOnce(imageUrl, headers, timeout, options)
}

/**
 * 执行 Puppeteer 策略下载
 */
async function executePuppeteerStrategy(params) {
  const { browser, imageUrl, headers, timeout, context, recursionDepth, options } = params
  const handleHtmlPageImpl = context?.handleHtmlPage || handleHtmlPage
  
  const result = await puppeteerFetchOnce({
    browser,
    imageUrl,
    headers,
    timeout,
    handleHtmlPageFn: handleHtmlPageImpl,
    context,
    recursionDepth,
    acceptBinaryContentTypes: options?.acceptBinaryContentTypes
  })
  
  if (result && result.redirectTo) {
    return await fetchImage(result.redirectTo, context, recursionDepth + 1)
  }
  
  return result
}

/**
 * 执行下载策略循环
 */
async function executeDownloadStrategies(params) {
  const { imageUrl, headers, timeout, browser, context, recursionDepth, acceptBinaryContentTypes, siteConfig } = params
  const options = { acceptBinaryContentTypes }
  
  const order = Array.isArray(context?.strategyOrder) ? context.strategyOrder : decideDownloadOrder(siteConfig)
  
  for (const strategy of order) {
    let result = null
    
    if (strategy === 'axios') {
      result = await executeAxiosStrategy(imageUrl, headers, timeout, options)
    } else if (strategy === 'puppeteer') {
      result = await executePuppeteerStrategy({
        browser, imageUrl, headers, timeout, context, recursionDepth, options
      })
    }
    
    if (result) return result
  }
  
  return null
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
    const dataResult = parseDataUri(imageUrl)
    if (dataResult) return dataResult
  }

  const siteConfig = getSiteConfig(imageUrl)
  const headers = buildHeaders(siteConfig)

  // 执行下载策略
  const acceptBinaryContentTypes = context?.config?.analysis?.acceptBinaryContentTypes
  return await executeDownloadStrategies({
    imageUrl, headers, timeout, browser, context, recursionDepth, acceptBinaryContentTypes, siteConfig
  })
}


