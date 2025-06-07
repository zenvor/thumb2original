import puppeteer from 'puppeteer'
import { ConfigManager } from './ConfigManager.js'
import { ConsolaLogger as Logger } from '../logger/ConsolaLogger.js'
import { ImageExtractor } from './ImageExtractor.js'
import { DownloadManager } from './DownloadManager.js'

// 导入工具类
import { DownloadStateManager } from '../utils/download/DownloadStateManager.js'
import { RetryCountdown } from '../utils/RetryCountdown.js'

/**
 * 主爬虫类（重构后）
 * 协调各模块，保持主流程逻辑
 */
export class Crawler {
  constructor(userConfig = {}) {
    // 初始化配置管理器
    this.config = new ConfigManager(userConfig)

    // 从配置中获取日志级别，如果没有配置则使用默认值 'info'
    const logLevel = this.config.get('logLevel') || 'info'

    // 初始化全局日志器实例（供工具类使用）
    Logger.createGlobal({ level: logLevel })

    // 初始化日志管理器，使用配置中的日志级别
    this.logger = new Logger({ 
      prefix: 'Crawler',
      level: logLevel 
    })

    // 初始化图片提取器
    this.imageExtractor = new ImageExtractor(this.config, this.logger.child('ImageExtractor'))

    // 初始化下载管理器
    this.downloadManager = new DownloadManager(this.config, this.logger.child('DownloadManager'))

    // 全局浏览器实例
    this.browser = null

    // 状态管理器（传入日志器支持进度条）
    const enableProgressBar = this.config.get('enableProgressBar')
    const progressUpdateFrequency = this.config.get('progressUpdateFrequency') || 'realtime'
    this.stateManager = new DownloadStateManager({
      enableProgressBar,
      logger: this.logger.child('Progress'),
      updateFrequency: progressUpdateFrequency
    })

    // 全局resolve处理器
    this.globalResolveHandler = null
  }

  /**
   * 启动浏览器
   * @returns {Promise<void>}
   */
  async startBrowser() {
    const browserConfig = this.config.get('browser')

    this.browser = await puppeteer.launch({
      headless: browserConfig.headless,
      timeout: browserConfig.timeout,
      // 精简的启动参数，只保留必要的防下载设置
      args: [
        '--no-sandbox', // 无沙盒模式（安全性要求）
        '--disable-web-security', // 禁用网络安全检查
        '--disable-background-downloads', // 禁用后台下载
        '--disable-download-notification', // 禁用下载通知
        '--no-default-browser-check', // 不检查默认浏览器
        '--no-first-run', // 不运行首次运行流程
        '--disable-prompt-on-repost', // 禁用重新提交提示
        '--disable-popup-blocking', // 禁用弹出阻止（某些网站需要）
      ],
      defaultViewport: null,
    })

    // 设置浏览器实例到各个模块
    this.imageExtractor.setBrowser(this.browser)

    this.logger.success('浏览器启动成功')
  }

  /**
   * 优雅地关闭浏览器
   * @returns {Promise<void>}
   */
  async closeBrowser() {
    if (!this.browser) return

    try {
      // 获取所有页面
      const allPages = await this.browser.pages()
      // 过滤出仍然打开的页面，避免重复关闭已关闭的页面
      const openPages = allPages.filter((page) => !page.isClosed())

      this.logger.debug(`浏览器中总页面数: ${allPages.length}，仍需关闭的页面数: ${openPages.length}`)

      if (openPages.length === 0) {
        this.logger.debug('所有页面已关闭，直接关闭浏览器')
        await this.browser.close()
        this.logger.info('浏览器已优雅关闭')
        return
      }

      // 关闭所有仍然打开的页面以停止任何进行中的下载
      const closePromises = openPages.map(async (page, index) => {
        try {
          // 再次检查页面状态，因为在并发操作中页面可能已被关闭
          if (!page.isClosed()) {
            // 停止所有导航和请求
            await page.evaluate(() => {
              // 停止所有进行中的请求
              if (window.stop) {
                window.stop()
              }
              // 清理可能的下载相关内容
              if (document.body) {
                document.body.innerHTML = ''
              }
            })

            // 关闭页面
            await page.close()
            this.logger.debug(`浏览器页面 ${index + 1} 已关闭`)
          } else {
            this.logger.debug(`浏览器页面 ${index + 1} 已经关闭，跳过`)
          }
        } catch (error) {
          // 只有在调试模式下才显示页面关闭错误
          this.logger.debug(`关闭浏览器页面 ${index + 1} 时出现错误: ${error.message}`)
        }
      })

      // 等待所有页面关闭完成
      await Promise.allSettled(closePromises)

      // 强制关闭浏览器
      await this.browser.close()
      this.logger.info('浏览器已优雅关闭')
    } catch (error) {
      this.logger.warn('优雅关闭浏览器失败，尝试强制关闭：', error)
      try {
        // 强制关闭
        await this.browser.close()
      } catch (forceError) {
        this.logger.error('强制关闭浏览器也失败：', forceError)
      }
    } finally {
      this.browser = null
    }
  }

  /**
   * 处理单个URL的图片提取和下载
   * @param {string} url 要处理的URL
   * @returns {Promise<void>}
   */
  async processUrl(url) {
    this.logger.info(`开始处理URL: ${url}`)

    // 创建主页面
    const page = await this.imageExtractor.createPage()

    try {
      // 1. 加载页面
      await this.imageExtractor.loadPage(page, url)

      // 2. 滚动页面
      await this.imageExtractor.scrollPage(page)

      // 3. 查找图像
      const images = await this.imageExtractor.findImages(page)

      if (!images || images.length === 0) {
        this.logger.warn('未找到任何图片')
        return
      }

      // 4. 根据下载模式处理图片URLs
      let imageUrls = images
      const downloadMode = this.config.get('downloadMode')

      if (downloadMode === 'downloadOriginImagesByThumbnails') {
        imageUrls = await this.imageExtractor.getOriginalImageUrls(page, images)

        if (!imageUrls || imageUrls.length === 0) {
          this.logger.warn('没有匹配到原图')
          return
        }
      }

      // 5. 下载图片
      await this.downloadImages(imageUrls, page)
    } finally {
      // 确保主页面在完成任务后被关闭
      try {
        if (page && !page.isClosed()) {
          await page.close()
          this.logger.debug('主页面已关闭')
        }
      } catch (error) {
        this.logger.debug('关闭主页面时出错:', error.message)
      }
    }
  }

  /**
   * 下载图片的主流程
   * @param {Array} imageUrls 图片URL数组
   * @param {Object} mainPage 主页面对象
   * @returns {Promise<void>}
   */
  async downloadImages(imageUrls, mainPage) {
    return new Promise(async (resolve) => {
      this.globalResolveHandler = resolve

      // 重置状态管理器
      this.stateManager.reset()
      this.stateManager.setTotalImages(imageUrls.length)

      // 清空下载管理器的失败列表
      this.downloadManager.clearFailedImages()

      try {
        await this.performDownload(imageUrls, 0)
      } catch (error) {
        this.logger.debug('下载过程中出现错误', error) // 改为debug级别，避免重复记录
        resolve()
      }
    })
  }

  /**
   * 执行实际的下载操作
   * @param {Array} imageUrls 图片URL数组
   * @param {number} retryCount 当前重试次数
   * @returns {Promise<void>}
   */
  async performDownload(imageUrls, retryCount = 0) {
    const targetDownloadPath = this.imageExtractor.getTargetDownloadPath()
    const currentUrl = this.imageExtractor.getCurrentUrl()

    // 创建页面的函数，传递给 DownloadManager 按需使用
    const createPageFunc = () => {
      return this.imageExtractor.createPage({ setReferer: true })
    }

    try {
      // 执行批量下载（页面池将在 DownloadManager 内部按需创建和管理）
      await this.downloadManager.downloadBatch(imageUrls, targetDownloadPath, this.stateManager, currentUrl, createPageFunc)

      // 下载完成后的处理
      this.handleDownloadComplete(targetDownloadPath, currentUrl, retryCount)
    } catch (error) {
      this.logger.debug('下载过程中出现错误', error)
      throw error
    }
  }

  /**
   * 处理下载完成
   * @param {string} targetDownloadPath 目标下载路径
   * @param {string} currentUrl 当前URL
   * @param {number} retryCount 重试次数
   */
  handleDownloadComplete(targetDownloadPath, currentUrl, retryCount) {
    const failedImages = this.downloadManager.getFailedImages()

    if (failedImages.length > 0) {
      this.logger.debug('失败的图片URLs: ', failedImages)
      // 执行重试
      this.executeRetry(failedImages, targetDownloadPath, currentUrl, retryCount)
    } else {
      // 下载完成
      this.finishDownload()
    }
  }

  /**
   * 执行重试逻辑
   * @param {Array} failedImages 失败的图片URLs
   * @param {string} targetDownloadPath 目标下载路径
   * @param {string} currentUrl 当前URL
   * @param {number} currentRetryCount 当前重试次数
   */
  async executeRetry(failedImages, targetDownloadPath, currentUrl, currentRetryCount) {
    const maxRetries = this.config.get('retriesCount')
    const retryInterval = this.config.get('retryInterval')

    // 检查是否达到最大重试次数
    if (currentRetryCount >= maxRetries) {
      this.logger.warn(`达到最大重试次数 ${maxRetries}，停止重试`)
      this.finishDownload()
      return
    }

    this.logger.warn(`${failedImages.length} 张图片下载失败，${retryInterval}秒后开始重试`)

    try {
      // 使用RetryCountdown工具类进行优雅的倒计时显示
      await RetryCountdown.countdown(retryInterval, async () => {
        // 执行重试
        await this.performDownload(failedImages, currentRetryCount + 1)
      }, {
        prefix: `🔄 重试倒计时 (第${currentRetryCount + 1}/${maxRetries}次)`,
        color: '\x1b[33m' // 黄色
      })
    } catch (error) {
      this.logger.error('重试过程中出现错误', error)
      this.finishDownload()
    }
  }

  /**
   * 完成下载流程
   */
  finishDownload() {
    // 使用状态管理器显示最终结果（内部会根据进度条模式自动选择显示方式）
    this.stateManager.finishDownload()

    // 重置所有状态
    this.stateManager.reset()
    this.downloadManager.clearFailedImages()

    this.logger.info('下载流程完成')

    if (this.globalResolveHandler) {
      this.globalResolveHandler()
      this.globalResolveHandler = null
    }
  }

  /**
   * 运行爬虫的主入口方法
   * @returns {Promise<void>}
   */
  async run() {
    const extractMode = this.config.get('extractMode')

    try {
      // 启动浏览器
      await this.startBrowser()

      // 开始计时
      this.logger.info('开始计时')
      this.logger.time('download time')

      switch (extractMode) {
        case 'singleSite':
          const url = this.config.get('url')
          if (!url) {
            throw new Error('单站点模式下必须提供URL')
          }
          await this.processUrl(url)
          break

        case 'multipleSites':
          const urls = this.config.get('urls')
          if (!urls || urls.length === 0) {
            throw new Error('多站点模式下必须提供URLs数组')
          }

          for (const url of urls) {
            await this.processUrl(url)
          }
          break

        default:
          throw new Error(`未知的提取模式: ${extractMode}`)
      }

      // 结束计时
      this.logger.timeEnd('download time')
      this.logger.info('计时结束')
    } catch (error) {
      this.logger.error('爬虫运行过程中出现错误', error)
      throw error
    } finally {
      // 优雅关闭浏览器
      await this.closeBrowser()
    }
  }

  /**
   * 设置配置项
   * @param {string} key 配置键
   * @param {any} value 配置值
   */
  setConfig(key, value) {
    this.config.set(key, value)
  }

  /**
   * 获取配置项
   * @param {string} key 配置键
   * @returns {any} 配置值
   */
  getConfig(key) {
    return this.config.get(key)
  }

  /**
   * 设置日志级别
   * @param {string} level 日志级别
   */
  setLogLevel(level) {
    // 设置主日志器的级别
    this.logger.setLevel(level)
    
    // 更新全局日志器的级别
    const globalLogger = Logger.getGlobal()
    globalLogger.setLevel(level)
    
    // 更新所有模块的日志器级别
    if (this.imageExtractor && this.imageExtractor.logger) {
      this.imageExtractor.logger.setLevel(level)
    }
    if (this.downloadManager && this.downloadManager.logger) {
      this.downloadManager.logger.setLevel(level)
    }
  }

  /**
   * 调试配置信息
   */
  debugConfig() {
    this.config.debug()
  }

  /**
   * 静态方法：从配置文件创建爬虫实例
   * @param {string} configPath 配置文件路径
   * @returns {Promise<Crawler>} 爬虫实例
   */
  static async fromConfigFile(configPath) {
    const configManager = await ConfigManager.fromFile(configPath)
    return new Crawler(configManager.getAll())
  }

  /**
   * 静态方法：创建默认爬虫实例
   * @returns {Crawler} 默认爬虫实例
   */
  static createDefault() {
    return new Crawler()
  }
}
