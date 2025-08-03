import axios from 'axios'
import { logger } from '../utils/logger.js'
import { getSiteConfig } from '../config/config.js'

/**
 * @description 在页面中查找实际的图片 URL。
 * @param {object} page - Puppeteer 页面实例。
 * @returns {Promise<string|null>} 找到的图片 URL，如果没找到则返回 null。
 */
export async function findImageInPage(page) {
  return await page.evaluate(() => {
    // 查找可能的图片元素，优先查找最大的图片
    const imgElements = document.querySelectorAll('img')
    let bestImg = null
    let maxSize = 0
    
    for (const img of imgElements) {
      const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src')
      if (src && !src.startsWith('data:') && (src.includes('.jpg') || src.includes('.jpeg') || src.includes('.png') || src.includes('.gif') || src.includes('.webp'))) {
        // 计算图片大小（宽度 * 高度）
        const size = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0)
        if (size > maxSize) {
          maxSize = size
          bestImg = src
        }
      }
    }
    
    if (bestImg) return bestImg
    
    // 如果没找到合适的 img 元素，查找可能包含图片链接的其他元素
    const links = document.querySelectorAll('a[href*=".jpg"], a[href*=".jpeg"], a[href*=".png"], a[href*=".gif"], a[href*=".webp"]')
    if (links.length > 0) {
      return links[0].href
    }
    
    // 特殊处理：查找可能的图片容器
    const containers = document.querySelectorAll('[style*="background-image"]')
    for (const container of containers) {
      const style = container.style.backgroundImage
      const match = style.match(/url\(["']?([^"')]+)["']?\)/)
      if (match && match[1] && (match[1].includes('.jpg') || match[1].includes('.jpeg') || match[1].includes('.png') || match[1].includes('.gif') || match[1].includes('.webp'))) {
        return match[1]
      }
    }
    
    return null
  })
}

/**
 * @description 使用 Axios 下载图片。
 * @param {string} imageUrl - 图片 URL。
 * @param {object} siteConfig - 网站配置。
 * @param {number} timeout - 超时时间。
 * @returns {Promise<{buffer: Buffer, finalUrl: string, headers: object}|null>} 下载结果。
 */
export async function downloadWithAxios(imageUrl, siteConfig, timeout) {
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
    }
    
    // 添加自定义请求头（如果配置了的话）
    if (siteConfig.customHeaders) {
      Object.assign(headers, siteConfig.customHeaders)
    }
    
    if (siteConfig.needsReferer) {
      headers['Referer'] = siteConfig.refererUrl
    }
    
    logger.debug(`使用 Axios 下载图片，请求头: ${JSON.stringify(headers, null, 2)}`, logger.categories.NETWORK)
    
    const response = await axios({
      url: imageUrl,
      responseType: 'arraybuffer',
      timeout,
      headers
    })
    
    logger.success(`Axios 下载成功: ${imageUrl}`)
    
    return {
      buffer: Buffer.from(response.data),
      finalUrl: imageUrl,
      headers: response.headers,
    }
  } catch (error) {
    logger.error(`Axios 下载失败 ${imageUrl}: ${error.code || error.message}`)
    return null
  }
}

/**
 * @description 处理 HTML 页面中的图片查找和下载。
 * @param {object} page - Puppeteer 页面实例。
 * @param {string} imageUrl - 原始图片 URL。
 * @param {object} context - 上下文对象。
 * @param {number} recursionDepth - 递归深度。
 * @returns {Promise<{buffer: Buffer, finalUrl: string, headers: object}|null>} 下载结果。
 */
export async function handleHtmlPage(page, imageUrl, context, recursionDepth) {
  logger.info(`检测到 HTML 页面，尝试在页面中查找图片: ${imageUrl}`)
  
  const siteConfig = getSiteConfig(imageUrl)
  
  // 根据网站配置等待页面加载
  await new Promise(resolve => setTimeout(resolve, siteConfig.waitTime))
  
  // 尝试等待图片元素出现
  try {
    await page.waitForSelector('img', { timeout: siteConfig.selectorWaitTime })
  } catch (e) {
    logger.warn(`等待图片元素超时，继续尝试查找`)
  }
  
  // 查找页面中的实际图片 URL
  const actualImageUrl = await findImageInPage(page)
  
  if (actualImageUrl) {
    logger.process(`找到实际图片链接: ${actualImageUrl}`)
    // 递归调用下载实际的图片
    return await fetchImage(actualImageUrl, context, recursionDepth + 1)
  } else {
    throw new Error(`在 HTML 页面中未找到图片: ${imageUrl}`)
  }
}

/**
 * @description 使用 Puppeteer 页面或 Axios 下载单个图像，带有重试机制。
 * @param {string} imageUrl - 要下载的图像 URL。
 * @param {object} context - 包含浏览器实例、配置和页面标题等信息的上下文对象。
 * @param {number} recursionDepth - 递归深度，防止无限递归。
 * @returns {Promise<{buffer: Buffer, finalUrl: string, headers: object}|null>} 包含 Buffer 和最终 URL 的对象，如果失败则返回 null。
 */
export async function fetchImage(imageUrl, context, recursionDepth = 0) {

  logger.download(`开始下载图片: ${imageUrl}`)
  const { config, browser } = context
  const timeout = 300 * 1000 // 300 seconds timeout for large images (3MB+)
  
  // 防止无限递归
  if (recursionDepth > 3) {
    logger.error(`递归深度超过限制，停止处理: ${imageUrl}`)
    return null
  }

  const siteConfig = getSiteConfig(imageUrl)
  
  // 根据网站配置决定是否优先使用 Axios
  if (siteConfig.useAxiosFirst && config.imageMode === 'originals_only') {
    const result = await downloadWithAxiosWithRetry(imageUrl, siteConfig, timeout, 3)
    if (result) return result
  }

  // 先尝试 Puppeteer 下载（带重试）
  const puppeteerResult = await downloadWithPuppeteerWithRetry(imageUrl, context, timeout, recursionDepth, 3)
  if (puppeteerResult) {
    return puppeteerResult
  }

  // Puppeteer 失败后，切换到 Axios 备用方案（带重试）
  logger.info(`Puppeteer 重试失败，切换到 Axios 备用方案: ${imageUrl}`)
  return await downloadWithAxiosWithRetry(imageUrl, siteConfig, timeout, 3)
}

/**
 * @description 带重试机制的 Puppeteer 下载函数。
 * @param {string} imageUrl - 要下载的图像 URL。
 * @param {object} context - 上下文对象。
 * @param {number} timeout - 超时时间。
 * @param {number} recursionDepth - 递归深度。
 * @param {number} maxRetries - 最大重试次数。
 * @returns {Promise<{buffer: Buffer, finalUrl: string, headers: object}|null>} 下载结果。
 */
async function downloadWithPuppeteerWithRetry(imageUrl, context, timeout, recursionDepth, maxRetries) {
  const { browser } = context
  const siteConfig = getSiteConfig(imageUrl)
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const page = await browser.newPage()
    try {
      if (attempt > 1) {
        logger.warn(`Puppeteer 第 ${attempt}/${maxRetries} 次重试: ${imageUrl}`)
        // 重试前等待一段时间
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt))
      }
      
      // 构建请求头
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
      }
      
      // 添加自定义请求头（如果配置了的话）
      if (siteConfig.customHeaders) {
        Object.assign(headers, siteConfig.customHeaders)
      }
      
      if (siteConfig.needsReferer) {
        headers['Referer'] = siteConfig.refererUrl
      }
      
      logger.debug(`使用 Puppeteer 下载图片，请求头: ${JSON.stringify(headers, null, 2)}`, logger.categories.NETWORK)
      
      await page.setExtraHTTPHeaders(headers)
      
      const response = await page.goto(imageUrl, { waitUntil: 'networkidle0', timeout })
      const contentType = response.headers()['content-type']
      logger.debug(`响应内容类型: ${contentType}，URL: ${imageUrl}`, logger.categories.NETWORK)
      
      // 如果返回的是 HTML 页面，处理页面中的图片查找
      if (contentType && contentType.includes('text/html')) {
        logger.info(`检测到 HTML 页面，尝试在页面中查找图片: ${imageUrl}`)
        const result = await handleHtmlPage(page, imageUrl, context, recursionDepth)
        await page.close()
        return result
      }
      
      // 验证是否为图片类型
      if (!contentType || !contentType.startsWith('image/')) {
        throw new Error(`Invalid content-type: ${contentType}`)
      }
      
      const buffer = await response.buffer()
      const result = { buffer, finalUrl: response.url(), headers: response.headers() }
      await page.close()
      return result
      
    } catch (error) {
      await page.close()
      
      if (attempt === maxRetries) {
        logger.error(`Puppeteer 下载失败，已重试 ${maxRetries} 次: ${imageUrl} - ${error.message}`)
        return null
      }
      
      logger.warn(`Puppeteer 下载失败 (${attempt}/${maxRetries}): ${imageUrl} - ${error.message}`)
    }
  }
  
  return null
}

/**
 * @description 带重试机制的 Axios 下载函数。
 * @param {string} imageUrl - 要下载的图像 URL。
 * @param {object} siteConfig - 网站配置。
 * @param {number} timeout - 超时时间。
 * @param {number} maxRetries - 最大重试次数。
 * @returns {Promise<{buffer: Buffer, finalUrl: string, headers: object}|null>} 下载结果。
 */
async function downloadWithAxiosWithRetry(imageUrl, siteConfig, timeout, maxRetries) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        logger.warn(`Axios 第 ${attempt}/${maxRetries} 次重试: ${imageUrl}`)
        // 重试前等待一段时间
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt))
      }
      
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
      }
      
      // 添加自定义请求头（如果配置了的话）
      if (siteConfig.customHeaders) {
        Object.assign(headers, siteConfig.customHeaders)
      }
      
      if (siteConfig.needsReferer) {
        headers['Referer'] = siteConfig.refererUrl
      }
      
      logger.debug(`使用 Axios 下载图片，请求头: ${JSON.stringify(headers, null, 2)}`, logger.categories.NETWORK)
      
      const response = await axios({
        url: imageUrl,
        responseType: 'arraybuffer',
        timeout,
        headers
      })
      
      logger.success(`Axios 下载成功 (重试 ${attempt}/${maxRetries}): ${imageUrl}`)
      
      return {
        buffer: Buffer.from(response.data),
        finalUrl: imageUrl,
        headers: response.headers,
      }
      
    } catch (error) {
      if (attempt === maxRetries) {
        logger.error(`Axios 下载失败，已重试 ${maxRetries} 次: ${imageUrl} - ${error.code || error.message}`)
        return null
      }
      
      logger.warn(`Axios 下载失败 (${attempt}/${maxRetries}): ${imageUrl} - ${error.code || error.message}`)
    }
  }
  
  return null
}