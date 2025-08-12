import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger.js'
import { sanitizeFileName } from '../utils/fileNameSanitizer.js'
import { identifyImageFormat, convertWebpToPng, getFileNameFromUrl } from '../utils/imageUtils.js'
import { htmlMemoryManager } from '../utils/htmlMemoryManager.js'

/**
 * @description 保存图像 Buffer 到文件系统，包括格式转换和信息收集。
 * @param {Buffer} buffer - 图像 Buffer。
 * @param {string} filePath - 目标文件路径。
 * @param {string} imageUrl - 原始图像 URL，用于错误记录。
 * @param {object} stats - 用于跟踪下载统计的对象。
 * @param {Array} [imageInfoList] - 图片信息列表，用于收集下载的图片信息。
 * @returns {Promise<void>}
 */
export async function saveImage(buffer, filePath, imageUrl, stats, imageInfoList = null) {
  try {
    let finalBuffer = buffer
    let finalFilePath = filePath

    // WebP 格式转换
    if (identifyImageFormat(buffer) === 'webp') {
      logger.process(`正在转换 WebP 图片: ${imageUrl}`)
      const pngBuffer = await convertWebpToPng(buffer)
      if (pngBuffer) {
        finalBuffer = pngBuffer
        finalFilePath = filePath.replace(/\.webp$/i, '.png')
        logger.success(`成功将 WebP 转换为 PNG。`)
      } else {
        throw new Error(`转换 WebP 缓冲区失败。`)
      }
    }

    // 写入文件
    try {
      await fs.writeFile(finalFilePath, finalBuffer)
      stats.successful++
      logger.success(`已下载 (${stats.successful}/${stats.total}): ${finalFilePath}`, logger.categories.DOWNLOAD)
    } catch (writeError) {
      // 写入失败快速抛错 + 终止任务
      const criticalError = new Error(`写入文件失败，任务终止: ${finalFilePath} - ${writeError.message}`)
      criticalError.isCritical = true
      criticalError.originalError = writeError
      logger.error(`严重错误 - 文件写入失败，立即终止任务: ${writeError.message}`)
      throw criticalError
    }
    
    // 收集图片信息用于记忆管理
    if (imageInfoList) {
      try {
        const imageInfo = await htmlMemoryManager.generateImageInfo(finalFilePath, imageUrl)
        if (imageInfoList.htmlFilePath) {
          await htmlMemoryManager.appendImageInfo(imageInfoList.htmlFilePath, imageInfo)
        } 
      } catch (error) {
        logger.warn(`收集图片信息失败 ${finalFilePath}: ${error.message}`)
      }
    }
  } catch (error) {
    stats.failed++
    stats.failedUrls.push(imageUrl)
    logger.error(`保存图片失败 ${imageUrl}: ${error.message}`)
    
    // 如果是关键错误，重新抛出
    if (error.isCritical) {
      throw error
    }
  }
}

/**
 * @description 创建下载目录。
 * @param {string} baseDir - 基础目录。
 * @param {string} pageTitle - 页面标题，用于创建子目录。
 * @returns {Promise<string>} 创建的目标目录路径。
 */
export async function createDownloadDirectory(baseDir, pageTitle) {
  const targetDownloadDir = path.join(baseDir, sanitizeFileName(pageTitle))
  await fs.mkdir(targetDownloadDir, { recursive: true })
  logger.process(`已创建下载文件夹: ${targetDownloadDir}`)
  return targetDownloadDir
}

/**
 * @description 生成文件名，支持特定网站的文件名提取逻辑。
 * @param {string} imageUrl - 图片 URL。
 * @param {Buffer} buffer - 图片 Buffer。
 * @param {object} headers - HTTP 响应头。
 * @returns {string} 生成的文件名。
 */
export function generateFileName(imageUrl, buffer, headers = {}) {
  let fileName

  // 特定网站的文件名提取逻辑
  if (imageUrl.includes('chpic.su') && headers['content-disposition']) {
    const match = headers['content-disposition'].match(/filename=["']?([^"]+)/)
    const type = imageUrl.split('?type=')[1] || ''
    if (match && match[1]) {
      fileName = `${type}_${match[1].split('_-_')[1]}`
    }
  }

  // 默认文件名生成
  if (!fileName) {
    fileName = getFileNameFromUrl(imageUrl, buffer)
  }

  return sanitizeFileName(fileName)
}

/**
 * @description 完成 HTML 文件处理的记忆管理。
 * @param {string} htmlFilePath - HTML 文件路径。
 * @param {Array} downloadedImages - 已下载的图片列表（保留兼容性，但不再用于计数）。
 * @param {object} options - 选项对象。
 * @returns {Promise<void>}
 */
export async function completeHtmlProcessing(htmlFilePath, downloadedImages, options = {}) {
  if (!htmlFilePath) return

  const { downloadedCount = 0, totalImageCount = 0, isResumeDownload = false } = options

  try {
    // 基于记忆管理器读取真实已下载数量，避免内存累计问题
    const imagesInMemory = await htmlMemoryManager.getDownloadedImages(htmlFilePath)
    const currentDownloaded = imagesInMemory.length
    const actualTotalDownloaded = downloadedCount + currentDownloaded
    const expectedTotal = totalImageCount || currentDownloaded
    
    if (currentDownloaded > 0 || isResumeDownload) {
      // 写入最终完成记录
      await htmlMemoryManager.completeProcessing(htmlFilePath, {
        totalImages: actualTotalDownloaded,
        expectedTotal: expectedTotal,
        isResumeDownload: isResumeDownload
      })
      
      if (isResumeDownload) {
        logger.success(`HTML文件处理完成（断点续传），总计下载 ${actualTotalDownloaded}/${expectedTotal} 张图片，本次新增 ${currentDownloaded} 张`)
      } else {
        logger.success(`HTML文件处理完成，共下载 ${currentDownloaded} 张图片`)
      }
    } else {
      // 即使没有下载图片，也要标记为已处理
      await htmlMemoryManager.completeProcessing(htmlFilePath, {
        totalImages: 0,
        note: 'no_images_downloaded'
      })
      logger.info(`HTML文件处理完成，但未下载任何图片`)
    }
  } catch (error) {
    logger.error(`写入最终完成记录失败: ${error.message}`)
  }
}
