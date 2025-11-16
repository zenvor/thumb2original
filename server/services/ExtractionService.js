/**
 * 提取服务 - 处理图片提取任务
 */

import { logger } from '../../utils/logger.js'
import { validateAndNormalizeConfig } from '../../lib/configValidator.js'
import { launchBrowser } from '../../lib/browserLauncher.js'
import { loadAndScrollPage } from '../../lib/pageLoader.js'
import { extractImageUrls } from '../../lib/imageExtractor.js'
import { processUrlsByImageMode } from '../../lib/imageModeProcessor.js'
import { processDownloadQueue } from '../../lib/downloadQueue.js'
import { toLogMeta } from '../../utils/errors.js'

export class ExtractionService {
  constructor(storage, sseManager) {
    this.storage = storage
    this.sseManager = sseManager
  }

  /**
   * 创建提取任务
   */
  async createExtraction(url, options = {}) {
    const taskId = this.generateId()

    const task = {
      id: taskId,
      url,
      hash: this.generateHash(url),
      status: 'pending',
      message: null,
      status_changed_at: null,
      trigger: options.trigger || 'api',
      options: {
        mode: options.mode || 'advanced',
        imageMode: options.imageMode || 'all'
      },
      images: null,
      images_count: 0,
      user_id: options.user_id || null,
      project_id: options.project_id || null
    }

    await this.storage.create(task)

    // 异步执行提取任务
    this.executeExtraction(taskId).catch(error => {
      logger.error(`Extraction ${taskId} failed:`, error)
    })

    return task
  }

  /**
   * 执行提取任务
   */
  async executeExtraction(taskId) {
    let browser = null
    let stopMonitoring = null

    try {
      // 更新状态为 running
      await this.updateTaskStatus(taskId, 'running')
      this.sseManager.sendProgress(taskId, 'Starting browser...', 5)

      // 获取任务
      const task = await this.storage.get(taskId)
      if (!task) throw new Error('Task not found')

      // 构建配置
      const config = await this.buildConfig(task)

      // 启动浏览器
      const launched = await launchBrowser(config)
      browser = launched.browser
      stopMonitoring = launched.stopMonitoring

      this.sseManager.sendProgress(taskId, 'Browser started', 10)

      // 创建页面
      const page = await browser.newPage()
      await page.setViewport({ width: 1800, height: 1000 })
      page.setDefaultTimeout(config.stability?.pageTimeout || 60000)

      // 加载页面
      this.sseManager.sendProgress(taskId, 'Loading page...', 20)
      const pageTitle = await loadAndScrollPage(page, task.url, config)

      // 滚动页面
      this.sseManager.sendProgress(taskId, 'Scrolling down...', 40)
      // loadAndScrollPage 已包含滚动

      // 查找图片
      this.sseManager.sendProgress(taskId, 'Finding images...', 60)
      const imageUrls = await extractImageUrls(page, task.url, config.imageDiscovery)

      // 处理图片模式
      const finalImageUrls = await processUrlsByImageMode(
        page,
        imageUrls,
        task.url,
        config.imageMode,
        config
      )

      await page.close()

      if (finalImageUrls.length === 0) {
        await this.updateTaskStatus(taskId, 'done', {
          images: [],
          images_count: 0,
          message: 'No images found'
        })
        this.sseManager.sendComplete(taskId, { images_count: 0 })
        return
      }

      // 分析图片（twoPhaseApi 模式）
      this.sseManager.sendProgress(taskId, 'Analyzing images...', 80)

      const downloadedImages = []
      const context = {
        browser,
        config: {
          ...config,
          analysis: {
            ...config.analysis,
            mode: 'twoPhaseApi' // 仅分析，不下载
          }
        },
        pageTitle
      }

      const result = await processDownloadQueue(
        finalImageUrls,
        null, // twoPhaseApi 模式不需要目标目录
        context,
        downloadedImages
      )

      // 转换为 API 响应格式
      const images = this.formatImages(result.validEntries || [])

      // 更新任务为完成
      await this.updateTaskStatus(taskId, 'done', {
        images,
        images_count: images.length,
        message: null
      })

      this.sseManager.sendProgress(taskId, 'Done', 100)
      this.sseManager.sendComplete(taskId, {
        images_count: images.length,
        status: 'done'
      })

    } catch (error) {
      logger.error(`Extraction ${taskId} error:`, toLogMeta(error))

      await this.updateTaskStatus(taskId, 'failed', {
        message: error.message
      })

      this.sseManager.sendError(taskId, error)

    } finally {
      // 清理资源
      if (stopMonitoring) {
        try { stopMonitoring() } catch {}
      }
      if (browser) {
        try { await browser.close() } catch {}
      }
    }
  }

  /**
   * 格式化图片数据为 API 响应格式
   */
  formatImages(validEntries) {
    return validEntries.map(entry => {
      const name = this.extractFileName(entry.url)
      const type = entry.analysisResult?.metadata?.format || 'unknown'
      const width = entry.analysisResult?.metadata?.width || 0
      const height = entry.analysisResult?.metadata?.height || 0
      const size = width * height

      return {
        id: this.generateId(),
        url: entry.url,
        name: name,
        basename: name ? `${name}.${type}` : undefined,
        size: size,
        type: type,
        width: width,
        height: height
      }
    })
  }

  /**
   * 提取文件名（不含扩展名）
   */
  extractFileName(url) {
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname
      const filename = pathname.split('/').pop()
      return filename ? filename.replace(/\.[^/.]+$/, '') : null
    } catch {
      return null
    }
  }

  /**
   * 构建爬虫配置
   */
  async buildConfig(task) {
    const baseConfig = {
      scrapeMode: 'single_page',
      targetUrl: task.url,
      imageMode: task.options.imageMode || 'all',
      outputDirectory: './download',
      maxRetries: 1,
      concurrentDownloads: 10,
      analysis: {
        mode: 'twoPhaseApi'
      }
    }

    return await validateAndNormalizeConfig(baseConfig)
  }

  /**
   * 更新任务状态
   */
  async updateTaskStatus(taskId, status, updates = {}) {
    const updateData = {
      status,
      status_changed_at: new Date().toISOString(),
      ...updates
    }

    await this.storage.update(taskId, updateData)
  }

  /**
   * 生成任务 ID
   */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 生成哈希
   */
  generateHash(url) {
    const crypto = await import('crypto')
    return crypto.createHash('sha1').update(url).digest('hex')
  }
}
