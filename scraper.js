import fs from 'fs/promises'
import path from 'path'
import axios from 'axios'
import puppeteer from 'puppeteer'
import sharp from 'sharp'
// 辅助工具（请确保这些文件存在于 utils 文件夹中）
import { sanitizeFileName } from './utils/fileNameSanitizer.js'
import { convertThumbnailToOriginalUrl } from './utils/imageUrlConverter.js'

/**
 * ===================================================================================
 * 爬虫配置文件
 * ===================================================================================
 */
const scraperConfig = {
  // --- 核心模式 ---
  scrapeMode: 'single_page', // 抓取模式: 'single_page' (单页) | 'multiple_pages' (多页)
  imageMode: 'originals_only', // 图片模式: 'all' (所有图片) | 'originals_only' (仅原图)

  // --- 目标 URL ---
  targetUrl: 'file:///Users/claude/PersonalProject/%E7%88%AC%E8%99%AB/thumb2original/index.html', // 目标网址 (单页模式)
  targetUrls: [
    // 目标网址列表 (多页模式)
    // 'https://www.site1.com/gallery/page1',
    // 'https://www.site2.com/album/xyz'
  ],

  // --- 下载行为 ---
  outputDirectory: '', // 图片输出目录 (留空则默认在 ./download 下，并以网页标题命名)
  maxRetries: 3, // 下载失败后的最大重试次数
  retryDelaySeconds: 5, // 每次重试的间隔时间 (秒)

  // --- 性能与反爬虫 ---
  concurrentDownloads: 10, // 并发下载数
  minRequestDelayMs: 500, // 两批次下载之间的最小延迟 (毫秒)
  maxRequestDelayMs: 2000, // 两批次下载之间的最大延迟 (毫秒)
}

/**
 * @description 日志记录器，用于在控制台输出不同颜色的信息。
 */
const logger = {
  info: (message) => console.log('\x1b[36m%s\x1b[0m', message),
  success: (message) => console.log('\x1b[32m%s\x1b[0m', message),
  error: (message) => console.log('\x1b[31m%s\x1b[0m', message),
  warn: (message) => console.log('\x1b[33m%s\x1b[0m', message),
  header: (message) => console.log('\x1b[34m%s\x1b[0m', message),
}

/**
 * @description 等待指定的毫秒数。
 * @param {number} ms - 等待的毫秒数。
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @description 从给定的 Buffer 中识别图像格式。
 * @param {Buffer} buffer - 图像文件的 Buffer。
 * @returns {string} 图像格式 ('jpeg', 'png', 'gif', 'webp', 'bmp', 'Unknown')。
 */
function identifyImageFormat(buffer) {
  if (!buffer || buffer.length < 12) return 'Unknown'
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpeg'
  if (buffer[0] === 0x89 && buffer.toString('utf8', 1, 4) === 'PNG') return 'png'
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif'
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  )
    return 'webp'
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'bmp'
  return 'Unknown'
}

/**
 * @description 从 URL 中提取文件名，并使用 Buffer 分析来确定正确的文件扩展名。
 * @param {string} url - 图像的 URL。
 * @param {Buffer} buffer - 图像文件的 Buffer。
 * @returns {string} 带有正确扩展名的完整文件名。
 */
function getFileNameFromUrl(url, buffer) {
  const urlPath = url.split('?')[0]
  const baseName = urlPath.split('/').pop()
  const nameWithoutExt = baseName.includes('.') ? baseName.substring(0, baseName.lastIndexOf('.')) : baseName
  const extension = identifyImageFormat(buffer)
  return `${nameWithoutExt}.${extension}`
}

/**
 * @description 将 WebP 格式的 Buffer 转换为 PNG 格式。
 * @param {Buffer} webpBuffer - WebP 图像的 Buffer。
 * @returns {Promise<Buffer|null>} 转换后的 PNG Buffer，如果失败则返回 null。
 */
async function convertWebpToPng(webpBuffer) {
  try {
    return await sharp(webpBuffer).toFormat('png').toBuffer()
  } catch (error) {
    logger.error(`WebP 到 PNG 转换失败: ${error.message}`)
    return null
  }
}

/**
 * @description 保存图像 Buffer 到文件系统。
 * @param {Buffer} buffer - 图像 Buffer。
 * @param {string} filePath - 目标文件路径。
 * @param {string} imageUrl - 原始图像 URL，用于错误记录。
 * @param {object} stats - 用于跟踪下载统计的对象。
 * @returns {Promise<void>}
 */
async function saveImage(buffer, filePath, imageUrl, stats) {
  try {
    let finalBuffer = buffer
    let finalFilePath = filePath

    if (identifyImageFormat(buffer) === 'webp') {
      logger.info(`正在转换 WebP 图片: ${imageUrl}`)
      const pngBuffer = await convertWebpToPng(buffer)
      if (pngBuffer) {
        finalBuffer = pngBuffer
        finalFilePath = filePath.replace(/\.webp$/i, '.png')
        logger.success('成功将 WebP 转换为 PNG。')
      } else {
        throw new Error('转换 WebP 缓冲区失败。')
      }
    }

    await fs.writeFile(finalFilePath, finalBuffer)
    stats.successful++
    logger.success(`已下载 (${stats.successful}/${stats.total}): ${finalFilePath}`)
  } catch (error) {
    stats.failed++
    stats.failedUrls.push(imageUrl)
    logger.error(`保存图片失败 ${imageUrl}: ${error.message}`)
  }
}

/**
 * @description 使用 Puppeteer 页面或 Axios 下载单个图像。
 * @param {string} imageUrl - 要下载的图像 URL。
 * @param {object} context - 包含浏览器实例、配置和页面标题等信息的上下文对象。
 * @returns {Promise<{buffer: Buffer, finalUrl: string, headers: object}|null>} 包含 Buffer 和最终 URL 的对象，如果失败则返回 null。
 */
async function fetchImage(imageUrl, context) {
  const { config, browser } = context
  const timeout = 60 * 1000 // 60 seconds timeout

  // 针对特定网站使用 Axios 下载
  if (imageUrl.includes('chpic.su') && config.imageMode === 'originals_only') {
    try {
      const response = await axios({
        url: imageUrl,
        responseType: 'arraybuffer',
        timeout,
      })
      return {
        buffer: Buffer.from(response.data),
        finalUrl: imageUrl,
        headers: response.headers,
      }
    } catch (error) {
      logger.error(`Axios 下载失败 ${imageUrl}: ${error.code || error.message}`)
      return null
    }
  }

  // 默认使用 Puppeteer 下载
  const page = await browser.newPage()
  try {
    await page.setExtraHTTPHeaders({
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    })
    const response = await page.goto(imageUrl, { waitUntil: 'networkidle0', timeout })
    const contentType = response.headers()['content-type']
    if (!contentType || !contentType.startsWith('image/')) {
      throw new Error(`Invalid content-type: ${contentType}`)
    }
    const buffer = await response.buffer()
    return { buffer, finalUrl: response.url(), headers: response.headers() }
  } catch (error) {
    logger.error(`Puppeteer 下载失败 ${imageUrl}: ${error.message}`)
    return null
  } finally {
    await page.close()
  }
}

/**
 * @description 加载页面并滚动到底部以触发懒加载。
 * @param {object} page - Puppeteer 页面实例。
 * @param {string} url - 要加载的页面 URL。
 * @returns {Promise<string>} 页面标题。
 */
async function loadAndScrollPage(page, url) {
  logger.info(`正在导航到: ${url}`)
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 300 * 1000 })
  const title = await page.title()
  logger.info(`页面标题: "${title}"`)

  logger.info('向下滚动以加载所有图片...')
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0
      const distance = 1000
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight
        window.scrollBy(0, distance)
        totalHeight += distance
        if (totalHeight >= scrollHeight) {
          clearInterval(timer)
          resolve()
        }
      }, 500)
    })
  })
  logger.success('滚动完成。')
  return title
}

/**
 * @description 从页面中提取所有图像 URL。
 * @param {object} page - Puppeteer 页面实例。
 * @param {string} pageUrl - 当前页面的 URL。
 * @returns {Promise<string[]>} 提取到的图像 URL 数组。
 */
async function extractImageUrls(page, pageUrl) {
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

  logger.success(`找到 ${uniqueUrls.length} 个唯一的图片 URL。`)
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
async function processUrlsByImageMode(page, images, pageUrl, imageMode) {
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
  logger.success(`已生成 ${uniqueUrls.length} 个原始图片 URL。`)
  return uniqueUrls
}

/**
 * @description 管理和执行图片下载任务，包括并发控制和重试机制。
 * @param {string[]} imageUrls - 要下载的图片 URL 列表。
 * @param {object} context - 全局上下文对象。
 * @returns {Promise<void>}
 */
async function downloadManager(imageUrls, context) {
  const { config, pageTitle } = context

  const baseDownloadDir = config.outputDirectory || './download'
  const targetDownloadDir = path.join(baseDownloadDir, sanitizeFileName(pageTitle))
  await fs.mkdir(targetDownloadDir, { recursive: true })
  logger.info(`已创建下载文件夹: ${targetDownloadDir}`)

  let urlsToProcess = [...imageUrls]
  let currentRetry = 0

  while (urlsToProcess.length > 0 && currentRetry <= config.maxRetries) {
    if (currentRetry > 0) {
      logger.warn(
        `--- 开始第 ${currentRetry}/${config.maxRetries} 次重试，处理 ${urlsToProcess.length} 张失败的图片 ---`
      )
      await delay(config.retryDelaySeconds * 1000)
    }

    const stats = {
      total: urlsToProcess.length,
      successful: 0,
      failed: 0,
      failedUrls: [],
    }

    const { concurrentDownloads, minRequestDelayMs, maxRequestDelayMs } = config

    for (let i = 0; i < urlsToProcess.length; i += concurrentDownloads) {
      const batch = urlsToProcess.slice(i, i + concurrentDownloads)

      const downloadPromises = batch.map(async (imageUrl) => {
        const imageData = await fetchImage(imageUrl, context)
        if (!imageData) {
          stats.failed++
          stats.failedUrls.push(imageUrl)
          return
        }

        let fileName
        // 特定网站的文件名提取逻辑
        if (imageUrl.includes('chpic.su') && imageData.headers['content-disposition']) {
          const match = imageData.headers['content-disposition'].match(/filename=["']?([^"']+)/)
          const type = imageUrl.split('?type=')[1] || ''
          if (match && match[1]) {
            fileName = `${type}_${match[1].split('_-_')[1]}`
          }
        }

        if (!fileName) {
          fileName = getFileNameFromUrl(imageUrl, imageData.buffer)
        }

        const validatedFileName = sanitizeFileName(fileName)
        const filePath = path.join(targetDownloadDir, validatedFileName)
        await saveImage(imageData.buffer, filePath, imageUrl, stats)
      })

      await Promise.all(downloadPromises)

      if (i + concurrentDownloads < urlsToProcess.length) {
        const randomInterval =
          Math.floor(Math.random() * (maxRequestDelayMs - minRequestDelayMs + 1)) + minRequestDelayMs
        logger.info(`等待 ${randomInterval} 毫秒后开始下一批次...`)
        await delay(randomInterval)
      }
    }

    logger.header(`--- 批处理完成 (尝试次数 ${currentRetry}) ---`)
    logger.success(`成功下载: ${stats.successful}/${stats.total}`)
    logger.error(`下载失败: ${stats.failed}/${stats.total}`)

    urlsToProcess = [...stats.failedUrls]
    currentRetry++
  }

  if (urlsToProcess.length > 0) {
    logger.error(`所有重试后，仍有 ${urlsToProcess.length} 张图片下载失败:`)
    urlsToProcess.forEach((url) => logger.error(`- ${url}`))
  }
}

/**
 * @description 单个 URL 的完整抓取流程。
 * @param {string} url - 目标网站 URL。
 * @param {object} browser - Puppeteer 浏览器实例。
 * @param {object} config - 用户配置。
 */
async function scrapeUrl(url, browser, config) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1800, height: 1000 })

  try {
    const pageTitle = await loadAndScrollPage(page, url)
    let imageUrls = await extractImageUrls(page, url)

    const finalImageUrls = await processUrlsByImageMode(page, imageUrls, url, config.imageMode)

    if (finalImageUrls.length === 0) {
      logger.warn('此 URL 无需下载图片。')
      return
    }

    const context = {
      browser,
      config,
      pageTitle,
    }
    await downloadManager(finalImageUrls, context)
  } catch (error) {
    logger.error(`抓取 ${url} 时发生错误: ${error.message}`)
    console.error(error.stack)
  } finally {
    if (page && !page.isClosed()) {
      await page.close()
      logger.info(`页面 ${url} 已关闭。`)
    }
  }
}

/**
 * @description 主函数，根据配置启动图片抓取器。
 * @param {object} config - 爬虫的配置对象。
 */
async function runImageScraper(config) {
  const browser = await puppeteer.launch({ headless: false, timeout: 300 * 1000 })
  logger.info('浏览器已启动。')

  const startTime = Date.now()

  try {
    const urlsToScrape = config.scrapeMode === 'single_page' ? [config.targetUrl] : config.targetUrls

    for (const url of urlsToScrape) {
      if (!url) continue
      logger.header(`
------------------- 开始抓取: ${url} -------------------`)
      await scrapeUrl(url, browser, config)
      logger.header(`------------------- 抓取完成: ${url} -------------------
`)
    }
  } catch (error) {
    logger.error(`发生了一个严重错误: ${error.message}`)
  } finally {
    if (browser) {
      await browser.close()
      logger.info('浏览器已关闭。')
    }
    const duration = (Date.now() - startTime) / 1000
    logger.header(`总执行时间: ${duration.toFixed(2)} 秒。`)
  }
}

// ===================================================================================
// 启动爬虫
// ===================================================================================
runImageScraper(scraperConfig)
