import fs from 'fs/promises'
import path from 'path'
import readline from 'readline'
import { logger } from '../utils/logger.js'
import { convertThumbnailToOriginalUrl } from '../utils/imageUrlConverter.js'
import { htmlMemoryManager } from '../utils/htmlMemoryManager.js'
import { setupPageAntiDetection, randomDelay, simulateHumanBehavior, detectAntiBot } from '../utils/antiDetection.js'

/**
 * @description 加载页面并滚动到底部以触发懒加载。
 * @param {object} page - Puppeteer 页面实例。
 * @param {string} url - 要加载的页面 URL。
 * @param {object} config - 配置对象，包含反检测设置。
 * @returns {Promise<string>} 页面标题。
 */
export async function loadAndScrollPage(page, url, config = {}) {
  const maxRetries = config.stability?.maxPageRetries || 3
  let retryCount = 0
  
  while (retryCount < maxRetries) {
    try {
      // 检查页面是否已关闭
      if (page.isClosed()) {
        throw new Error('页面已关闭，无法继续操作')
      }
      
      // 设置页面反检测功能
      if (config.antiDetection) {
        await setupPageAntiDetection(page, config.antiDetection)
      }

      logger.info(`正在导航到: ${url}${retryCount > 0 ? ` (重试 ${retryCount}/${maxRetries})` : ''}`)
      
      // 添加随机延迟，模拟人类行为
      await randomDelay(1000, 2000)
      
      // 使用更稳定的页面导航选项
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', // 改为更快的等待条件
        timeout: 60 * 1000 // 减少超时时间
      })
      
      // 等待页面稳定
      await randomDelay(2000, 2000)
      
      // 检测是否被反爬虫系统拦截
      const isBlocked = await detectAntiBot(page)
      if (isBlocked) {
        logger.warn('页面可能被反爬虫系统拦截，请检查页面内容')
      }
      
      const title = await page.title()
      logger.info(`页面标题: "${title}"`)

      // 模拟人类行为
      await simulateHumanBehavior(page)
      
      // 如果成功到达这里，跳出重试循环
      break
      
    } catch (error) {
      retryCount++
      logger.error(`页面加载失败 (${retryCount}/${maxRetries}): ${error.message}`)
      
      if (retryCount >= maxRetries) {
        throw new Error(`页面加载失败，已重试 ${maxRetries} 次: ${error.message}`)
      }
      
      // 等待一段时间后重试
      await randomDelay(config.stability?.retryDelay || 2000, (config.stability?.retryDelay || 2000) * 2)
    }
  }
  
  logger.info('向下滚动以加载所有图片...')
  
  try {
    // 使用更稳定的滚动方式
    await page.evaluate(async () => {
      return new Promise((resolve) => {
        let totalHeight = 0
        const distance = 800 // 减少滚动距离
        let scrollAttempts = 0
        const maxScrollAttempts = 50 // 限制最大滚动次数
        
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight
          window.scrollBy(0, distance)
          totalHeight += distance
          scrollAttempts++
          
          // 检查是否到达底部或超过最大尝试次数
          if (totalHeight >= scrollHeight || scrollAttempts >= maxScrollAttempts) {
            clearInterval(timer)
            resolve()
          }
        }, 800) // 增加滚动间隔
      })
    })
    
    // 等待页面稳定
    await randomDelay(2000, 2000)
    
    // 滚动完成后再次模拟人类行为
    await simulateHumanBehavior(page)
    
    logger.debug('滚动完成。')
    
  } catch (error) {
    logger.error(`滚动过程中发生错误: ${error.message}`)
    // 即使滚动失败，也尝试获取页面标题
  }
  
  // 获取最终的页面标题
  let finalTitle
  try {
    finalTitle = await page.title()
  } catch (error) {
    logger.error(`获取页面标题失败: ${error.message}`)
    finalTitle = 'Unknown Title'
  }
  
  return finalTitle
}

/**
 * @description 扫描指定目录下的所有HTML文件。
 * @param {string} htmlDir - HTML文件目录路径。
 * @param {string} sortOrder - 排序方式: 'mtime_asc' | 'mtime_desc' | 'name'
 * @returns {Promise<string[]>} HTML文件路径数组。
 */
export async function scanHtmlFiles(htmlDir, sortOrder = 'mtime_asc') {
  logger.info(`正在扫描HTML目录: ${htmlDir}`)
  const htmlFiles = []
  
  try {
    const entries = await fs.readdir(htmlDir, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = path.join(htmlDir, entry.name)
      
      if (entry.isDirectory()) {
        // 递归扫描子目录
        const subFiles = await scanHtmlFiles(fullPath, sortOrder)
        htmlFiles.push(...subFiles)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        htmlFiles.push(fullPath)
      }
    }
  } catch (error) {
    logger.error(`扫描HTML目录失败: ${error.message}`)
  }
  
  // 根据配置的排序方式对文件进行排序
  if (sortOrder === 'name') {
    // 按文件名排序
    htmlFiles.sort((a, b) => {
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    })
  } else {
    // 按修改时间排序
    const filesWithStats = await Promise.all(
      htmlFiles.map(async (file) => {
        try {
          const stats = await fs.stat(file)
          return { file, mtime: stats.mtime.getTime() }
        } catch (error) {
          // 如果获取文件状态失败，使用当前时间作为备选
          return { file, mtime: Date.now() }
        }
      })
    )
    
    // 根据排序方式排序
    const ascending = sortOrder === 'mtime_asc'
    filesWithStats.sort((a, b) => {
      return ascending ? a.mtime - b.mtime : b.mtime - a.mtime
    })
    
    // 提取排序后的文件路径
    htmlFiles.length = 0
    htmlFiles.push(...filesWithStats.map(item => item.file))
  }
  
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
    
    // 使用debug级别避免重复输出
  logger.debug(`从 ${path.basename(htmlFilePath)} 提取到 ${imageUrls.length} 个图片URL`)
    
    return {
      imageUrls: Array.from(new Set(imageUrls)), // 去重
      title: title
    }
  } catch (error) {
    logger.error(`读取HTML文件失败 ${htmlFilePath}: ${error.message}`)
    return { imageUrls: [], title: path.basename(htmlFilePath, '.html') }
  }
}

/**
 * @description 从页面中提取所有图像 URL。
 * @param {object} page - Puppeteer 页面实例。
 * @param {string} pageUrl - 当前页面的 URL。
 * @returns {Promise<string[]>} 提取到的图像 URL 数组。
 */
export async function extractImageUrls(page, pageUrl) {
  logger.info('正在从页面中提取图片 URL...')
  // 直接将完整的页面URL作为基准，以正确处理 file:/// 协议和 http(s):// 协议
  const base = pageUrl

  const imageUrls = await page.evaluate((base) => {
    // 内部辅助函数，用于将相对URL转换为绝对URL
    function getAbsoluteUrl(url) {
      if (!url || url.startsWith('data:')) return null
      try {
        // new URL(url, base) 可以正确处理各种相对路径 (e.g., /path, ../path, //host/path)
        // 并且同时适用于 http 和 file 协议
        return new URL(url, base).href
      } catch (e) {
        // 如果 URL 格式不正确，则忽略
        return null
      }
    }

    // 只查找 <img> 标签的 src 属性
    const elements = Array.from(document.querySelectorAll('img[src]'))
    const urls = elements.map((el) => {
      const url = el.getAttribute('src')
      return getAbsoluteUrl(url)
    })

    // 过滤掉无效的链接和非图片链接
    const imageRegex = /\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff)$/i
    return urls.filter((url) => url && imageRegex.test(url.split('?')[0]))
  }, base) // 将完整的 pageUrl 作为基准传入

  // 为包含 '_webp' 的 URL 添加一个没有 '_webp' 的副本
  const webpVariations = imageUrls.filter((url) => url.includes('_webp')).map((url) => url.replace('_webp', ''))

  const allUrls = [...imageUrls, ...webpVariations]
  const uniqueUrls = Array.from(new Set(allUrls))

  logger.debug(`找到 ${uniqueUrls.length} 个唯一的图片 URL。`)
  return uniqueUrls
}

/**
 * @description 根据下载模式处理 URL，例如从缩略图生成原图 URL。
 * @param {object} page - Puppeteer 页面实例。
 * @param {string[]} images - 提取到的图像 URL 列表。
 * @param {string} pageUrl - 当前页面 URL。
 * @param {string} imageMode - 下载模式。
 * @returns {Promise<string[]>} 处理后的图像 URL 列表。
 */
export async function processUrlsByImageMode(page, images, pageUrl, imageMode) {
  if (imageMode === 'all') {
    return images
  }
  if (imageMode !== 'originals_only') {
    return []
  }

  logger.info('正在从缩略图生成原始图片 URL...')

  const containsRestrictedWords = (str) => {
    const restrictedWords = [
      'theasianpics',
      'asiansexphotos',
      'asianmatureporn',
      'asianamateurgirls',
      'hotasianamateurs',
      'amateurchinesepics',
      'asiannudistpictures',
      'filipinahotties',
      'chinesesexphotos',
      'japaneseteenpics',
      'hotnudefilipinas',
      'asianteenpictures',
      'asianteenphotos',
      'chineseteenpics',
      'cuteasians',
      'amateurasianpictures',
      'chinesexxxpics',
      'sexyasians',
      'allasiansphotos',
      'chinese-girlfriends',
      'chinesegirlspictures',
      'chinese-sex.xyz',
      'asian-cuties-online',
      'japaneseamateurpics',
      'asiangalleries',
      'filipinapornpictures',
      'japanesenudities',
      'koreanpornpics',
      'filipinanudes',
      'chinesepornpics',
      'asianamatures',
      'nudehotasians',
      'asianpornpictures',
      'orientgirlspictures',
    ]
    return restrictedWords.some((word) => str.includes(word))
  }

  let originalImageUrls = []

  // 特定网站的原图链接提取逻辑
  if (pageUrl.includes('www.eroticbeauties.net')) {
    originalImageUrls = await page.evaluate(() =>
      Array.from(document.querySelectorAll('span.jpg[data-src]')).map((span) => span.getAttribute('data-src'))
    )
  } else if (pageUrl.includes('www.alsasianporn.com')) {
    originalImageUrls = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[data-fancybox="gallery"]')).map((a) => a.getAttribute('href'))
    )
  } else if (pageUrl.includes('www.japanesesexpic.me') || pageUrl.includes('www.asianpussypic.me')) {
    originalImageUrls = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[target="_blank"]')).map((a) => a.getAttribute('href'))
    )
  } else if (pageUrl.includes('chpic.su')) {
    const transparentUrls = images.map((url) => convertThumbnailToOriginalUrl(url, 'transparent')).filter(Boolean)
    const whiteUrls = images.map((url) => convertThumbnailToOriginalUrl(url, 'white')).filter(Boolean)
    originalImageUrls = [...transparentUrls, ...whiteUrls]
  } else if (containsRestrictedWords(pageUrl)) {
    originalImageUrls = await page.evaluate((baseUrl) => {
      return Array.from(document.querySelectorAll('img[src*="tn_"]'))
        .map((img) => baseUrl + img.getAttribute('src').replace('tn_', ''))
        .filter(Boolean)
    }, pageUrl.split('?')[0])
  } else {
    // 通用规则
    originalImageUrls = images.map((url) => convertThumbnailToOriginalUrl(url)).filter(Boolean)
  }

  const uniqueUrls = Array.from(new Set(originalImageUrls.filter(Boolean)))
  if (uniqueUrls.length === 0) {
    logger.warn('根据缩略图未找到任何原始图片。将回退到所有图片。')
    return images // 如果没有找到原图，则返回所有提取到的图片
  }
  logger.debug(`已生成 ${uniqueUrls.length} 个原始图片 URL。`)
  return uniqueUrls
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
  
  // 检查是否需要用户确认大量文件处理
  if (config.confirmLargeRun && htmlFiles.length > 100) {
    // 根据懒加载模式显示不同的提示
    if (config.lazyMemoryCreation) {
      logger.warn(`发现 ${htmlFiles.length} 个HTML文件，将按需创建记忆文件（懒加载模式）`)
    } else {
      logger.warn(`发现 ${htmlFiles.length} 个HTML文件，这将创建大量记忆文件`)
    }
    logger.info('如果不需要处理这么多文件，请考虑：')
    logger.info('1. 设置 maxFilesPerRun 限制每次处理的文件数量')
    logger.info('2. 将不需要的HTML文件移到其他目录')
    logger.info('3. 设置 confirmLargeRun: false 跳过此提示')
    
    // 创建用户输入接口
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })
    
    // 等待用户确认
    const userConfirmation = await new Promise(resolve => {
      rl.question('是否继续处理这些文件？ (yes/no): ', answer => {
        rl.close()
        resolve(answer.toLowerCase())
      })
    })
    
    // 如果用户没有明确确认，则终止处理
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
  
  // 初始化HTML记忆管理器
  if (config.enableMemory) {
    // 设置记忆目录路径
    if (config.memoryDirectory) {
      htmlMemoryManager.memoryDirectory = config.memoryDirectory
    }
    
    // 旧版迁移逻辑已移除，现在直接使用分散的HTML记忆文件架构
    
    // 只在非懒加载模式下才加载所有记忆
    if (!config.lazyMemoryCreation) {
      await htmlMemoryManager.loadAllMemories()
    } else {
      // 懒加载模式：只初始化记忆目录
      await htmlMemoryManager.initializeMemoryDirectory()
      logger.info('启用懒加载模式：将按需创建记忆文件')
    }
    
    // 如果启用强制重新处理，清空记忆
    if (config.forceReprocess) {
      logger.info('强制重新处理模式：清空所有处理记录')
      await htmlMemoryManager.clearAllMemories()
    }
  }
  
  // 使用批量预检查优化处理流程
  let fileInfoList = []
  
  if (config.enableMemory && !config.forceReprocess) {
    // 执行批量预检查
    const preCheckResult = await htmlMemoryManager.batchPreCheck(filesToScan)
    
    // 如果所有文件都已完成，直接返回
    if (preCheckResult.needProcess.length === 0 && preCheckResult.partialDownload.length === 0) {
      logger.success('所有HTML文件都已处理完成！')
      return
    }
    
    // 构建文件信息列表：需要处理的文件 + 部分下载的文件
    fileInfoList = [
      // 部分下载的文件（断点续传）- 优先处理
      ...preCheckResult.partialDownload,
      // 需要处理的文件（全新处理）
      ...preCheckResult.needProcess.map(filePath => ({
        filePath,
        isPartialDownload: false,
        downloadedImages: [],
        downloadedCount: 0
      }))
    ]
    
    // 对部分下载的文件按照已下载数量降序排序，优先处理下载进度较多的文件
    if (preCheckResult.partialDownload.length > 0) {
      const partialFiles = fileInfoList.filter(file => file.isPartialDownload)
      const newFiles = fileInfoList.filter(file => !file.isPartialDownload)
      
      // 按已下载数量降序排序
      partialFiles.sort((a, b) => b.downloadedCount - a.downloadedCount)
      
      // 重新组合文件列表：已排序的部分下载文件 + 新文件
      fileInfoList = [...partialFiles, ...newFiles]
    }
    
    // 显示优化后的统计信息
    if (preCheckResult.completed.length > 0) {
      logger.success(`⚡ 批量预检查优化：跳过 ${preCheckResult.completed.length} 个已完成文件，避免了无效的HTML解析`)
    }
    
    if (preCheckResult.partialDownload.length > 0) {
      logger.info(`🔄 发现 ${preCheckResult.partialDownload.length} 个文件有部分下载记录，将优先处理并启用断点续传`)
    }
    
    logger.info(`📋 实际需要处理 ${fileInfoList.length} 个HTML文件`)
  } else {
    // 不启用记忆功能时，创建简单的文件信息列表
    fileInfoList = filesToScan.map(filePath => ({
      filePath,
      isPartialDownload: false,
      downloadedImages: [],
      downloadedCount: 0
    }))
  }
  
  // 处理每个HTML文件
  for (let index = 0; index < fileInfoList.length; index++) {
    const fileInfo = fileInfoList[index]
    const htmlFile = fileInfo.filePath
    // 更新主进度条 (level 0)
    logger.progress(index + 1, fileInfoList.length, `正在处理: ${path.basename(htmlFile)}`, 0)

    logger.header(`\n------------------- 开始处理HTML文件: ${path.basename(htmlFile)} -------------------`)
    
    try {
      const { imageUrls, title } = await extractImageUrlsFromLocalHtml(htmlFile)
      
      if (imageUrls.length === 0) {
        logger.warn(`HTML文件 ${path.basename(htmlFile)} 中未找到图片URL`)
        continue
      }
      
      // 处理图片URL（应用原图转换逻辑）
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
      
      // 记录开始处理（如果不是断点续传），并传递图片总数优化检查
      if (config.enableMemory && !fileInfo.isPartialDownload) {
        await htmlMemoryManager.startProcessing(htmlFile, {}, config.lazyMemoryCreation, finalImageUrls.length)
      }
      
      // 增量下载：精确过滤掉已下载的图片（实时比对HTML链接与JSONL记录）
      let imagesToDownload = finalImageUrls
      let downloadedCount = 0
      
      if (config.enableMemory) {
        // 使用新的增量下载过滤机制
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
        
        // 标记为完成
        if (config.enableMemory) {
          await htmlMemoryManager.completeProcessing(htmlFile)
        }

        continue
      }
      
      // 创建上下文对象并开始下载
      const context = {
        browser,
        config,
        pageTitle: title, // 直接使用HTML标题作为目录名，避免重复
        htmlFilePath: htmlFile, // 传递HTML文件路径用于记忆管理
        isResumeDownload: fileInfo.isPartialDownload, // 标记是否为断点续传
        totalImageCount: finalImageUrls.length, // 总图片数量
        downloadedCount: fileInfo.downloadedCount // 已下载数量
      }
      
      logger.info(`开始下载 ${imagesToDownload.length} 张图片...`)
      await downloadManager(imagesToDownload, context)
      
      // HTML记忆管理已在downloadManager中实时写入，这里不需要额外操作
      if (config.enableMemory) {
        logger.info(`文件 ${path.basename(htmlFile)} 处理完成，记录已写入独立JSONL文件`)
      }
      
    } catch (error) {
      logger.error(`处理HTML文件失败 ${htmlFile}: ${error.message}`)
      // 处理失败时不标记为已处理，下次可以重试
    }
    
    logger.header(`------------------- 处理完成: ${path.basename(htmlFile)} -------------------\n`)
  }
  
  // HTML记忆管理已实时写入，显示最终统计信息
  if (config.enableMemory) {
    logger.info(`所有文件处理完成，总计已处理 ${htmlMemoryManager.getProcessedCount()} 个文件`)
    logger.info(`记录目录: ${htmlMemoryManager.memoryDirectory}`)
  }
}