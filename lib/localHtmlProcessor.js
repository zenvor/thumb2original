import fs from 'fs/promises'
import path from 'path'
import readline from 'readline'
import { logger } from '../utils/logger.js'
import { convertThumbnailToOriginalUrl } from '../utils/imageUrlConverter.js'
import { htmlMemoryManager } from '../utils/htmlMemoryManager.js'
import { extractImageUrlsFromLocalHtml } from './imageExtractor.js'

/**
 * @description 扫描指定目录下的所有HTML文件，并按配置排序。
 * @param {string} htmlDir - HTML文件目录路径。
 * @param {string} sortOrder - 排序方式: 'mtime_asc' | 'mtime_desc' | 'name'
 * @returns {Promise<string[]>}
 */
export async function scanHtmlFiles(htmlDir, sortOrder = 'mtime_asc') {
  logger.info(`正在扫描HTML目录: ${htmlDir}`)
  const htmlFiles = []

  try {
    const entries = await fs.readdir(htmlDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(htmlDir, entry.name)

      if (entry.isDirectory()) {
        const subFiles = await scanHtmlFiles(fullPath, sortOrder)
        htmlFiles.push(...subFiles)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        htmlFiles.push(fullPath)
      }
    }
  } catch (error) {
    logger.error(`扫描HTML目录失败: ${error.message}`)
  }

  if (sortOrder === 'name') {
    htmlFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  } else {
    const filesWithStats = await Promise.all(
      htmlFiles.map(async (file) => {
        try {
          const stats = await fs.stat(file)
          return { file, mtime: stats.mtime.getTime() }
        } catch (error) {
          return { file, mtime: Date.now() }
        }
      })
    )

    const ascending = sortOrder === 'mtime_asc'
    filesWithStats.sort((a, b) => (ascending ? a.mtime - b.mtime : b.mtime - a.mtime))

    htmlFiles.length = 0
    htmlFiles.push(...filesWithStats.map((item) => item.file))
  }

  return htmlFiles
}

/**
 * 获取用户确认是否处理大量文件
 */
async function getUserConfirmation(fileCount, config) {
  if (config.lazyMemoryCreation) {
    logger.warn(`发现 ${fileCount} 个HTML文件，将按需创建记忆文件（懒加载模式）`)
  } else {
    logger.warn(`发现 ${fileCount} 个HTML文件，这将创建大量记忆文件`)
  }
  
  logger.info('如果不需要处理这么多文件，请考虑：')
  logger.info('1. 设置 maxFilesPerRun 限制每次处理的文件数量')
  logger.info('2. 将不需要的HTML文件移到其他目录')
  logger.info('3. 设置 confirmLargeRun: false 跳过此提示')

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const userConfirmation = await new Promise((resolve) => {
    rl.question('是否继续处理这些文件？ (yes/no): ', (answer) => {
      rl.close()
      resolve(answer.toLowerCase())
    })
  })

  return userConfirmation === 'yes' || userConfirmation === 'y'
}

/**
 * 初始化内存管理器
 */
async function setupMemoryManager(config) {
  if (!config.enableMemory) return

  // 注入 HTML 根目录，提升归一化稳健性（仅在内存功能开启时）
  try {
    htmlMemoryManager.setHtmlRoot(path.resolve(config.htmlDirectory))
  } catch {}

  if (config.memoryDirectory) {
    htmlMemoryManager.memoryDirectory = config.memoryDirectory
  }

  if (!config.lazyMemoryCreation) {
    await htmlMemoryManager.loadAllMemories()
  } else {
    await htmlMemoryManager.initializeMemoryDirectory()
    logger.info('启用懒加载模式：将按需创建记忆文件')
  }

  if (config.forceReprocess) {
    logger.info('强制重新处理模式：清空所有处理记录')
    await htmlMemoryManager.clearAllMemories()
  }
}

/**
 * 准备文件信息列表
 */
async function prepareFileInfoList(filesToScan, config) {
  if (!config.enableMemory || config.forceReprocess) {
    return filesToScan.map(filePath => ({
      filePath,
      isPartialDownload: false,
      downloadedImages: [],
      downloadedCount: 0
    }))
  }

  const preCheckResult = await htmlMemoryManager.batchPreCheck(filesToScan)

  if (preCheckResult.needProcess.length === 0 && preCheckResult.partialDownload.length === 0) {
    logger.success('所有HTML文件都已处理完成！')
    return null
  }

  const fileInfoList = [
    ...preCheckResult.partialDownload,
    ...preCheckResult.needProcess.map(filePath => ({
      filePath,
      isPartialDownload: false,
      downloadedImages: [],
      downloadedCount: 0
    }))
  ]

  if (preCheckResult.partialDownload.length > 0) {
    const partialFiles = fileInfoList.filter(file => file.isPartialDownload)
    const newFiles = fileInfoList.filter(file => !file.isPartialDownload)
    partialFiles.sort((a, b) => b.downloadedCount - a.downloadedCount)
    fileInfoList.splice(0, fileInfoList.length, ...partialFiles, ...newFiles)
  }

  // 输出统计信息
  if (preCheckResult.completed.length > 0) {
    logger.success(`⚡ 批量预检查优化：跳过 ${preCheckResult.completed.length} 个已完成文件，避免了无效的HTML解析`)
  }
  if (preCheckResult.partialDownload.length > 0) {
    logger.info(`🔄 发现 ${preCheckResult.partialDownload.length} 个文件有部分下载记录，将优先处理并启用断点续传`)
  }
  logger.info(`📋 实际需要处理 ${fileInfoList.length} 个HTML文件`)

  return fileInfoList
}

/**
 * 处理单个HTML文件
 */
async function processSingleHtmlFile(fileInfo, index, totalCount, browser, config, downloadManager) {
  const htmlFile = fileInfo.filePath
  logger.progress(index + 1, totalCount, `正在处理: ${path.basename(htmlFile)}`, 0)
  logger.header(`\n------------------- 开始处理HTML文件: ${path.basename(htmlFile)} -------------------`)

  try {
    const { imageUrls, title } = await extractImageUrlsFromLocalHtml(htmlFile)

    if (imageUrls.length === 0) {
      logger.warn(`HTML文件 ${path.basename(htmlFile)} 中未找到图片URL`)
      return
    }

    let finalImageUrls = await processImageUrlsByMode(imageUrls, config.imageMode)

    if (config.enableMemory && !fileInfo.isPartialDownload) {
      await htmlMemoryManager.startProcessing(htmlFile, {}, config.lazyMemoryCreation, finalImageUrls.length)
    }

    const { imagesToDownload, downloadedCount } = await filterDownloadUrls(htmlFile, finalImageUrls, config)

    if (imagesToDownload.length === 0) {
      logger.success(`文件 ${path.basename(htmlFile)} 的所有图片都已下载完成`)
      if (config.enableMemory) {
        await htmlMemoryManager.completeProcessing(htmlFile)
      }
      return
    }

    const context = {
      browser,
      config,
      pageTitle: title,
      htmlFilePath: htmlFile,
      isResumeDownload: fileInfo.isPartialDownload,
      totalImageCount: finalImageUrls.length,
      downloadedCount: fileInfo.downloadedCount
    }

    logger.info(`开始下载 ${imagesToDownload.length} 张图片...`)
    await downloadManager(imagesToDownload, context)

    if (config.enableMemory) {
      logger.info(`文件 ${path.basename(htmlFile)} 处理完成，记录已写入独立JSONL文件`)
    }
  } catch (error) {
    logger.error(`处理HTML文件失败 ${htmlFile}: ${error.message}`)
  }

  logger.header(`------------------- 处理完成: ${path.basename(htmlFile)} -------------------\n`)
}

/**
 * 根据图片模式处理URL列表
 */
async function processImageUrlsByMode(imageUrls, imageMode) {
  if (imageMode !== 'originals_only') {
    return imageUrls
  }

  logger.info('正在从缩略图生成原始图片 URL...')
  const originalUrls = imageUrls
    .map(url => convertThumbnailToOriginalUrl(url))
    .filter(Boolean)

  if (originalUrls.length === 0) {
    logger.warn('根据缩略图未找到任何原始图片。将使用所有图片。')
    return imageUrls
  }

  logger.success(`已生成 ${originalUrls.length} 个原始图片 URL`)
  return originalUrls
}

/**
 * 过滤需要下载的图片URL
 */
async function filterDownloadUrls(htmlFile, finalImageUrls, config) {
  if (!config.enableMemory) {
    return {
      imagesToDownload: finalImageUrls,
      downloadedCount: 0
    }
  }

  const filterResult = await htmlMemoryManager.filterPendingImageUrls(htmlFile, finalImageUrls)
  
  if (filterResult.downloadedCount > 0) {
    logger.info(`增量下载模式：总计${filterResult.totalCount}张图片，已下载${filterResult.downloadedCount}张，还需下载${filterResult.pendingUrls.length}张`)
  } else {
    logger.info(`全新下载：需要下载${filterResult.pendingUrls.length}张图片`)
  }

  return {
    imagesToDownload: filterResult.pendingUrls,
    downloadedCount: filterResult.downloadedCount
  }
}

/**
 * @description 处理本地HTML爬虫模式。
 * @param {object} browser - Puppeteer 浏览器实例。
 * @param {object} config - 用户配置。
 * @param {Function} downloadManager - 下载管理器函数。
 */
export async function processLocalHtmlMode(browser, config, downloadManager) {
  const htmlFiles = await scanHtmlFiles(config.htmlDirectory, config.htmlSortOrder)

  if (htmlFiles.length === 0) {
    logger.warn('未找到任何HTML文件')
    return
  }

  logger.success(`找到 ${htmlFiles.length} 个HTML文件`)

  // 大量文件确认
  if (config.confirmLargeRun && htmlFiles.length > 100) {
    const userConfirmed = await getUserConfirmation(htmlFiles.length, config)
    if (!userConfirmed) {
      logger.info('用户取消操作，程序将退出')
      return
    }
    logger.success('用户确认继续处理')
  }

  // 限制每次处理的文件数量
  let filesToScan = htmlFiles
  if (config.maxFilesPerRun > 0 && htmlFiles.length > config.maxFilesPerRun) {
    filesToScan = htmlFiles.slice(0, config.maxFilesPerRun)
    logger.info(`限制处理文件数量：${config.maxFilesPerRun}/${htmlFiles.length} 个文件`)
  }

  // 初始化内存管理器
  await setupMemoryManager(config)

  // 准备文件信息列表
  const fileInfoList = await prepareFileInfoList(filesToScan, config)
  if (!fileInfoList) return // 所有文件已处理完成

  // 处理每个HTML文件
  for (let index = 0; index < fileInfoList.length; index++) {
    await processSingleHtmlFile(fileInfoList[index], index, fileInfoList.length, browser, config, downloadManager)
  }

  if (config.enableMemory) {
    logger.info(`所有文件处理完成，总计已处理 ${htmlMemoryManager.getProcessedCount()} 个文件`)
    logger.info(`记录目录: ${htmlMemoryManager.memoryDirectory}`)
  }
}


