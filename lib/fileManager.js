import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger.js'
import { sanitizeFileName } from '../utils/fileNameSanitizer.js'
import { identifyImageFormat, convertWebpToPng, getFileNameFromUrl, SUPPORTED_FORMATS, convertImageFormat } from '../utils/imageUtils.js'
import { htmlMemoryManager } from '../utils/htmlMemoryManager.js'

/**
 * @description 保存图像 Buffer 到文件系统，按需执行统一格式转换，并在写入成功后累计“最终落盘格式”的统计。
 *
 * 重要：该函数会“原地”修改 `stats` 对象（副作用）。
 * - 成功路径：`stats.successful++`，并更新 `stats.formatCounts[finalFormat] += 1`。
 * - 失败路径：`stats.failed++` 且 `stats.failedUrls.push(imageUrl)`；写入失败会抛出 `isCritical=true` 的异常。
 * - `stats.formatCounts` 是在 twoPhase 模式下跨阶段共享的同一引用，测试依赖这一行为验证累计一致性。
 *
 * 统一转换策略（全局）
 * - `config.format.enableConversion`：是否启用统一转换，默认 `true`。
 * - `config.format.convertTo`：目标格式，默认 `'png'`；当值为 `'none'` 时不做统一转换。
 * - 当启用转换且原始格式与目标不同，将通过 `convertImageFormat(buffer, convertTo)` 进行转换，并据此重写文件扩展名（`jpeg` 使用 `.jpg`）。
 *
 * 最终格式统计
 * - 统计以“最终落盘的 Buffer”识别结果为准：优先 `identifyImageFormat(finalBuffer)`，回退 `analysisResult?.metadata?.format`，否则 `'unknown'`。
 * - `jpg` 归一化为 `jpeg` 计数键。
 *
 * @param {Buffer} buffer - 原始图像 Buffer。
 * @param {string} filePath - 目标文件路径（可能因统一转换而在内部改写扩展名）。
 * @param {string} imageUrl - 原始图像 URL（用于日志与错误记录）。
 * @param {{ total:number, successful:number, failed:number, failedUrls:string[], formatCounts:Record<string, number> }} stats - 下载统计对象（会被原地修改）。
 * @param {Array|null} [imageInfoList] - 图片信息聚合列表；若提供，会收集下载结果的名称/大小/类型/路径等信息。
 * @param {{ format?: { enableConversion?: boolean, convertTo?: 'png'|'jpeg'|'webp'|'svg'|'none' } }} [config] - 全局格式转换配置。
 * @param {{ isValid?: boolean, metadata?: { format?: string, size?: number, width?: number, height?: number, type?: string } }} [analysisResult] - 分析阶段结果；若提供，其 `metadata` 可被用于减少重复嗅探。
 * @returns {Promise<void>}
 */
export async function saveImage(buffer, filePath, imageUrl, stats, imageInfoList = null, config = undefined, analysisResult = undefined) {
  try {
    let finalBuffer = buffer
    let finalFilePath = filePath
    // 中文注释：若提供分析结果，优先使用以避免重复嗅探
    const originalFormat = (analysisResult?.metadata?.format) || identifyImageFormat(buffer)
    // 中文注释：全局格式转换开关（默认开启）
    const enableConversion = (config?.format?.enableConversion) ?? true

    // 全局统一转换策略
    try {
      const convertTo = (config?.format?.convertTo) ?? 'png'
      if (enableConversion && convertTo !== 'none') {
        // 若原始格式与目标一致则跳过
        const original = originalFormat && typeof originalFormat === 'string' ? originalFormat.toLowerCase() : 'unknown'
        if (original !== convertTo) {
          logger.process(`正在转换图片为 ${convertTo.toUpperCase()}: ${imageUrl}`)
          const converted = await convertImageFormat(buffer, convertTo)
          if (converted) {
            finalBuffer = converted
            // 根据目标格式重写扩展名
            const ext = convertTo === 'jpeg' ? '.jpg' : `.${convertTo}`
            finalFilePath = filePath.replace(/\.[^.]+$/i, ext)
            logger.success(`成功转换为 ${convertTo.toUpperCase()}。`)
          } else {
            logger.warn(`转换失败（保持原格式）: ${imageUrl}`)
          }
        }
      }
    } catch (e) {
      logger.warn(`处理统一转换策略时出现问题：${e.message}`)
    }

    // 写入文件
    try {
      await fs.writeFile(finalFilePath, finalBuffer)
      stats.successful++
      logger.success(`已下载 (${stats.successful}/${stats.total}): ${finalFilePath}`, logger.categories.DOWNLOAD)
      // 中文注释：类型统计在保存阶段按“最终落盘格式”累计（与分析阶段解耦，避免与统一转换策略产生偏差）
      try {
        if (stats && stats.formatCounts) {
          // 优先使用最终落盘的 buffer 识别格式，确保统计反映“最终格式”
          const fmt = (identifyImageFormat(finalBuffer) || analysisResult?.metadata?.format || 'unknown').toString().toLowerCase()
          const key = fmt === 'jpg' ? 'jpeg' : fmt
          stats.formatCounts[key] = (stats.formatCounts[key] || 0) + 1
        }
      } catch {}

      // 中文注释：为未来 API 返回做准备——将分析阶段产生的核心元数据随下载结果一并收集
      if (Array.isArray(imageInfoList)) {
        try {
          const analyzed = analysisResult?.metadata || {}
          const name = path.basename(finalFilePath)
          const basename = name.replace(/\.[^.]+$/i, '')
          imageInfoList.push({
            url: imageUrl,
            name,
            basename,
            // 中文注释：优先使用分析阶段的原始大小（未转换前），否则回退为最终落盘的大小
            size: (typeof analyzed.size === 'number' ? analyzed.size : finalBuffer.length),
            type: (analyzed.type || analyzed.format || identifyImageFormat(finalBuffer) || 'unknown'),
            width: (typeof analyzed.width === 'number' ? analyzed.width : null),
            height: (typeof analyzed.height === 'number' ? analyzed.height : null),
            storagePath: finalFilePath
          })
        } catch {}
      }
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
