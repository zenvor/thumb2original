import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger.js'

/**
 * @description 从页面中提取所有图像 URL。
 * @param {object} page - Puppeteer 页面实例。
 * @param {string} pageUrl - 当前页面的 URL。
 * @returns {Promise<string[]>} 提取到的图像 URL 数组。
 */
export async function extractImageUrls(page, pageUrl) {
  logger.info('正在从页面中提取图片 URL...')
  const base = pageUrl

  const imageUrls = await page.evaluate((baseUrl) => {
    function getAbsoluteUrl(url) {
      if (!url || url.startsWith('data:')) return null
      try {
        return new URL(url, baseUrl).href
      } catch (e) {
        return null
      }
    }

    const elements = Array.from(document.querySelectorAll('img[src]'))
    const urls = elements.map((el) => {
      const url = el.getAttribute('src')
      return getAbsoluteUrl(url)
    })

    const imageRegex = /\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff)$/i
    return urls.filter((url) => url && imageRegex.test(url.split('?')[0]))
  }, base)

  const webpVariations = imageUrls
    .filter((url) => url.includes('_webp'))
    .map((url) => url.replace('_webp', ''))

  const allUrls = [...imageUrls, ...webpVariations]
  const uniqueUrls = Array.from(new Set(allUrls))

  logger.debug(`找到 ${uniqueUrls.length} 个唯一的图片 URL。`)
  return uniqueUrls
}

/**
 * @description 从本地HTML文件中提取图像URL与标题。
 * @param {import('node:fs').PathLike} htmlFilePath - HTML文件路径。
 * @returns {Promise<{imageUrls: string[], title: string}>}
 */
export async function extractImageUrlsFromLocalHtml(htmlFilePath) {
  try {
    const htmlContent = await fs.readFile(htmlFilePath, 'utf-8')
    const fileName = path.basename(htmlFilePath, '.html')

    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
    const imageUrls = []
    let match

    while ((match = imgRegex.exec(htmlContent)) !== null) {
      const src = match[1]
      if (src && !src.startsWith('data:')) {
        imageUrls.push(src)
      }
    }

    const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : fileName

    logger.debug(`从 ${path.basename(htmlFilePath)} 提取到 ${imageUrls.length} 个图片URL`)

    return {
      imageUrls: Array.from(new Set(imageUrls)),
      title,
    }
  } catch (error) {
    logger.error(`读取HTML文件失败 ${htmlFilePath}: ${error.message}`)
    return { imageUrls: [], title: path.basename(htmlFilePath, '.html') }
  }
}


