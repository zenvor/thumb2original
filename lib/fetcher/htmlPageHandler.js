import { logger } from '../../utils/logger.js'
import { getSiteConfig } from '../../config/config.js'

/**
 * 检查 URL 是否为有效图片格式
 * @param {string} src URL 字符串
 * @returns {boolean} 是否有效
 */
function isValidImageUrl(src) {
  if (!src || src.startsWith('data:')) return false
  return src.includes('.jpg') || src.includes('.jpeg') || 
         src.includes('.png') || src.includes('.gif') || 
         src.includes('.webp')
}

/**
 * 提取图片元素的源地址
 * @param {Element} img 图片元素
 * @returns {string|null} 图片地址
 */
function getImageSrc(img) {
  return img.src || 
         img.getAttribute('data-src') || 
         img.getAttribute('data-original') || 
         img.getAttribute('data-lazy-src')
}

/**
 * 计算图片尺寸
 * @param {Element} img 图片元素
 * @returns {number} 尺寸（宽*高）
 */
function getImageSize(img) {
  const width = img.naturalWidth || img.width || 0
  const height = img.naturalHeight || img.height || 0
  return width * height
}

/**
 * 查找最大的图片元素
 * @returns {string|null} 最佳图片 URL
 */
function findBestImageElement() {
  const imgElements = document.querySelectorAll('img')
  let bestImg = null
  let maxSize = 0
  
  for (const img of imgElements) {
    const src = getImageSrc(img)
    if (isValidImageUrl(src)) {
      const size = getImageSize(img)
      if (size > maxSize) {
        maxSize = size
        bestImg = src
      }
    }
  }
  return bestImg
}

/**
 * 查找图片链接
 * @returns {string|null} 图片链接 URL
 */
function findImageLinks() {
  const selectors = [
    'a[href*=".jpg"]', 'a[href*=".jpeg"]', 
    'a[href*=".png"]', 'a[href*=".gif"]', 
    'a[href*=".webp"]'
  ]
  const links = document.querySelectorAll(selectors.join(', '))
  return links.length > 0 ? links[0].href : null
}

/**
 * 查找背景图片
 * @returns {string|null} 背景图片 URL
 */
function findBackgroundImages() {
  const containers = document.querySelectorAll('[style*="background-image"]')
  
  for (const container of containers) {
    const style = container.style.backgroundImage
    if (style.includes('url(')) {
      // 简单前缀匹配替代复杂正则
      let url = style
      if (url.includes('url("')) {
        url = url.slice(url.indexOf('url("') + 5)
        url = url.slice(0, url.indexOf('")'))
      } else if (url.includes('url(\'')) {
        url = url.slice(url.indexOf('url(\'') + 5)
        url = url.slice(0, url.indexOf('\')'))
      } else if (url.includes('url(')) {
        url = url.slice(url.indexOf('url(') + 4)
        url = url.slice(0, url.indexOf(')'))
      }
      
      if (isValidImageUrl(url)) {
        return url
      }
    }
  }
  return null
}

/**
 * @description 在 HTML 页面中查找可能的图片 URL（启发式）。
 * @param {import('puppeteer').Page} page 页面
 * @returns {Promise<string|null>} 图片 URL 或 null
 */
export async function findImageInPage(page) {
  return await page.evaluate(() => {
    // 按优先级顺序查找
    return findBestImageElement() || 
           findImageLinks() || 
           findBackgroundImages()
  })
}

/**
 * @description 处理 HTML 页面：寻找真实图片并回调下载。
 * @param {import('puppeteer').Page} page 页面
 * @param {string} imageUrl 原始 URL
 * @param {object} context 上下文
 * @param {number} recursionDepth 递归深度
 */
export async function handleHtmlPage(page, imageUrl, context, recursionDepth) {
  logger.info(`检测到 HTML 页面，尝试在页面中查找图片: ${imageUrl}`)
  const siteConfig = getSiteConfig(imageUrl)
  await new Promise(resolve => setTimeout(resolve, siteConfig.waitTime))
  try {
    await page.waitForSelector('img', { timeout: siteConfig.selectorWaitTime })
  } catch (e) {
    logger.warn('等待图片元素超时，继续尝试查找')
  }
  const actualImageUrl = await findImageInPage(page)
  if (actualImageUrl) {
    logger.process(`找到实际图片链接: ${actualImageUrl}`)
    return { actualImageUrl }
  } else {
    throw new Error(`在 HTML 页面中未找到图片: ${imageUrl}`)
  }
}




