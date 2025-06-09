import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { validateAndModifyFileName } from '../utils/file/validateAndModifyFileName.js'
import { ImageFormatDetector } from '../utils/image/ImageFormatDetector.js'
import { ImageConverter } from '../utils/image/ImageConverter.js'

/**
 * 下载管理器
 * 负责图片下载、重试、文件保存（保留原有逻辑）
 */
export class DownloadManager {
  constructor(config, logger) {
    this.config = config
    this.logger = logger
    this.requestFailedImages = []

    // 错误消息常量
    this.ERROR_MESSAGES = {
      NOT_IMAGE: 'This URL is not an image',
      NAVIGATION_FAILED: 'Protocol error (Page.navigate): Cannot navigate to invalid URL',
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
   * 下载图片批次
   * @param {Array} imageUrls 图片URL数组
   * @param {string} targetDownloadPath 目标下载路径
   * @param {Object} stateManager 状态管理器
   * @param {string} currentUrl 当前页面URL
   * @param {Function} createPageFunc 创建页面的函数
   * @returns {Promise<void>}
   */
  async downloadBatch(imageUrls, targetDownloadPath, stateManager, currentUrl, createPageFunc) {
    // 创建目标目录
    this._createTargetDirectory(targetDownloadPath)

    const maxConcurrentRequests = this.config.get('maxConcurrentRequests')
    const minIntervalMs = this.config.get('minIntervalMs')
    const maxIntervalMs = this.config.get('maxIntervalMs')

    // 🧠 智能页面池策略选择
    const pagePoolStrategy = this._selectPagePoolStrategy(imageUrls.length)
    
    if (pagePoolStrategy === 'reuse') {
      // 复用式：一次性创建页面池，适合小规模下载
      return this._downloadWithReuseStrategy(imageUrls, targetDownloadPath, stateManager, currentUrl, createPageFunc, maxConcurrentRequests, minIntervalMs, maxIntervalMs)
    } else {
      // 渐进式：分批创建和释放页面池，适合大规模下载
      return this._downloadWithProgressiveStrategy(imageUrls, targetDownloadPath, stateManager, currentUrl, createPageFunc, maxConcurrentRequests, minIntervalMs, maxIntervalMs)
    }
  }

  /**
   * 🧠 选择页面池管理策略
   * @param {number} imageCount 图片数量
   * @returns {string} 'reuse' | 'progressive'
   * @private
   */
  _selectPagePoolStrategy(imageCount) {
    const strategy = this.config.get('pagePoolStrategy')
    
    if (strategy === 'reuse') return 'reuse'
    if (strategy === 'progressive') return 'progressive'
    
    // auto模式：根据图片数量智能选择
    if (imageCount <= 50) {
      this.logger.debug(`🧠 智能策略：图片数量${imageCount}，选择复用式页面池（性能优先）`)
      return 'reuse'
    } else {
      this.logger.debug(`🧠 智能策略：图片数量${imageCount}，选择渐进式页面池（内存优先）`)
      return 'progressive'
    }
  }

  /**
   * 🏆 复用式页面池下载（性能优先）
   * @param {Array} imageUrls 图片URL数组
   * @param {string} targetDownloadPath 目标下载路径
   * @param {Object} stateManager 状态管理器
   * @param {string} currentUrl 当前页面URL
   * @param {Function} createPageFunc 创建页面的函数
   * @param {number} maxConcurrentRequests 最大并发请求数
   * @param {number} minIntervalMs 最小间隔
   * @param {number} maxIntervalMs 最大间隔
   * @returns {Promise<void>}
   * @private
   */
  async _downloadWithReuseStrategy(imageUrls, targetDownloadPath, stateManager, currentUrl, createPageFunc, maxConcurrentRequests, minIntervalMs, maxIntervalMs) {
    // 🏆 一次性创建页面池，后续批次复用
    const pagePool = await this._createOnDemandPagePool(imageUrls, currentUrl, maxConcurrentRequests, createPageFunc)

    // 随机请求间隔（毫秒）
    let randomInterval = 0
    let startTime = 0
    let endTime = 0
    let pagePoolIndex = 0

    this.logger.debug(`🏆 复用式页面池大小：${pagePool.length}，图片总数：${imageUrls.length}`)

    try {
      for (let i = 0; i < imageUrls.length; i += maxConcurrentRequests) {
        const batchUrls = imageUrls.slice(i, i + maxConcurrentRequests)
        
        const timeRemaining = randomInterval - (endTime - startTime)
        if (timeRemaining > 0) {
          randomInterval = timeRemaining
          await new Promise((resolve) => setTimeout(resolve, randomInterval))
        }
        startTime = Date.now() % 10000

        await Promise.all(
          batchUrls.map(async (imageUrl) => {
            if (this._shouldUsePuppeteer(imageUrl, currentUrl)) {
              if (pagePool.length === 0) {
                throw new Error('需要使用Puppeteer但页面池为空')
              }
              const page = pagePool[pagePoolIndex % pagePool.length]
              pagePoolIndex++
              return this.downloadWithPuppeteer(page, imageUrl, stateManager, targetDownloadPath)
            } else {
              return this.downloadWithAxios(imageUrl, stateManager, targetDownloadPath)
            }
          })
        )

        endTime = Date.now() % 10000
        randomInterval = this._generateRandomInterval(minIntervalMs, maxIntervalMs)
      }
    } catch (error) {
      this.logger.error('复用式下载过程中出现错误', error)
      throw error
    } finally {
      // 最后一次性关闭所有页面
      await this.closePagePool(pagePool)
    }
  }

  /**
   * 🧠 渐进式页面池下载（内存优先）
   * @param {Array} imageUrls 图片URL数组
   * @param {string} targetDownloadPath 目标下载路径
   * @param {Object} stateManager 状态管理器
   * @param {string} currentUrl 当前页面URL
   * @param {Function} createPageFunc 创建页面的函数
   * @param {number} maxConcurrentRequests 最大并发请求数
   * @param {number} minIntervalMs 最小间隔
   * @param {number} maxIntervalMs 最大间隔
   * @returns {Promise<void>}
   * @private
   */
  async _downloadWithProgressiveStrategy(imageUrls, targetDownloadPath, stateManager, currentUrl, createPageFunc, maxConcurrentRequests, minIntervalMs, maxIntervalMs) {
    const totalBatches = Math.ceil(imageUrls.length / maxConcurrentRequests)
    let globalPagePool = []

    // 随机请求间隔（毫秒）
    let randomInterval = 0
    // 请求的开始时间（每一轮）
    let startTime = 0
    // 请求的结束时间（每一轮）
    let endTime = 0

    this.logger.debug(`总批次数：${totalBatches}，图片总数：${imageUrls.length}`)

    try {
      /* 随机化请求间隔：为了更好地模拟真实用户的行为，在请求之间添加随机的时间间隔，
        而不是固定的间隔。这可以减少模式化的请求，降低被识别为爬虫的概率。 */
      for (let i = 0; i < imageUrls.length; i += maxConcurrentRequests) {
        const batchUrls = imageUrls.slice(i, i + maxConcurrentRequests)
        const batchIndex = Math.floor(i / maxConcurrentRequests) + 1
        
        // 🧠 为当前批次按需创建页面池
        const batchPagePool = await this._createBatchPagePool(batchUrls, currentUrl, createPageFunc)
        globalPagePool.push(...batchPagePool)
        
        const timeRemaining = randomInterval - (endTime - startTime)
        if (timeRemaining > 0) {
          randomInterval = timeRemaining
          // 设置请求间隔：在发送连续请求之间添加固定的时间间隔，以减缓请求的频率。
          await new Promise((resolve) => setTimeout(resolve, randomInterval))
        }
        // 请求的开始时间（每一轮）
        startTime = Date.now() % 10000

        // 页面池索引，用于当前批次的页面分配
        let batchPageIndex = 0

        await Promise.all(
          batchUrls.map(async (imageUrl) => {
            if (this._shouldUsePuppeteer(imageUrl, currentUrl)) {
              // 使用当前批次的页面池
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
        )

        // 🧠 内存优化：批次完成后立即释放页面，而不是等到全部完成
        if (batchPagePool.length > 0) {
          await this._closeBatchPages(batchPagePool, batchIndex, totalBatches)
          // 从全局页面池中移除已关闭的页面
          globalPagePool = globalPagePool.filter(page => !page.isClosed())
        }

        // 请求的结束时间（每一轮）
        endTime = Date.now() % 10000
        // 随机生成请求间隔
        randomInterval = this._generateRandomInterval(minIntervalMs, maxIntervalMs)
      }
    } catch (error) {
      this.logger.error('批量下载过程中出现错误', error)
      throw error
    } finally {
      // 🧠 最终清理：确保所有剩余页面都被关闭
      const remainingPages = globalPagePool.filter(page => !page.isClosed())
      if (remainingPages.length > 0) {
        this.logger.debug(`最终清理：关闭剩余的 ${remainingPages.length} 个页面`)
        await this.closePagePool(remainingPages)
      }
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
}
