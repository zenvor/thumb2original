/**
 * 爬虫引擎核心类 - CLI 和 API 模式的共享逻辑
 * 职责：封装爬虫的完整生命周期，支持进度回调和状态管理
 */

import { logger } from '../../utils/logger.js'
import { validateAndNormalizeConfig } from '../configValidator.js'
import { launchBrowser } from '../browserLauncher.js'
import { loadAndScrollPage } from '../pageLoader.js'
import { extractImageUrls } from '../imageExtractor.js'
import { processUrlsByImageMode } from '../imageModeProcessor.js'
import { processLocalHtmlMode } from '../localHtmlProcessor.js'
import { scrapeUrl, downloadManager } from '../publicApi.js'
import { toLogMeta } from '../../utils/errors.js'

export class ScraperEngine {
  constructor(config, options = {}) {
    this.config = config
    this.options = options
    this.browser = null
    this.stopMonitoring = null
    this.status = 'idle' // idle, running, completed, failed
    this.startTime = null
    this.endTime = null
    this.results = []
    this.errors = []

    // 进度回调函数
    this.onProgress = options.onProgress || (() => {})
    this.onComplete = options.onComplete || (() => {})
    this.onError = options.onError || (() => {})
    this.onStatusChange = options.onStatusChange || (() => {})
  }

  /**
   * 更新状态并触发回调
   */
  updateStatus(newStatus, data = {}) {
    this.status = newStatus
    this.onStatusChange(newStatus, data)
    this.emitProgress({ status: newStatus, ...data })
  }

  /**
   * 发送进度信息
   */
  emitProgress(data) {
    this.onProgress({
      status: this.status,
      startTime: this.startTime,
      elapsedTime: this.startTime ? Date.now() - this.startTime : 0,
      ...data
    })
  }

  /**
   * 初始化浏览器
   */
  async initBrowser() {
    try {
      this.updateStatus('initializing', { step: 'browser' })
      const launched = await launchBrowser(this.config)
      this.browser = launched.browser
      this.stopMonitoring = launched.stopMonitoring
      this.emitProgress({ step: 'browser_ready' })
      return true
    } catch (error) {
      this.errors.push({
        type: 'browser_init',
        message: error.message,
        timestamp: Date.now()
      })
      logger.error(`无法启动浏览器：${error.message}`, 'system', toLogMeta(error))
      return false
    }
  }

  /**
   * 清理资源
   */
  async cleanup() {
    try {
      this.stopMonitoring && this.stopMonitoring()
    } catch {}

    if (this.browser) {
      try {
        await this.browser.close()
        logger.info('浏览器已关闭。')
      } catch (error) {
        logger.error(`关闭浏览器时发生错误: ${error.message}`, 'system', toLogMeta(error))
      }
    }
  }

  /**
   * 执行本地 HTML 模式
   */
  async runLocalHtmlMode() {
    logger.header('\n=================== 启动本地HTML爬虫模式 ===================')
    this.updateStatus('running', { mode: 'local_html' })

    await processLocalHtmlMode(this.browser, this.config, downloadManager)

    logger.header('=================== 本地HTML爬虫模式完成 ===================')
  }

  /**
   * 执行网络模式
   */
  async runNetworkMode() {
    const urlsToScrape = this.getUrlsToScrape()

    if (urlsToScrape.length === 0) {
      logger.warn('没有可抓取的 URL', 'system')
      return []
    }

    this.updateStatus('running', {
      mode: 'network',
      totalUrls: urlsToScrape.length
    })

    const twoPhaseApiOutputs = []

    for (let i = 0; i < urlsToScrape.length; i++) {
      const url = urlsToScrape[i]
      if (!url) continue

      this.emitProgress({
        currentUrl: url,
        urlIndex: i + 1,
        totalUrls: urlsToScrape.length
      })

      logger.header(`\n------------------- 开始抓取: ${url} (${i + 1}/${urlsToScrape.length}) -------------------`)

      try {
        const result = await scrapeUrl(
          url,
          this.browser,
          this.config,
          loadAndScrollPage,
          extractImageUrls,
          processUrlsByImageMode
        )

        if (this.config?.analysis?.mode === 'twoPhaseApi' && result) {
          twoPhaseApiOutputs.push({ url, ...result })
        }

        this.results.push({ url, success: true, result })

      } catch (error) {
        this.errors.push({
          type: 'scrape_error',
          url,
          message: error.message,
          timestamp: Date.now()
        })
        this.results.push({ url, success: false, error: error.message })
        logger.error(`抓取 ${url} 失败: ${error.message}`)
      }

      logger.header(`------------------- 抓取完成: ${url} -------------------\n`)
    }

    return twoPhaseApiOutputs
  }

  /**
   * 获取待抓取的 URL 列表
   */
  getUrlsToScrape() {
    if (this.config.scrapeMode === 'single_page') {
      return this.config.targetUrl ? [this.config.targetUrl] : []
    } else if (this.config.scrapeMode === 'multiple_pages') {
      return Array.isArray(this.config.targetUrls)
        ? this.config.targetUrls.filter(Boolean)
        : []
    }
    return []
  }

  /**
   * 运行爬虫 - 主入口
   */
  async run() {
    this.startTime = Date.now()
    this.status = 'running'
    this.results = []
    this.errors = []

    try {
      // 1. 配置校验
      this.updateStatus('initializing', { step: 'config' })
      this.config = await validateAndNormalizeConfig(this.config)

      // 2. 初始化浏览器
      const browserReady = await this.initBrowser()
      if (!browserReady) {
        throw new Error('浏览器初始化失败')
      }

      // 3. 执行爬取
      let finalOutputs
      if (this.config.scrapeMode === 'local_html') {
        await this.runLocalHtmlMode()
      } else {
        finalOutputs = await this.runNetworkMode()
      }

      // 4. 完成
      this.endTime = Date.now()
      const duration = (this.endTime - this.startTime) / 1000

      this.updateStatus('completed', {
        duration,
        totalResults: this.results.length,
        successCount: this.results.filter(r => r.success).length,
        errorCount: this.errors.length
      })

      const summary = {
        status: 'completed',
        duration,
        results: this.results,
        errors: this.errors,
        outputs: finalOutputs
      }

      this.onComplete(summary)
      return summary

    } catch (error) {
      this.endTime = Date.now()
      const duration = this.endTime - this.startTime

      this.updateStatus('failed', {
        error: error.message,
        duration: duration / 1000
      })

      logger.error(`发生了一个严重错误: ${error.message}`, 'system', toLogMeta(error))

      const errorSummary = {
        status: 'failed',
        error: error.message,
        duration: duration / 1000,
        results: this.results,
        errors: this.errors
      }

      this.onError(errorSummary)
      throw error

    } finally {
      await this.cleanup()
    }
  }

  /**
   * 获取当前状态快照
   */
  getStatus() {
    return {
      status: this.status,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.endTime
        ? (this.endTime - this.startTime) / 1000
        : this.startTime
        ? (Date.now() - this.startTime) / 1000
        : 0,
      results: this.results,
      errors: this.errors,
      config: {
        scrapeMode: this.config?.scrapeMode,
        imageMode: this.config?.imageMode
      }
    }
  }

  /**
   * 取消运行（如果支持）
   */
  async cancel() {
    if (this.status === 'running') {
      this.updateStatus('cancelled')
      await this.cleanup()
    }
  }
}
