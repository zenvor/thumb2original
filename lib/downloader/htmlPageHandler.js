import { logger } from '../../utils/logger.js'
import { getSiteConfig } from '../../config/config.js'

/**
 * @description 在 HTML 页面中查找可能的图片 URL（启发式）。
 * @param {import('puppeteer').Page} page 页面
 * @returns {Promise<string|null>} 图片 URL 或 null
 */
export async function findImageInPage(page) {
  return await page.evaluate(() => {
    const imgElements = document.querySelectorAll('img')
    let bestImg = null
    let maxSize = 0
    for (const img of imgElements) {
      const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src')
      if (src && !src.startsWith('data:') && (src.includes('.jpg') || src.includes('.jpeg') || src.includes('.png') || src.includes('.gif') || src.includes('.webp'))) {
        const size = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0)
        if (size > maxSize) {
          maxSize = size
          bestImg = src
        }
      }
    }
    if (bestImg) return bestImg
    const links = document.querySelectorAll('a[href*=".jpg"], a[href*=".jpeg"], a[href*=".png"], a[href*=".gif"], a[href*=".webp"]')
    if (links.length > 0) return links[0].href
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


