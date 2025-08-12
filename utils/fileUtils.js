import fs from 'fs/promises'
import path from 'path'
import { logger } from './logger.js'
import { identifyImageFormat, convertWebpToPng } from './imageUtils.js'

/**
 * @description 等待指定的毫秒数。
 * @param {number} ms - 等待的毫秒数。
 * @returns {Promise<void>}
 */
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @deprecated 此函数已废弃，请使用 lib/fileManager.js 中的 saveImage
 * @description 保存图像 Buffer 到文件系统（已废弃，转调新实现）。
 * @param {Buffer} buffer - 图像 Buffer。
 * @param {string} filePath - 目标文件路径。
 * @param {string} imageUrl - 原始图像 URL，用于错误记录。
 * @param {object} stats - 用于跟踪下载统计的对象。
 * @returns {Promise<void>}
 */
export async function saveImage(buffer, filePath, imageUrl, stats) {
  // 废弃警告
  logger.warn('⚠️  utils/fileUtils.saveImage 已废弃，请使用 lib/fileManager.saveImage')
  
  // 转调新实现（动态导入避免循环依赖）
  const { saveImage: newSaveImage } = await import('../lib/fileManager.js')
  return await newSaveImage(buffer, filePath, imageUrl, stats)
}

/**
 * @description 扫描指定目录下的所有HTML文件。
 * @param {string} htmlDir - HTML文件目录路径。
 * @returns {Promise<string[]>} HTML文件路径数组。
 */
export async function scanHtmlFiles(htmlDir) {
  logger.info(`正在扫描HTML目录: ${htmlDir}`)
  const htmlFiles = []
  
  try {
    const entries = await fs.readdir(htmlDir, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = path.join(htmlDir, entry.name)
      
      if (entry.isDirectory()) {
        // 递归扫描子目录
        const subFiles = await scanHtmlFiles(fullPath)
        htmlFiles.push(...subFiles)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        htmlFiles.push(fullPath)
      }
    }
  } catch (error) {
    logger.error(`扫描HTML目录失败: ${error.message}`)
  }
  
  logger.success(`找到 ${htmlFiles.length} 个HTML文件`)
  return htmlFiles
}

/**
 * @description 从本地HTML文件中提取图像URL。
 * @param {string} htmlFilePath - HTML文件路径。
 * @returns {Promise<{imageUrls: string[], title: string}>} 提取到的图像URL数组和页面标题。
 */
export async function extractImageUrlsFromLocalHtml(htmlFilePath) {
  try {
    const htmlContent = await fs.readFile(htmlFilePath, 'utf-8')
    const fileName = path.basename(htmlFilePath, '.html')
    
    // 使用正则表达式提取img标签的src属性
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
    const imageUrls = []
    let match
    
    while ((match = imgRegex.exec(htmlContent)) !== null) {
      const src = match[1]
      if (src && !src.startsWith('data:')) {
        imageUrls.push(src)
      }
    }
    
    // 提取页面标题，如果没有则使用文件名
    const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : fileName
    
    logger.info(`从 ${path.basename(htmlFilePath)} 提取到 ${imageUrls.length} 个图片URL`)
    
    return {
      imageUrls: Array.from(new Set(imageUrls)), // 去重
      title: title
    }
  } catch (error) {
    logger.error(`读取HTML文件失败 ${htmlFilePath}: ${error.message}`)
    return { imageUrls: [], title: path.basename(htmlFilePath, '.html') }
  }
}