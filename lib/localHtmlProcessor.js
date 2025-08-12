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
    if (config.lazyMemoryCreation) {
      logger.warn(`发现 ${htmlFiles.length} 个HTML文件，将按需创建记忆文件（懒加载模式）`)
    } else {
      logger.warn(`发现 ${htmlFiles.length} 个HTML文件，这将创建大量记忆文件`)
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

    if (userConfirmation !== 'yes' && userConfirmation !== 'y') {
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

  // 注入 HTML 根目录，提升路径归一化稳健性
  if (config.enableMemory) {
    try {
      htmlMemoryManager.setHtmlRoot(path.resolve(config.htmlDirectory))
    } catch {}
  }

  // 初始化HTML记忆管理器
  if (config.enableMemory) {
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

  let fileInfoList = []

  if (config.enableMemory && !config.forceReprocess) {
    const preCheckResult = await htmlMemoryManager.batchPreCheck(filesToScan)

    if (preCheckResult.needProcess.length === 0 && preCheckResult.partialDownload.length === 0) {
      logger.success('所有HTML文件都已处理完成！')
      return
    }

    fileInfoList = [
      ...preCheckResult.partialDownload,
      ...preCheckResult.needProcess.map((filePath) => ({
        filePath,
        isPartialDownload: false,
        downloadedImages: [],
        downloadedCount: 0,
      })),
    ]

    if (preCheckResult.partialDownload.length > 0) {
      const partialFiles = fileInfoList.filter((file) => file.isPartialDownload)
      const newFiles = fileInfoList.filter((file) => !file.isPartialDownload)
      partialFiles.sort((a, b) => b.downloadedCount - a.downloadedCount)
      fileInfoList = [...partialFiles, ...newFiles]
    }

    if (preCheckResult.completed.length > 0) {
      logger.success(`⚡ 批量预检查优化：跳过 ${preCheckResult.completed.length} 个已完成文件，避免了无效的HTML解析`)
    }
    if (preCheckResult.partialDownload.length > 0) {
      logger.info(`🔄 发现 ${preCheckResult.partialDownload.length} 个文件有部分下载记录，将优先处理并启用断点续传`)
    }
    logger.info(`📋 实际需要处理 ${fileInfoList.length} 个HTML文件`)
  } else {
    fileInfoList = filesToScan.map((filePath) => ({
      filePath,
      isPartialDownload: false,
      downloadedImages: [],
      downloadedCount: 0,
    }))
  }

  for (let index = 0; index < fileInfoList.length; index++) {
    const fileInfo = fileInfoList[index]
    const htmlFile = fileInfo.filePath
    logger.progress(index + 1, fileInfoList.length, `正在处理: ${path.basename(htmlFile)}`, 0)

    logger.header(`\n------------------- 开始处理HTML文件: ${path.basename(htmlFile)} -------------------`)

    try {
      const { imageUrls, title } = await extractImageUrlsFromLocalHtml(htmlFile)

      if (imageUrls.length === 0) {
        logger.warn(`HTML文件 ${path.basename(htmlFile)} 中未找到图片URL`)
        continue
      }

      let finalImageUrls = imageUrls
      if (config.imageMode === 'originals_only') {
        logger.info('正在从缩略图生成原始图片 URL...')
        finalImageUrls = imageUrls.map((url) => convertThumbnailToOriginalUrl(url)).filter(Boolean)

        if (finalImageUrls.length === 0) {
          logger.warn('根据缩略图未找到任何原始图片。将使用所有图片。')
          finalImageUrls = imageUrls
        } else {
          logger.success(`已生成 ${finalImageUrls.length} 个原始图片 URL`)
        }
      }

      if (config.enableMemory && !fileInfo.isPartialDownload) {
        await htmlMemoryManager.startProcessing(htmlFile, {}, config.lazyMemoryCreation, finalImageUrls.length)
      }

      let imagesToDownload = finalImageUrls
      let downloadedCount = 0

      if (config.enableMemory) {
        const filterResult = await htmlMemoryManager.filterPendingImageUrls(htmlFile, finalImageUrls)
        imagesToDownload = filterResult.pendingUrls
        downloadedCount = filterResult.downloadedCount

        if (filterResult.downloadedCount > 0) {
          logger.info(`增量下载模式：总计${filterResult.totalCount}张图片，已下载${filterResult.downloadedCount}张，还需下载${imagesToDownload.length}张`)
        } else {
          logger.info(`全新下载：需要下载${imagesToDownload.length}张图片`)
        }
      }

      if (imagesToDownload.length === 0) {
        logger.success(`文件 ${path.basename(htmlFile)} 的所有图片都已下载完成`)
        if (config.enableMemory) {
          await htmlMemoryManager.completeProcessing(htmlFile)
        }
        continue
      }

      const context = {
        browser,
        config,
        pageTitle: title,
        htmlFilePath: htmlFile,
        isResumeDownload: fileInfo.isPartialDownload,
        totalImageCount: finalImageUrls.length,
        downloadedCount: fileInfo.downloadedCount,
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

  if (config.enableMemory) {
    logger.info(`所有文件处理完成，总计已处理 ${htmlMemoryManager.getProcessedCount()} 个文件`)
    logger.info(`记录目录: ${htmlMemoryManager.memoryDirectory}`)
  }
}


