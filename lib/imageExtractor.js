import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger.js'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * 读取浏览器端脚本内容
 */
async function loadClientScript() {
  const clientScriptPath = path.join(__dirname, 'browser-scripts', 'imageExtractorClient.js')
  return await fs.readFile(clientScriptPath, 'utf-8')
}

/**
 * 生成 WebP 变体 URL
 * @param {string[]} imageUrls 原始图片 URL 数组
 * @returns {string[]} WebP 变体 URL 数组
 */
function generateWebpVariations(imageUrls) {
  return imageUrls
    .filter(url => url.includes('_webp'))
    .map(url => url.replace('_webp', ''))
}

/**
 * 去重并返回唯一的 URL 数组
 * @param {string[]} urls URL 数组
 * @returns {string[]} 去重后的 URL 数组
 */
function deduplicateUrls(urls) {
  return Array.from(new Set(urls))
}

/**
 * @description 从页面中提取所有图像 URL。
 * @param {object} page - Puppeteer 页面实例。
 * @param {string} pageUrl - 当前页面的 URL。
 * @param {object} discoveryOptions - 发现选项配置
 * @returns {Promise<string[]>} 提取到的图像 URL 数组。
 */
export async function extractImageUrls(page, pageUrl, discoveryOptions = {}) {
  logger.info('正在从页面中提取图片 URL...')
  
  const options = {
    includeInlineSvg: false,
    includeFavicon: false,
    includeCssBackgrounds: false,
    includeDataUri: false,
    ...discoveryOptions
  }

  try {
    // 注入客户端脚本并执行
    const clientScript = await loadClientScript()
    const imageUrls = await page.evaluate((pageUrl, options, clientScript) => {
      // 注入客户端脚本代码
      eval(clientScript)
      // 调用提取函数
      return extractImageUrls(pageUrl, options)
    }, pageUrl, options, clientScript)

    // 处理 WebP 变体
    const webpVariations = generateWebpVariations(imageUrls)
    const allUrls = [...imageUrls, ...webpVariations]
    const uniqueUrls = deduplicateUrls(allUrls)

    logger.debug(`找到 ${uniqueUrls.length} 个唯一的图片 URL。`)
    return uniqueUrls
  } catch (error) {
    logger.error(`页面图片提取失败: ${error.message}`)
    return []
  }
}

/**
 * @description 从本地HTML文件中提取图像URL与标题。
 * @param {import('node:fs').PathLike} htmlFilePath - HTML文件路径。
 * @returns {Promise<{imageUrls: string[], title: string}>}
 */
export async function extractImageUrlsFromLocalHtml(htmlFilePath, options = {}) {
  try {
    const htmlContent = await fs.readFile(htmlFilePath, 'utf-8')
    const fileName = path.basename(htmlFilePath, '.html')
    
    const { imageUrls, title } = parseHtmlForImages(htmlContent, fileName, options)
    
    logger.debug(`从 ${path.basename(htmlFilePath)} 提取到 ${imageUrls.length} 个图片URL`)
    
    return { imageUrls, title }
  } catch (error) {
    logger.error(`读取HTML文件失败 ${htmlFilePath}: ${error.message}`)
    return { imageUrls: [], title: path.basename(htmlFilePath, '.html') }
  }
}

/**
 * 从HTML内容中解析图片URL和标题
 * @param {string} htmlContent HTML内容
 * @param {string} fileName 文件名（作为默认标题）
 * @param {object} options 选项
 * @returns {{imageUrls: string[], title: string}}
 */
function parseHtmlForImages(htmlContent, fileName, options = {}) {
  const imageUrls = []
  const includeDataUri = !!options.includeDataUri
  
  // 简化策略：使用 indexOf 和 substring 替代复杂正则
  let searchIndex = 0
  while (true) {
    // 查找 <img 标签
    const imgStart = htmlContent.indexOf('<img', searchIndex)
    if (imgStart === -1) break
    
    // 查找该img标签的结束
    const imgEnd = htmlContent.indexOf('>', imgStart)
    if (imgEnd === -1) break
    
    const imgTag = htmlContent.substring(imgStart, imgEnd + 1)
    
    // 提取 src 属性
    const src = extractSrcFromImgTag(imgTag)
    if (src) {
      if (src.startsWith('data:')) {
        if (includeDataUri) imageUrls.push(src)
      } else {
        imageUrls.push(src)
      }
    }
    
    searchIndex = imgEnd + 1
  }
  
  // 提取标题 - 同样使用简单字符串操作
  const title = extractTitleFromHtml(htmlContent) || fileName
  
  return {
    imageUrls: Array.from(new Set(imageUrls)),
    title
  }
}

/**
 * 从img标签中提取src属性值
 * @param {string} imgTag img标签字符串
 * @returns {string|null} src属性值
 */
function extractSrcFromImgTag(imgTag) {
  // 优先尝试双引号
  if (imgTag.includes('src="')) {
    const start = imgTag.indexOf('src="') + 5
    const end = imgTag.indexOf('"', start)
    if (end !== -1) return imgTag.substring(start, end)
  }
  
  // 回退到单引号
  if (imgTag.includes("src='")) {
    const start = imgTag.indexOf("src='") + 5
    const end = imgTag.indexOf("'", start)
    if (end !== -1) return imgTag.substring(start, end)
  }
  
  return null
}

/**
 * 从HTML中提取title标签内容
 * @param {string} htmlContent HTML内容
 * @returns {string|null} 标题内容
 */
function extractTitleFromHtml(htmlContent) {
  const titleStart = htmlContent.indexOf('<title')
  if (titleStart === -1) return null
  
  const titleContentStart = htmlContent.indexOf('>', titleStart)
  if (titleContentStart === -1) return null
  
  const titleEnd = htmlContent.indexOf('</title>', titleContentStart)
  if (titleEnd === -1) return null
  
  return htmlContent.substring(titleContentStart + 1, titleEnd).trim()
}
