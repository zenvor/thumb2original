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
  constructor(storage, wsManager, imageCache, globalConfig = null) {
    this.storage = storage
    this.wsManager = wsManager
    this.imageCache = imageCache
    this.globalConfig = globalConfig
  }

  /**
   * 创建提取任务
   */
  async createExtraction(url, options = {}) {
    const taskId = this.generateId()

    const task = {
      id: taskId,
      url,
      hash: await this.generateHash(url),
      status: 'pending',
      message: null,
      status_changed_at: null,
      trigger: options.trigger || 'api',
      options: {
        mode: options.mode || 'advanced',
        imageMode: options.imageMode || 'all',
        ignoreInlineImages: options.ignoreInlineImages || false
      },
      images: null,
      images_count: 0,
      user_id: options.user_id || null,
      project_id: options.project_id || null
    }

    await this.storage.create(task)

    logger.info(`[${taskId}] 🚀 Created extraction task:`, {
      url,
      mode: task.options.mode,
      imageMode: task.options.imageMode,
      ignoreInlineImages: task.options.ignoreInlineImages
    })

    // 异步执行提取任务
    this.executeExtraction(taskId).catch(error => {
      logger.error(`[${taskId}] ❌ Extraction failed:`, error)
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
      this.wsManager.sendProgress(taskId, 'Starting browser...', 5)

      // 获取任务
      const task = await this.storage.get(taskId)
      if (!task) throw new Error('Task not found')

      logger.info(`[${taskId}] 🏃 Starting extraction execution`)

      // 构建配置
      const config = await this.buildConfig(task)
      logger.info(`[${taskId}] ⚙️ Config built:`, {
        imageMode: config.imageMode,
        analysisMode: config.analysis?.mode,
        includeInlineImages: config.imageDiscovery?.includeInlineImages
      })

      // 启动浏览器
      const launched = await launchBrowser(config)
      browser = launched.browser
      stopMonitoring = launched.stopMonitoring

      this.wsManager.sendProgress(taskId, 'Browser started', 10)

      // 创建页面
      const page = await browser.newPage()
      await page.setViewport({ width: 1800, height: 1000 })
      page.setDefaultTimeout(config.stability?.pageTimeout || 60000)

      // 加载页面
      this.wsManager.sendProgress(taskId, 'Loading page...', 20)
      const pageTitle = await loadAndScrollPage(
        page,
        task.url,
        config,
        // 传递进度回调，在滚动开始时推送进度
        () => this.wsManager.sendProgress(taskId, 'Scrolling down...', 40)
      )

      // 查找图片
      this.wsManager.sendProgress(taskId, 'Finding images...', 60)
      const imageUrls = await extractImageUrls(page, task.url, config.imageDiscovery)

      logger.info(`[${taskId}] 🔍 Found ${imageUrls.length} raw image URLs`)

      // 处理图片模式
      const finalImageUrls = await processUrlsByImageMode(
        page,
        imageUrls,
        task.url,
        config.imageMode,
        config
      )

      logger.info(`[${taskId}] ✅ After imageMode processing: ${finalImageUrls.length} images (mode: ${config.imageMode})`)

      await page.close()

      if (finalImageUrls.length === 0) {
        logger.warn(`[${taskId}] ⚠️ No images found after processing`)
        await this.updateTaskStatus(taskId, 'done', {
          images: [],
          images_count: 0,
          message: 'No images found'
        })
        this.wsManager.sendComplete(taskId, { images_count: 0 })
        return
      }

      // 根据模式处理图片
      const mode = task.options.mode || 'basic'
      logger.info(`[${taskId}] 📊 Processing in ${mode} mode`)
      let images = []

      if (mode === 'basic') {
        // basic 模式：仅返回 URL
        images = finalImageUrls.map(url => ({
          id: this.generateId(),
          url: url
        }))

        logger.info(`[${taskId}] ✨ Basic mode: created ${images.length} image entries`)
        this.wsManager.sendProgress(taskId, 'Done', 100)
      } else {
        // advanced 模式：分析图片并缓存
        logger.info(`[${taskId}] 🔬 Advanced mode: analyzing ${finalImageUrls.length} images...`)
        this.wsManager.sendProgress(taskId, 'Analyzing images...', 80)

        const downloadedImages = []
        const context = {
          browser,
          url: task.url, // 添加 URL 用于数据库记录
          config: {
            ...config,
            analysis: {
              ...config.analysis,
              mode: 'twoPhaseApi' // 仅分析，不下载到磁盘
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

        logger.info(`[${taskId}] 📦 Download queue raw result:`, {
          hasResult: !!result,
          resultKeys: result ? Object.keys(result) : [],
          hasTempFiles: !!result?.tempFiles,
          tempFilesLength: result?.tempFiles?.length || 0,
          hasValidEntries: !!result?.validEntries,
          validEntriesLength: result?.validEntries?.length || 0,
          downloadedImagesLength: downloadedImages.length,
          analyzed: result?.analyzed || 0
        })

        // twoPhaseApi 模式返回 tempFiles，其他模式返回 validEntries
        let entries = result?.tempFiles || result?.validEntries || []

        logger.info(`[${taskId}] 📊 Using entries from: ${result?.tempFiles ? 'tempFiles' : 'validEntries'}, count: ${entries.length}`)

        // twoPhaseApi 模式下，始终从数据库获取带 buffer 的图片
        // 不依赖 fromDatabase 标记，因为该模式下所有图片都存储在数据库中
        if (entries.length > 0 && result?.getImagesWithBuffers) {
          try {
            logger.info(`[${taskId}] 🗄️ Fetching images with buffers from database...`)
            const imagesFromDb = await result.getImagesWithBuffers()

            if (imagesFromDb && imagesFromDb.length > 0) {
              logger.info(`[${taskId}] 📦 Retrieved ${imagesFromDb.length} images from database`)

              // 将数据库格式转换为 formatImages 期望的格式
              entries = imagesFromDb.map(img => ({
                url: img.url,
                headers: img.headers,
                analysisResult: {
                  buffer: img.buffer,
                  metadata: {
                    format: img.format,
                    width: img.width,
                    height: img.height,
                    size: img.size
                  }
                },
                sequenceNumber: img.sequence_number
              }))

              logger.info(`[${taskId}] ✅ Converted ${entries.length} database entries to analysis format`)
            } else {
              logger.warn(`[${taskId}] ⚠️ Database returned empty results, will use entries without buffers`)
            }
          } catch (dbError) {
            logger.error(`[${taskId}] ❌ Failed to fetch images from database:`, toLogMeta(dbError))
            logger.warn(`[${taskId}] ⚠️ Continuing with entries without buffers (download功能将不可用)`)
          }
        }

        // 打印第一个 entry 的结构（如果有）
        if (entries.length > 0) {
          logger.info(`[${taskId}] 🔍 First entry structure:`, {
            keys: Object.keys(entries[0]),
            hasUrl: !!entries[0].url,
            hasAnalysisResult: !!entries[0].analysisResult,
            analysisResultKeys: entries[0].analysisResult ? Object.keys(entries[0].analysisResult) : [],
            hasTempPath: !!entries[0].tempPath,
            fromDatabase: entries[0].fromDatabase
          })
        }

        // 转换为 API 响应格式并缓存
        images = this.formatImages(entries, taskId)
        logger.info(`[${taskId}] ✨ Advanced mode: formatted ${images.length} images with metadata`)
      }

      // 更新任务为完成
      logger.info(`[${taskId}] 💾 Saving ${images.length} images to storage`)
      await this.updateTaskStatus(taskId, 'done', {
        images,
        images_count: images.length,
        original_matched: false,  // 标记未匹配原图
        message: null
      })

      logger.info(`[${taskId}] 🎉 Task completed successfully with ${images.length} images`)

      this.wsManager.sendProgress(taskId, 'Done', 100)
      this.wsManager.sendComplete(taskId, {
        images_count: images.length,
        status: 'done'
      })

    } catch (error) {
      logger.error(`Extraction ${taskId} error:`, toLogMeta(error))

      await this.updateTaskStatus(taskId, 'failed', {
        message: error.message
      })

      this.wsManager.sendError(taskId, error)

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
   * 格式化图片数据为 API 响应格式（advanced 模式）
   * 同时缓存图片 Buffer
   */
  formatImages(validEntries, taskId) {
    logger.info(`[${taskId}] 🎨 formatImages called with ${validEntries.length} entries`)

    if (validEntries.length === 0) {
      logger.warn(`[${taskId}] ⚠️ formatImages received empty validEntries array`)
      return []
    }

    const formatted = validEntries.map((entry, index) => {
      logger.debug(`[${taskId}] 🖼️ Processing entry ${index + 1}:`, {
        hasUrl: !!entry.url,
        url: entry.url,
        hasAnalysisResult: !!entry.analysisResult,
        analysisResultKeys: entry.analysisResult ? Object.keys(entry.analysisResult) : []
      })

      const imageId = this.generateId()
      const name = this.extractFileName(entry.url)
      const type = entry.analysisResult?.metadata?.format || 'unknown'
      const width = entry.analysisResult?.metadata?.width || 0
      const height = entry.analysisResult?.metadata?.height || 0
      const size = width * height

      // 缓存图片 Buffer（如果有）
      if (entry.analysisResult?.buffer) {
        logger.debug(`[${taskId}] 💾 Caching buffer for image ${index + 1} (${type}, ${width}x${height})`)
        this.imageCache.set(taskId, imageId, entry.analysisResult.buffer, {
          format: type,
          width: width,
          height: height,
          name: name,
          basename: name ? `${name}.${type}` : undefined
        })
      } else {
        logger.warn(`[${taskId}] ⚠️ No buffer found for entry ${index + 1}`)
      }

      const formatted = {
        id: imageId,
        url: entry.url,
        name: name,
        basename: name ? `${name}.${type}` : undefined,
        size: size,
        type: type,
        width: width,
        height: height
      }

      logger.debug(`[${taskId}] ✅ Formatted entry ${index + 1}:`, formatted)
      return formatted
    })

    logger.info(`[${taskId}] 🎨 formatImages returning ${formatted.length} formatted images`)
    return formatted
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
        mode: task.options.mode === 'advanced' ? 'twoPhaseApi' : 'disabled'
      },
      imageDiscovery: {
        includeInlineImages: !task.options.ignoreInlineImages
      },
      // 继承全局配置的 database 设置
      database: this.globalConfig?.database || {}
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
  async generateHash(url) {
    const crypto = await import('crypto')
    return crypto.createHash('sha1').update(url).digest('hex')
  }

  /**
   * 匹配原图 - 对已有任务的图片 URL 进行转换并分析
   */
  async matchOriginalImages(taskId) {
    const task = await this.storage.get(taskId)
    if (!task) {
      throw new Error('Task not found')
    }

    if (task.status !== 'done') {
      throw new Error('Task is not completed yet')
    }

    // 从数据库读取 'all' 模式的图片
    const { getDatabase } = await import('../../lib/database/ImageAnalysisDB.js')
    const db = getDatabase()
    const allModeImages = db.getImagesByMode(taskId, 'all', false)

    if (!allModeImages || allModeImages.length === 0) {
      throw new Error('No images found in task')
    }

    logger.info(`[${taskId}] 🔄 Starting original image matching for ${allModeImages.length} images...`)

    // 更新匹配状态为处理中
    await this.updateTaskStatus(taskId, task.status, {
      original_match_status: 'processing'
    })

    try {
      // 导入 URL 转换工具
      const { convertThumbnailToOriginalUrl } = await import('../utils/imageUrlConverter.js')

      // 转换 URL
      const originalUrls = allModeImages
        .map(img => {
          const originalUrl = convertThumbnailToOriginalUrl(img.url)
          return originalUrl || img.url  // 转换失败则使用原 URL
        })
        .filter(Boolean)

      logger.info(`[${taskId}] 📝 Converted ${originalUrls.length} URLs to original format`)

      // 如果是 advanced 模式，需要重新分析图片
      if (task.options.mode === 'advanced') {
        // 启动浏览器用于下载
        const { launchBrowser } = await import('../../lib/browserLauncher.js')
        const config = await this.buildConfig(task)
        const launched = await launchBrowser(config)
        const browser = launched.browser
        const stopMonitoring = launched.stopMonitoring

        try {
          const downloadedImages = []
          const context = {
            browser,
            url: task.url,
            imageMode: 'original',  // 标记为原图模式
            config: {
              ...config,
              analysis: {
                ...config.analysis,
                mode: 'twoPhaseApi'
              }
            }
          }

          // 分析图片
          const result = await processDownloadQueue(
            originalUrls,
            null,
            context,
            downloadedImages
          )

          let entries = result?.tempFiles || result?.validEntries || []

          // 从数据库获取图片数据
          if (entries.length > 0 && result?.getImagesWithBuffers) {
            const imagesFromDb = await result.getImagesWithBuffers()
            if (imagesFromDb && imagesFromDb.length > 0) {
              entries = imagesFromDb.map(img => ({
                url: img.url,
                headers: img.headers,
                analysisResult: {
                  buffer: img.buffer,
                  metadata: {
                    format: img.format,
                    width: img.width,
                    height: img.height,
                    size: img.size
                  }
                },
                sequenceNumber: img.sequence_number
              }))
            }
          }

          // 格式化图片
          const originalImages = this.formatImages(entries, taskId)

          logger.info(`[${taskId}] ✅ Matched ${originalImages.length} original images`)

          // 更新任务状态（图片已存储在数据库中）
          await this.updateTaskStatus(taskId, 'done', {
            original_matched: true,
            original_match_status: 'done'
          })

          return {
            success: true,
            matched_count: originalImages.length,
            images: originalImages
          }

        } finally {
          if (stopMonitoring) stopMonitoring()
          if (browser) await browser.close()
        }

      } else {
        // basic 模式，只返回 URL（不需要分析和保存）
        const originalImages = originalUrls.map(url => ({
          id: this.generateId(),
          url: url
        }))

        await this.updateTaskStatus(taskId, 'done', {
          original_matched: true,
          original_match_status: 'done'
        })

        logger.info(`[${taskId}] ✅ Basic mode: matched ${originalImages.length} original URLs`)

        return {
          success: true,
          matched_count: originalImages.length,
          images: originalImages
        }
      }

    } catch (error) {
      logger.error(`[${taskId}] ❌ Original matching failed:`, error)

      await this.updateTaskStatus(taskId, task.status, {
        original_match_status: 'failed'
      })

      throw error
    }
  }
}
