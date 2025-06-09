import fs from 'fs'
import path from 'path'
import axios from 'axios'
import os from 'os'
import { validateAndModifyFileName } from '../utils/file/validateAndModifyFileName.js'
import { ImageFormatDetector } from '../utils/image/ImageFormatDetector.js'
import { ImageConverter } from '../utils/image/ImageConverter.js'

/**
 * 下载管理器 - Page Pool 2.0
 * 实现智能页面池管理，支持PWS评分、健康检查、可观测性
 */
export class DownloadManager {
  constructor(config, logger) {
    this.config = config
    this.logger = logger
    this.requestFailedImages = []

    // 🧠 Page Pool 2.0 核心组件
    this.pageHealthTracker = new Map() // 页面健康状态跟踪
    this.poolMetrics = {
      totalPages: 0,
      reuseCount: 0,
      memoryUsage: [],
      batchTimes: [],
      pagesPerSec: 0,
      strategyUsed: 'unknown'
    }

    // 错误消息常量
    this.ERROR_MESSAGES = {
      NOT_IMAGE: 'This URL is not an image',
      NAVIGATION_FAILED: 'Protocol error (Page.navigate): Cannot navigate to invalid URL',
    }
  }

  /**
   * 🧠 PWS (Page Weight Score) 计算
   * 综合衡量页面负载：图片数量、DOM节点、字节数、堆内存
   */
  calcPWS(meta) {
    const { 
      images = 0, 
      domNodes = 0, 
      bytes = 0, 
      heap = 0 
    } = meta

    // 可配置权重系数
    const weights = this.config.get('pagePool.pws.weights') || {
      images: 0.3,
      domNodes: 0.25,
      bytes: 0.25,
      heap: 0.2
    }

    const pws = (
      images * weights.images +
      (domNodes / 1000) * weights.domNodes +
      (bytes / 1_000_000) * weights.bytes +
      (heap / 100) * weights.heap
    )

    this.logger.debug(`🧠 PWS计算: images=${images}, domNodes=${domNodes}, bytes=${bytes}, heap=${heap} => PWS=${pws.toFixed(2)}`)
    return pws
  }

  /**
   * 🧠 获取系统内存状态
   */
  getMemoryStatus() {
    const memUsage = process.memoryUsage()
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const freeMemRatio = freeMem / totalMem

    return {
      rss: memUsage.rss,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      freeMemRatio,
      freeMemMB: Math.round(freeMem / 1024 / 1024),
      totalMemMB: Math.round(totalMem / 1024 / 1024),
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024)
    }
  }

  /**
   * 🧠 智能策略选择 - 基于PWS + 内存双因子决策
   */
  chooseStrategy(imageUrls, currentUrl) {
    const strategy = this.config.get('pagePoolStrategy')
    
    // 手动指定策略
    if (strategy === 'reuse' || strategy === 'progressive') {
      this.poolMetrics.strategyUsed = strategy
      this.logger.debug(`🧠 使用手动指定策略: ${strategy}`)
      return strategy
    }

    // auto模式：智能选择
    const memStatus = this.getMemoryStatus()
    const freeMemThreshold = this.config.get('pagePool.autoThreshold.freeMemPercent') || 25
    const pwsThreshold = this.config.get('pagePool.autoThreshold.pws') || 50

    // 强制内存保护
    if (memStatus.freeMemRatio * 100 < freeMemThreshold) {
      this.poolMetrics.strategyUsed = 'progressive'
      this.logger.info(`🧠 内存不足(${Math.round(memStatus.freeMemRatio * 100)}% < ${freeMemThreshold}%)，强制使用progressive策略`)
      return 'progressive'
    }

    // 估算页面重量分数
    const estimatedPWS = this._estimatePageWeight(imageUrls, currentUrl)
    
    if (estimatedPWS < pwsThreshold) {
      this.poolMetrics.strategyUsed = 'reuse'
      this.logger.debug(`🧠 PWS较低(${estimatedPWS.toFixed(2)} < ${pwsThreshold})，选择reuse策略`)
      return 'reuse'
    } else {
      this.poolMetrics.strategyUsed = 'progressive'
      this.logger.debug(`🧠 PWS较高(${estimatedPWS.toFixed(2)} >= ${pwsThreshold})，选择progressive策略`)
      return 'progressive'
    }
  }

  /**
   * 🧠 估算页面重量分数 (已优化)
   */
  _estimatePageWeight(imageUrls, currentUrl) {
    const imageCount = imageUrls.length
    
    // ✨ FIX: 仅基于先验信息进行粗略估算，避免依赖错误的内存指标
    // 这里的权重和逻辑可以根据业务经验调整
    let estimatedPWS = imageCount * 1.0 // 简化模型：每个图片计1分
    
    // 根据URL模式进行权重调整
    if (currentUrl.includes('chpic.su')) {
      estimatedPWS *= 0.8 // chpic.su相对较轻
    } else if (currentUrl.includes('heavy-site.com')) {
      estimatedPWS *= 1.5 // 某些重型网站权重加倍
    }
    
    this.logger.debug(`🧠 PWS估算: imageCount=${imageCount} => Estimated PWS=${estimatedPWS.toFixed(2)}`)
    return estimatedPWS
  }

  /**
   * 🧠 页面健康检查 (已修复)
   * @param {import('puppeteer').Page} page - Puppeteer页面对象
   * @param {string} pageId - 页面健康追踪ID
   */
  async checkPageHealth(page, pageId) {
    const config = this.config.get('pagePool.reuse') || {}
    const maxReuse = config.maxReuse || 20
    const maxHeap = config.maxHeap || 200 // 单位 MB
    const maxErrors = config.maxErrors || 3

    let health = this.pageHealthTracker.get(pageId) || {
      reuseCount: 0,
      consecutive5xx: 0,
      lastError: null,
      createdAt: Date.now()
    }

    // ✨ FIX: 获取单个页面的性能指标
    let pageHeapUsedMB = 0
    try {
      const pageMetrics = await page.metrics()
      pageHeapUsedMB = Math.round(pageMetrics.JSHeapUsedSize / 1024 / 1024)
    } catch (error) {
      this.logger.debug(`🏥 获取页面${pageId}内存指标失败，跳过内存检查:`, error.message)
    }
    
    // 检查复用次数
    if (health.reuseCount > maxReuse) {
      this.logger.debug(`🏥 页面${pageId}复用次数超限(${health.reuseCount} > ${maxReuse})`)
      return { healthy: false, reason: 'maxReuse' }
    }

    // ✨ FIX: 基于页面自身的堆内存进行检查
    if (pageHeapUsedMB > maxHeap) {
      this.logger.debug(`🏥 页面${pageId}内存使用超限(${pageHeapUsedMB}MB > ${maxHeap}MB)`)
      return { healthy: false, reason: 'maxHeap' }
    }

    // 检查连续错误
    if (health.consecutive5xx >= maxErrors) {
      this.logger.debug(`🏥 页面${pageId}连续错误超限(${health.consecutive5xx} >= ${maxErrors})`)
      return { healthy: false, reason: 'maxErrors' }
    }

    return { healthy: true, health }
  }

  /**
   * 🧠 更新页面健康状态
   */
  updatePageHealth(pageId, isSuccess, isServerError = false) {
    let health = this.pageHealthTracker.get(pageId) || {
      reuseCount: 0,
      consecutive5xx: 0,
      lastError: null,
      createdAt: Date.now()
    }

    health.reuseCount++

    if (isSuccess) {
      health.consecutive5xx = 0 // 重置连续错误计数
    } else if (isServerError) {
      health.consecutive5xx++
      health.lastError = Date.now()
    }

    this.pageHealthTracker.set(pageId, health)
    return health
  }

  /**
   * 🧠 创建健康页面
   */
  async createHealthyPage(createPageFunc, pageId) {
    const page = await createPageFunc()
    
    // 初始化页面健康状态
    this.pageHealthTracker.set(pageId, {
      reuseCount: 0,
      consecutive5xx: 0,
      lastError: null,
      createdAt: Date.now()
    })

    // 设置页面级错误监听
    page.on('response', (response) => {
      const status = response.status()
      const isServerError = status >= 500 && status < 600
      if (isServerError) {
        this.updatePageHealth(pageId, false, true)
      }
    })

    return page
  }

  /**
   * 🧠 异步预热下一批页面（progressive策略优化）
   */
  async preloadNextBatch(nextBatchUrls, currentUrl, createPageFunc) {
    if (!this.config.get('pagePool.progressive.preloadNext')) {
      return []
    }

    const puppeteerCount = this._estimatePuppeteerNeeds(nextBatchUrls, currentUrl, nextBatchUrls.length)
    
    if (puppeteerCount === 0) {
      return []
    }

    this.logger.debug(`🔥 异步预热下一批: 预创建${puppeteerCount}个页面`)
    
    // 后台异步创建，不阻塞当前批次
    const preloadPromises = Array.from({ length: puppeteerCount }, (_, i) => 
      this.createHealthyPage(createPageFunc, `preload_${Date.now()}_${i}`)
    )

    try {
      return await Promise.all(preloadPromises)
    } catch (error) {
      this.logger.debug('异步预热失败，将回退到同步创建', error)
      return []
    }
  }

  /**
   * 🧠 收集性能指标
   */
  collectMetrics(batchTime, pagesUsed) {
    const memStatus = this.getMemoryStatus()
    
    this.poolMetrics.batchTimes.push(batchTime)
    this.poolMetrics.memoryUsage.push(memStatus.heapUsedMB)
    this.poolMetrics.totalPages = Math.max(this.poolMetrics.totalPages, pagesUsed)
    
    // 计算吞吐量
    if (batchTime > 0) {
      this.poolMetrics.pagesPerSec = pagesUsed / (batchTime / 1000)
    }
  }

  /**
   * 🧠 生成性能报告
   */
  generateMetricsReport() {
    const { batchTimes, memoryUsage, totalPages, strategyUsed, reuseCount } = this.poolMetrics
    
    if (batchTimes.length === 0) return null

    const avgBatchTime = batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length
    const maxMemory = Math.max(...memoryUsage)
    const avgMemory = memoryUsage.reduce((a, b) => a + b, 0) / memoryUsage.length
    const avgPagesPerSec = this.poolMetrics.pagesPerSec

    return {
      strategyUsed,
      totalPages,
      reuseCount,
      avgBatchTimeMs: Math.round(avgBatchTime),
      maxMemoryMB: maxMemory,
      avgMemoryMB: Math.round(avgMemory),
      avgPagesPerSec: Math.round(avgPagesPerSec * 100) / 100,
      batchCount: batchTimes.length
    }
  }

  /**
   * 生成随机间隔时间
   * @param {number} min 最小值
   * @param {number} max 最大值
   * @returns {number}
   * @private
   */
  _generateRandomInterval(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min)
  }

  /**
   * 创建目标目录
   * @param {string} dirPath 目录路径
   * @private
   */
  _createTargetDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
      this.logger.success(`文件夹${dirPath}创建成功`)
    }
  }

  /**
   * 判断指定URL是否应该使用Puppeteer
   * @param {string} imageUrl 图片URL
   * @param {string} currentUrl 当前页面URL
   * @returns {boolean} 是否使用Puppeteer
   * @private
   */
  _shouldUsePuppeteer(imageUrl, currentUrl) {
    const downloadMode = this.config.get('downloadMode')

    // 场景1：特殊网站使用axios下载
    if (currentUrl.includes('https://chpic.su') && downloadMode === 'downloadOriginImagesByThumbnails') {
      return false
    }

    // 场景2：直接图片链接使用axios（模拟直接下载的场景）
    if (imageUrl.includes('direct-download')) {
      return false
    }

    // 场景3：特定CDN使用axios（扩展功能）
    if (imageUrl.includes('cdn.example.com')) {
      return false
    }

    // 默认使用Puppeteer
    return true
  }

  /**
   * 估算需要使用Puppeteer的请求数量
   * @param {Array} imageUrls 图片URL数组
   * @param {string} currentUrl 当前页面URL
   * @param {number} maxConcurrentRequests 最大并发请求数
   * @returns {number} 需要Puppeteer的并发请求数量
   * @private
   */
  _estimatePuppeteerNeeds(imageUrls, currentUrl, maxConcurrentRequests) {
    // 计算第一轮并发请求的实际数量
    const firstBatchSize = Math.min(maxConcurrentRequests, imageUrls.length)

    // 计算第一轮中需要使用Puppeteer的请求数量
    let puppeteerCount = 0
    for (let i = 0; i < firstBatchSize; i++) {
      if (this._shouldUsePuppeteer(imageUrls[i], currentUrl)) {
        puppeteerCount++
      }
    }

    return puppeteerCount
  }

  /**
   * 创建按需页面池
   * @param {Array} imageUrls 图片URL数组
   * @param {string} currentUrl 当前页面URL
   * @param {number} maxConcurrentRequests 最大并发请求数
   * @param {Function} createPageFunc 创建页面的函数
   * @returns {Promise<Array>} 页面池数组
   * @private
   */
  async _createOnDemandPagePool(imageUrls, currentUrl, maxConcurrentRequests, createPageFunc) {
    // 估算需要的页面数量
    const puppeteerNeeds = this._estimatePuppeteerNeeds(imageUrls, currentUrl, maxConcurrentRequests)

    if (puppeteerNeeds === 0) {
      this.logger.debug('所有请求使用axios下载，无需创建页面池')
      return []
    }

    const enableProgressBar = this.config.get('enableProgressBar')
    if (!enableProgressBar) {
      this.logger.info(
        `按需页面池：第一轮 ${Math.min(
          maxConcurrentRequests,
          imageUrls.length
        )} 个请求中，${puppeteerNeeds} 个需要Puppeteer，创建 ${puppeteerNeeds} 个标签页`
      )
    } else {
      this.logger.debug(
        `按需页面池：第一轮 ${Math.min(
          maxConcurrentRequests,
          imageUrls.length
        )} 个请求中，${puppeteerNeeds} 个需要Puppeteer，创建 ${puppeteerNeeds} 个标签页`
      )
    }

    // 并行创建页面池
    const startTime = Date.now()
    const pageCreationPromises = Array.from({ length: puppeteerNeeds }, () => createPageFunc())

    try {
      const pages = await Promise.all(pageCreationPromises)
      const creationTime = Date.now() - startTime
      this.logger.debug(`页面池创建完成，用时 ${creationTime}ms`)
      return pages
    } catch (error) {
      this.logger.debug('页面池创建失败', error)
      throw error
    }
  }

  /**
   * 使用Puppeteer下载单个图片
   * @param {object} page Puppeteer页面对象
   * @param {string} imageUrl 图片URL
   * @param {Object} stateManager 状态管理器
   * @param {string} targetDownloadPath 目标下载路径
   * @returns {Promise}
   */
  async downloadWithPuppeteer(page, imageUrl, stateManager, targetDownloadPath) {
    try {
      let responseBuffer = null
      let downloadError = null
      let responseReceived = false

      // 创建一个响应监听器
      const responseHandler = async (response) => {
        if (response.url() === imageUrl && !responseReceived) {
          responseReceived = true
          try {
            responseBuffer = await response.buffer()
          } catch (err) {
            downloadError = err
            this.logger.debug(`获取图片数据失败: ${err.message}`)
          }
        }
      }

      // 添加响应监听器
      page.on('response', responseHandler)

      try {
        // 导航到图片URL，使用更短的超时时间
        await page.goto(imageUrl, {
          timeout: 10000, // 10秒超时
          waitUntil: 'domcontentloaded',
        })

        // 等待响应处理完成
        await new Promise((resolve) => setTimeout(resolve, 1000))

        if (downloadError) {
          throw downloadError
        }

        if (!responseBuffer) {
          throw new Error('无法获取图片数据')
        }

        if (!ImageFormatDetector.isImageBuffer(responseBuffer)) {
          throw new Error(this.ERROR_MESSAGES.NOT_IMAGE)
        }

        // 生成文件名
        const fileName = validateAndModifyFileName(this.extractFileName(imageUrl, responseBuffer))
        // 构造目标文件的完整路径
        const targetFilePath = path.join(targetDownloadPath, fileName)

        await this._handleDownloadSuccess(responseBuffer, targetFilePath, imageUrl, stateManager)
      } finally {
        // 移除响应监听器
        page.off('response', responseHandler)
      }
    } catch (error) {
      // 🚀 智能fallback：当Puppeteer下载失败时，自动尝试使用axios下载
      const enableProgressBar = this.config.get('enableProgressBar')
      
      if (!enableProgressBar) {
        this.logger.warn(`Puppeteer下载失败，尝试使用axios下载: ${imageUrl}`)
        this.logger.debug(`Puppeteer错误信息: ${error.message}`)
      } else {
        this.logger.debug(`Puppeteer下载失败，fallback到axios: ${imageUrl}`, error)
      }
      
      try {
        // 使用axios进行fallback下载
        await this.downloadWithAxios(imageUrl, stateManager, targetDownloadPath)
        
        if (!enableProgressBar) {
          this.logger.success(`axios fallback下载成功: ${imageUrl}`)
        } else {
          this.logger.debug(`axios fallback下载成功: ${imageUrl}`)
        }
      } catch (axiosError) {
        // 如果axios也失败了，才记录为真正的失败
        await this._handleDownloadError(axiosError, imageUrl, stateManager)
        
        if (!enableProgressBar) {
          this.logger.error(`Puppeteer和axios都下载失败: ${imageUrl}`)
        } else {
          this.logger.debug(`Puppeteer和axios都下载失败: ${imageUrl}`, axiosError)
        }
      }
    }
  }

  /**
   * 使用Axios下载单个图片
   * @param {string} imageUrl 图片URL
   * @param {Object} stateManager 状态管理器
   * @param {string} targetDownloadPath 目标下载路径
   * @returns {Promise}
   */
  async downloadWithAxios(imageUrl, stateManager, targetDownloadPath) {
    try {
      const timeout = this.config.get('timeouts.imageDownload')
      const response = await axios({
        method: 'get',
        url: imageUrl,
        responseType: 'arraybuffer',
        timeout: timeout,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      })

      const buffer = response.data

      let fileName
      if (imageUrl.includes('chpic.su')) {
        const type = imageUrl.split('?type=')[1]
        // 提取文件名
        const contentDisposition = response.headers['content-disposition']
        this.logger.debug('contentDisposition: ', contentDisposition)
        if (contentDisposition) {
          const match = contentDisposition.match(/filename=["']?([^"']+)/)
          if (match) {
            fileName = type + '_' + match[1].split('_-_')[1]
          }
        }
      } else {
        // 生成文件名
        fileName = validateAndModifyFileName(this.extractFileName(imageUrl, buffer))
      }

      // 构造目标文件的完整路径
      const targetFilePath = path.join(targetDownloadPath, fileName)

      // 请求成功 +1
      stateManager.incrementRequestSuccess()
      await this._handleDownloadSuccess(buffer, targetFilePath, imageUrl, stateManager)
    } catch (error) {
      await this._handleDownloadError(error, imageUrl, stateManager)
    }
  }

  /**
   * 处理下载成功
   * @param {Buffer} buffer 图片缓冲区
   * @param {string} targetFilePath 目标文件路径
   * @param {string} imageUrl 图片URL
   * @param {Object} stateManager 状态管理器
   * @private
   */
  async _handleDownloadSuccess(buffer, targetFilePath, imageUrl, stateManager) {
    // 下载成功，由 _saveFile 方法处理计数
    await this._saveFile(buffer, targetFilePath, imageUrl, stateManager)
  }

  /**
   * 处理下载错误
   * @param {Error} error 错误对象
   * @param {string} imageUrl 图片URL
   * @param {Object} stateManager 状态管理器
   * @private
   */
  async _handleDownloadError(error, imageUrl, stateManager) {
    const enableProgressBar = this.config.get('enableProgressBar')

    // 请求失败 +1
    stateManager.incrementRequestFailed()
    // 下载失败 +1
    stateManager.incrementDownloadFailed()

    // 根据进度条设置决定错误日志的详细程度
    if (!enableProgressBar) {
      this.logger.error('图片下载错误', error)
      this.logger.warn(`访问图片时发生错误：${imageUrl}`, error)
    } else {
      // 进度条模式下，只在debug级别记录详细错误
      this.logger.debug(`下载失败: ${imageUrl}`, error)
    }

    this.logger.debug('请求失败: ', stateManager.requestFailedCount)
    this.logger.debug('请求失败/下载失败: ', stateManager.downloadFailedCount)

    if (error.message !== this.ERROR_MESSAGES.NOT_IMAGE && error.message !== this.ERROR_MESSAGES.NAVIGATION_FAILED) {
      // 将失败的URL添加到重试列表
      this.requestFailedImages.push(imageUrl)
      this.logger.debug('错误请求集合个数: ', this.requestFailedImages.length)
    }
  }

  /**
   * 保存文件
   * @param {Buffer} buffer 文件缓冲区
   * @param {string} targetFilePath 目标文件路径
   * @param {string} imageUrl 图片URL
   * @param {Object} stateManager 状态管理器
   * @private
   */
  async _saveFile(buffer, targetFilePath, imageUrl, stateManager) {
    try {
      // 使用智能图像处理
      const processed = await ImageConverter.processImage(buffer, targetFilePath)

      // 如果转换了格式，增加转换计数
      if (processed.filePath !== targetFilePath) {
        stateManager.incrementWebpConversions()
      }

      // 写入文件
      await fs.promises.writeFile(processed.filePath, processed.buffer)

      // 下载成功 +1
      stateManager.incrementDownloadSuccess()

      // 根据进度条设置决定是否输出传统日志
      const fileName = processed.filePath.split('/').pop()
      const enableProgressBar = this.config.get('enableProgressBar')

      if (!enableProgressBar) {
        // 只有在未启用进度条时才输出传统的下载日志
        this.logger.success(`已下载 ${stateManager.downloadSuccessCount} 张 | ${fileName}`)
      }

      // 调试信息始终输出（但只在debug级别）
      this.logger.debug(`source: ${imageUrl}`)
    } catch (error) {
      // 保存失败时添加到重试列表
      this.requestFailedImages.push(imageUrl)

      // 下载失败 +1
      stateManager.incrementDownloadFailed()

      const enableProgressBar = this.config.get('enableProgressBar')
      if (!enableProgressBar) {
        this.logger.error('下载失败', error)
      } else {
        this.logger.debug(`文件保存失败: ${imageUrl}`, error)
      }

      this.logger.debug('下载失败: ', stateManager.downloadFailedCount)
    }
  }

  /**
   * 提取链接中的图像名和文件名
   * @param {string} url - 图像URL
   * @param {Buffer} buffer - 图像数据缓冲区
   * @returns {string} 文件名
   */
  extractFileName(url, buffer) {
    // 获取 URL 的路径部分
    const urlPath = url.split('?')[0]

    // 获取文件名
    const fileName = urlPath.split('/').pop()
    const type = fileName.split('.').pop()
    const imageName = fileName.replace(`.${type}`, '')

    // 使用ImageFormatDetector进行格式检测
    try {
      if (buffer && buffer.length >= 16) {
        const format = ImageFormatDetector.getImageFormat(buffer)

        if (format !== 'unknown') {
          // 对于JPEG格式，使用统一的.jpeg扩展名
          const extension = format === 'jpeg' ? 'jpeg' : format
          return imageName + '.' + extension
        }
      }
    } catch (error) {
      this.logger.debug('文件名格式检测失败，使用原扩展名', error)
    }

    // 如果检测失败，使用原有的扩展名
    return fileName
  }

  /**
   * 获取失败的图片列表
   * @returns {Array} 失败的图片URL数组
   */
  getFailedImages() {
    return this.requestFailedImages
  }

  /**
   * 清空失败的图片列表
   */
  clearFailedImages() {
    this.requestFailedImages = []
  }

  /**
   * 关闭页面池（为兼容性保留）
   * @param {Array} pagePool 页面池数组
   * @returns {Promise<void>}
   */
  async closePagePool(pagePool) {
    if (!pagePool || !Array.isArray(pagePool)) {
      return
    }

    this.logger.debug(`开始关闭页面池，共 ${pagePool.length} 个页面`)

    const closePromises = pagePool.map(async (page, index) => {
      try {
        if (page && !page.isClosed()) {
          await page.close()
          this.logger.debug(`页面池中的页面 ${index + 1} 已关闭`)
        }
      } catch (error) {
        this.logger.debug(`关闭页面池中的页面 ${index + 1} 时出错:`, error.message)
      }
    })

    await Promise.allSettled(closePromises)
    this.logger.debug('页面池已全部关闭')

    // 🚀 添加200ms延迟，确保浏览器优雅关闭
    await new Promise((resolve) => setTimeout(resolve, 200))
    this.logger.debug('页面池关闭延迟完成')
  }

  /**
   * 🧠 选择页面池管理策略 (Page Pool 2.0)
   * @param {number} imageCount 图片数量
   * @returns {string} 'reuse' | 'progressive'
   * @private
   */
  _selectPagePoolStrategy(imageCount) {
    // 使用新的智能策略选择
    return this.chooseStrategy([], '') // 临时传空值，实际调用时会传入正确参数
  }

  /**
   * 🏆 复用式页面池下载（Page Pool 2.0优化版）
   */
  async _downloadWithReuseStrategy(imageUrls, targetDownloadPath, stateManager, currentUrl, createPageFunc, maxConcurrentRequests, minIntervalMs, maxIntervalMs) {
    const startTime = Date.now()
    
    // 🏆 一次性创建页面池，后续批次复用
    const pagePool = await this._createOnDemandPagePool(imageUrls, currentUrl, maxConcurrentRequests, createPageFunc)

    // 🧠 为每个页面分配健康追踪ID
    const pageHealthIds = pagePool.map((_, index) => `reuse_${Date.now()}_${index}`)
    pagePool.forEach((page, index) => {
      this.pageHealthTracker.set(pageHealthIds[index], {
        reuseCount: 0,
        consecutive5xx: 0,
        lastError: null,
        createdAt: Date.now()
      })
    })

    let randomInterval = 0
    let startTimeMs = 0
    let endTimeMs = 0
    let pagePoolIndex = 0

    this.logger.debug(`🏆 复用式页面池大小：${pagePool.length}，图片总数：${imageUrls.length}`)

    try {
      for (let i = 0; i < imageUrls.length; i += maxConcurrentRequests) {
        const batchStartTime = Date.now()
        const batchUrls = imageUrls.slice(i, i + maxConcurrentRequests)
        
        const timeRemaining = randomInterval - (endTimeMs - startTimeMs)
        if (timeRemaining > 0) {
          randomInterval = timeRemaining
          await new Promise((resolve) => setTimeout(resolve, randomInterval))
        }
        startTimeMs = Date.now() % 10000

        await Promise.all(
          batchUrls.map(async (imageUrl) => {
            if (this._shouldUsePuppeteer(imageUrl, currentUrl)) {
              if (pagePool.length === 0) {
                throw new Error('需要使用Puppeteer但页面池为空')
              }
              
              const pageIndex = pagePoolIndex % pagePool.length
              const page = pagePool[pageIndex]
              const healthId = pageHealthIds[pageIndex]
              pagePoolIndex++

              // 🧠 页面健康检查 (已修复调用方式)
              const healthCheck = await this.checkPageHealth(page, healthId)
              if (!healthCheck.healthy) {
                this.logger.debug(`🏥 页面${healthId}不健康(${healthCheck.reason})，重新创建`)
                
                // 关闭不健康的页面
                try {
                  await page.close()
                } catch (e) {}
                
                // 创建新页面
                const newPage = await this.createHealthyPage(createPageFunc, healthId)
                pagePool[pageIndex] = newPage
                
                return this.downloadWithPuppeteer(newPage, imageUrl, stateManager, targetDownloadPath)
              } else {
                // 更新健康状态
                this.updatePageHealth(healthId, true)
                return this.downloadWithPuppeteer(page, imageUrl, stateManager, targetDownloadPath)
              }
            } else {
              return this.downloadWithAxios(imageUrl, stateManager, targetDownloadPath)
            }
          })
        )

        endTimeMs = Date.now() % 10000
        randomInterval = this._generateRandomInterval(minIntervalMs, maxIntervalMs)
        
        // 🧠 收集批次指标
        const batchTime = Date.now() - batchStartTime
        this.collectMetrics(batchTime, pagePool.length)
      }
    } catch (error) {
      this.logger.error('复用式下载过程中出现错误', error)
      throw error
    } finally {
      // 最后一次性关闭所有页面
      await this.closePagePool(pagePool)
      
      // 🧠 增加复用计数
      this.poolMetrics.reuseCount = pagePool.length
      
      // 生成性能报告
      const report = this.generateMetricsReport()
      if (report) {
        this.logger.info(`🧠 reuse策略性能报告: 页面${report.totalPages}个, 平均批次${report.avgBatchTimeMs}ms, 峰值内存${report.maxMemoryMB}MB, 吞吐量${report.avgPagesPerSec}页/秒`)
      }
    }
  }

  /**
   * 🧠 渐进式页面池下载（Page Pool 2.0优化版，方案A：先消费后生产）
   * 解决并发放大效应：将预热与使用解耦，形成平滑的生产者-消费者模式
   */
  async _downloadWithProgressiveStrategy(imageUrls, targetDownloadPath, stateManager, currentUrl, createPageFunc, maxConcurrentRequests, minIntervalMs, maxIntervalMs) {
    const totalBatches = Math.ceil(imageUrls.length / maxConcurrentRequests)
    let preloadedPages = [] // 预热的页面池
    let globalPagePool = []

    let randomInterval = 0
    let startTime = 0
    let endTime = 0

    this.logger.debug(`🧠 progressive策略(方案A): 总批次${totalBatches}，图片总数${imageUrls.length}`)

    try {
      // 🚀 启动阶段：为第一批预热页面（避免第一批次的并发创建）
      const firstBatchUrls = imageUrls.slice(0, maxConcurrentRequests)
      this.logger.debug(`🚀 启动预热：为第一批创建页面`)
      preloadedPages = await this.preloadNextBatch(firstBatchUrls, currentUrl, createPageFunc)
      this.logger.debug(`🚀 第一批预热完成：创建了${preloadedPages.length}个页面`)

      for (let i = 0; i < imageUrls.length; i += maxConcurrentRequests) {
        const batchStartTime = Date.now()
        const batchUrls = imageUrls.slice(i, i + maxConcurrentRequests)
        const batchIndex = Math.floor(i / maxConcurrentRequests) + 1
        
        // 1. 💡 使用预热好的页面（消费阶段）
        const puppeteerNeeds = this._estimatePuppeteerNeeds(batchUrls, currentUrl, batchUrls.length)
        const batchPagePool = preloadedPages.splice(0, puppeteerNeeds)
        this.logger.debug(`💡 批次${batchIndex}：使用${batchPagePool.length}个预热页面`)
        
        globalPagePool.push(...batchPagePool)

        // 2. 🔥 定义下一批预热任务（生产阶段）
        const nextBatchStart = i + maxConcurrentRequests
        let preloadPromise = Promise.resolve([]) // 默认为空Promise
        if (nextBatchStart < imageUrls.length) {
          const nextBatchUrls = imageUrls.slice(nextBatchStart, nextBatchStart + maxConcurrentRequests)
          preloadPromise = this.preloadNextBatch(nextBatchUrls, currentUrl, createPageFunc)
          this.logger.debug(`🔥 异步启动：为批次${batchIndex + 1}预热页面`)
        }

        // 3. ⏰ 间隔控制
        const timeRemaining = randomInterval - (endTime - startTime)
        if (timeRemaining > 0) {
          randomInterval = timeRemaining
          await new Promise((resolve) => setTimeout(resolve, randomInterval))
        }
        startTime = Date.now() % 10000

        // 4. 🎯 并行执行：当前批次下载 + 下一批预热
        let batchPageIndex = 0
        const downloadPromises = batchUrls.map(async (imageUrl) => {
          if (this._shouldUsePuppeteer(imageUrl, currentUrl)) {
            if (batchPagePool.length === 0) {
              throw new Error('需要使用Puppeteer但当前批次页面池为空')
            }
            const page = batchPagePool[batchPageIndex % batchPagePool.length]
            batchPageIndex++
            return this.downloadWithPuppeteer(page, imageUrl, stateManager, targetDownloadPath)
          } else {
            return this.downloadWithAxios(imageUrl, stateManager, targetDownloadPath)
          }
        })

        // 🎯 关键优化：同时等待下载完成和预热完成
        const [downloadResults, nextPreloadedPages] = await Promise.all([
          Promise.all(downloadPromises),
          preloadPromise
        ])

        // 5. 📦 将新预热的页面加入池中
        preloadedPages.push(...nextPreloadedPages)
        this.logger.debug(`📦 预热完成：下一批获得${nextPreloadedPages.length}个页面`)

        // 6. 🧠 内存优化：批次完成后立即释放页面
        if (batchPagePool.length > 0) {
          await this._closeBatchPages(batchPagePool, batchIndex, totalBatches)
          globalPagePool = globalPagePool.filter(page => !page.isClosed())
        }

        endTime = Date.now() % 10000
        randomInterval = this._generateRandomInterval(minIntervalMs, maxIntervalMs)
        
        // 🧠 收集批次指标
        const batchTime = Date.now() - batchStartTime
        this.collectMetrics(batchTime, batchPagePool.length)
      }
    } catch (error) {
      this.logger.error('渐进式下载过程中出现错误', error)
      throw error
    } finally {
      // 🧠 最终清理：确保所有页面都被关闭
      const allRemainingPages = [
        ...globalPagePool.filter(page => !page.isClosed()),
        ...preloadedPages.filter(page => !page.isClosed())
      ]
      
      if (allRemainingPages.length > 0) {
        this.logger.debug(`🧠 最终清理：关闭剩余的 ${allRemainingPages.length} 个页面`)
        await this.closePagePool(allRemainingPages)
      }
      
      // 生成性能报告
      const report = this.generateMetricsReport()
      if (report) {
        this.logger.info(`🧠 progressive策略性能报告: 最大页面${report.totalPages}个, 平均批次${report.avgBatchTimeMs}ms, 峰值内存${report.maxMemoryMB}MB, 吞吐量${report.avgPagesPerSec}页/秒`)
      }
    }
  }

  /**
   * 下载图片批次 - 入口方法，集成Page Pool 2.0
   */
  async downloadBatch(imageUrls, targetDownloadPath, stateManager, currentUrl, createPageFunc) {
    // 创建目标目录
    this._createTargetDirectory(targetDownloadPath)

    const maxConcurrentRequests = this.config.get('maxConcurrentRequests')
    const minIntervalMs = this.config.get('minIntervalMs')
    const maxIntervalMs = this.config.get('maxIntervalMs')

    // 🧠 智能策略选择 (Page Pool 2.0)
    const pagePoolStrategy = this.chooseStrategy(imageUrls, currentUrl)
    
    if (pagePoolStrategy === 'reuse') {
      return this._downloadWithReuseStrategy(imageUrls, targetDownloadPath, stateManager, currentUrl, createPageFunc, maxConcurrentRequests, minIntervalMs, maxIntervalMs)
    } else {
      return this._downloadWithProgressiveStrategy(imageUrls, targetDownloadPath, stateManager, currentUrl, createPageFunc, maxConcurrentRequests, minIntervalMs, maxIntervalMs)
    }
  }

  /**
   * 🧠 为单个批次创建页面池（内存优化）
   * @param {Array} batchUrls 当前批次的URL数组
   * @param {string} currentUrl 当前页面URL
   * @param {Function} createPageFunc 创建页面的函数
   * @returns {Promise<Array>} 当前批次的页面池
   * @private
   */
  async _createBatchPagePool(batchUrls, currentUrl, createPageFunc) {
    // 计算当前批次需要的页面数量
    let puppeteerCount = 0
    for (const imageUrl of batchUrls) {
      if (this._shouldUsePuppeteer(imageUrl, currentUrl)) {
        puppeteerCount++
      }
    }

    if (puppeteerCount === 0) {
      this.logger.debug('当前批次全部使用axios，无需创建页面')
      return []
    }

    this.logger.debug(`当前批次需要 ${puppeteerCount} 个页面`)

    // 并行创建页面
    const startTime = Date.now()
    const pageCreationPromises = Array.from({ length: puppeteerCount }, () => createPageFunc())

    try {
      const pages = await Promise.all(pageCreationPromises)
      const creationTime = Date.now() - startTime
      this.logger.debug(`批次页面池创建完成，用时 ${creationTime}ms`)
      return pages
    } catch (error) {
      this.logger.debug('批次页面池创建失败', error)
      throw error
    }
  }

  /**
   * 🧠 关闭批次页面（内存优化）
   * @param {Array} batchPagePool 批次页面池
   * @param {number} batchIndex 当前批次索引
   * @param {number} totalBatches 总批次数
   * @returns {Promise<void>}
   * @private
   */
  async _closeBatchPages(batchPagePool, batchIndex, totalBatches) {
    if (!batchPagePool || batchPagePool.length === 0) {
      return
    }

    this.logger.debug(`🧠 内存优化：批次 ${batchIndex}/${totalBatches} 完成，立即释放 ${batchPagePool.length} 个页面`)

    const closePromises = batchPagePool.map(async (page, index) => {
      try {
        if (page && !page.isClosed()) {
          await page.close()
          this.logger.debug(`批次页面 ${index + 1} 已释放`)
        }
      } catch (error) {
        this.logger.debug(`关闭批次页面 ${index + 1} 时出错:`, error.message)
      }
    })

    await Promise.allSettled(closePromises)
    
    // 短暂延迟确保页面完全释放
    await new Promise((resolve) => setTimeout(resolve, 100))
    this.logger.debug(`批次 ${batchIndex} 页面池已完全释放`)
  }
}
