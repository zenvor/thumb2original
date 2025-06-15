// download/DownloadManager.js
import { DownloadExecutor } from './DownloadExecutor.js'
import { DownloadProgress } from './DownloadProgress.js'
import * as DownloadUtils from './DownloadUtils.js'

/**
 * 简化的下载管理器
 * 遵循KISS原则，统一管理下载流程和页面池
 * 移除了过度复杂的PWS评分系统和双因子决策算法
 */
export class DownloadManager {
  constructor(config, logger) {
    this.config = config
    this.logger = logger
    
    // 核心执行器
    this.downloadExecutor = new DownloadExecutor(config, logger)
    
    // 简化的页面健康跟踪
    this.pageHealthTracker = new Map()
  }

  /**
   * 下载图片批次 - 主入口
   * @param {Array} imageUrls 图片URL列表
   * @param {string} targetDownloadPath 目标下载路径
   * @param {DownloadProgress} progressManager 进度管理器
   * @param {string} currentUrl 当前页面URL
   * @param {Function} createPageFunc 页面创建函数
   */
  async downloadBatch(imageUrls, targetDownloadPath, progressManager, currentUrl, createPageFunc) {
    // 文件夹已经在Crawler.js中提前创建，这里不再重复创建

    const maxConcurrentRequests = this.config.maxConcurrentRequests
    const minIntervalMs = this.config.minIntervalMs
    const maxIntervalMs = this.config.maxIntervalMs

    // 🎯 简化策略：直接使用配置的策略，或默认使用reuse
    const strategy = this.config.pagePoolStrategy || 'reuse'
    
    if (strategy === 'reuse') {
      await this._downloadWithReuseStrategy(
        imageUrls, targetDownloadPath, progressManager, currentUrl, 
        createPageFunc, maxConcurrentRequests, minIntervalMs, maxIntervalMs
      )
    } else {
      await this._downloadWithProgressiveStrategy(
        imageUrls, targetDownloadPath, progressManager, currentUrl, 
        createPageFunc, maxConcurrentRequests, minIntervalMs, maxIntervalMs
      )
    }
  }

  /**
   * 🔄 复用式页面池下载策略
   * @private
   */
  async _downloadWithReuseStrategy(imageUrls, targetDownloadPath, progressManager, currentUrl, createPageFunc, maxConcurrentRequests, minIntervalMs, maxIntervalMs) {
    // 简化的按需页面池创建
    const pagePool = await this._createSimplePagePool(imageUrls, currentUrl, maxConcurrentRequests, createPageFunc)
    let pagePoolIndex = 0
    
    this.logger.debug(`🔄 复用式页面池大小：${pagePool.length}，图片总数：${imageUrls.length}`)

    try {
      for (let i = 0; i < imageUrls.length; i += maxConcurrentRequests) {
        const batchUrls = imageUrls.slice(i, i + maxConcurrentRequests)

        // 简单的批次间隔
        await new Promise(resolve => setTimeout(resolve, DownloadUtils.generateRandomInterval(minIntervalMs, maxIntervalMs)))

        await Promise.all(batchUrls.map(async (imageUrl) => {
          if (DownloadUtils.shouldUsePuppeteer(imageUrl, currentUrl, this.config)) {
            // 按需创建页面（如果池为空）
            if (pagePool.length === 0) {
              this.logger.debug(`🔧 页面池为空，动态创建新页面: ${imageUrl}`)
              const dynamicPage = await createPageFunc()
              pagePool.push(dynamicPage)
            }
            
            const pageIndex = pagePoolIndex % pagePool.length
            const page = pagePool[pageIndex]
            pagePoolIndex++

            return this.downloadExecutor.executeDownloadByMethod(page, imageUrl, progressManager, targetDownloadPath)
          } else {
            return this.downloadExecutor.executeDownloadByMethod(null, imageUrl, progressManager, targetDownloadPath)
          }
        }))
      }
    } finally {
      await this._closePagePool(pagePool)
    }
  }

  /**
   * 📈 渐进式页面池下载策略
   * @private
   */
  async _downloadWithProgressiveStrategy(imageUrls, targetDownloadPath, progressManager, currentUrl, createPageFunc, maxConcurrentRequests, minIntervalMs, maxIntervalMs) {
    const totalBatches = Math.ceil(imageUrls.length / maxConcurrentRequests)
    let preloadedPages = []
    let activePages = []

    this.logger.debug(`📈 渐进式策略: 总批次${totalBatches}，图片总数${imageUrls.length}`)

    try {
      // 预热首批页面
      preloadedPages = await this._preloadBatch(imageUrls.slice(0, maxConcurrentRequests), currentUrl, createPageFunc)

      for (let i = 0; i < imageUrls.length; i += maxConcurrentRequests) {
        const batchIndex = Math.floor(i / maxConcurrentRequests) + 1
        const batchUrls = imageUrls.slice(i, i + maxConcurrentRequests)
        
        const puppeteerNeeds = DownloadUtils.estimatePuppeteerNeeds(batchUrls, currentUrl, batchUrls.length, this.config)
        const batchPagePool = preloadedPages.splice(0, puppeteerNeeds)
        activePages.push(...batchPagePool)

        // 异步预热下一批
        let preloadPromise = Promise.resolve([])
        const nextBatchStart = i + maxConcurrentRequests
        if (nextBatchStart < imageUrls.length) {
          const nextBatchUrls = imageUrls.slice(nextBatchStart, nextBatchStart + maxConcurrentRequests)
          preloadPromise = this._preloadBatch(nextBatchUrls, currentUrl, createPageFunc)
        }

        await new Promise(resolve => setTimeout(resolve, DownloadUtils.generateRandomInterval(minIntervalMs, maxIntervalMs)))

        // 执行下载
        let batchPageIndex = 0
        const downloadPromises = batchUrls.map(async (imageUrl) => {
          if (DownloadUtils.shouldUsePuppeteer(imageUrl, currentUrl, this.config)) {
            if (batchPageIndex >= batchPagePool.length) {
              this.logger.debug(`🔧 页面池不足，动态创建新页面: ${imageUrl}`)
              const dynamicPage = await createPageFunc()
              batchPagePool.push(dynamicPage)
              activePages.push(dynamicPage)
            }
            const page = batchPagePool[batchPageIndex++]
            return this.downloadExecutor.executeDownloadByMethod(page, imageUrl, progressManager, targetDownloadPath)
          } else {
            return this.downloadExecutor.executeDownloadByMethod(null, imageUrl, progressManager, targetDownloadPath)
          }
        })

        const [, nextPreloadedPages] = await Promise.all([Promise.all(downloadPromises), preloadPromise])
        preloadedPages.push(...nextPreloadedPages)

        // 立即释放本批次页面
        await this._closeBatchPages(batchPagePool)
        activePages = activePages.filter(p => !p.isClosed())
      }
    } finally {
      // 清理所有剩余页面
      const allRemainingPages = [...activePages.filter(p => !p.isClosed()), ...preloadedPages.filter(p => !p.isClosed())]
      if (allRemainingPages.length > 0) {
        this.logger.debug(`📈 最终清理：关闭剩余 ${allRemainingPages.length} 个页面`)
        await this._closePagePool(allRemainingPages)
      }
    }
  }

  /**
   * 🔧 简化的页面池创建
   * @private
   */
  async _createSimplePagePool(imageUrls, currentUrl, maxConcurrentRequests, createPageFunc) {
    const puppeteerNeeds = DownloadUtils.estimatePuppeteerNeeds(imageUrls, currentUrl, maxConcurrentRequests, this.config)
    
    if (puppeteerNeeds === 0) {
      this.logger.debug('🎯 所有请求使用axios下载，无需创建页面池')
      return []
    }

    const enableProgressBar = this.config.enableProgressBar
    const logMethod = enableProgressBar ? 'debug' : 'info'
    this.logger[logMethod](`🔧 创建页面池：${puppeteerNeeds} 个页面`)
    
    const startTime = Date.now()
    const pages = await Promise.all(
      Array.from({ length: puppeteerNeeds }, () => createPageFunc())
    )
    
    this.logger.debug(`⚡ 页面池创建完成，用时 ${Date.now() - startTime}ms`)
    return pages
  }

  /**
   * 🔥 预热下一批页面
   * @private
   */
  async _preloadBatch(nextBatchUrls, currentUrl, createPageFunc) {
    const puppeteerCount = DownloadUtils.estimatePuppeteerNeeds(nextBatchUrls, currentUrl, nextBatchUrls.length, this.config)
    if (puppeteerCount === 0) return []
    
    this.logger.debug(`🔥 预热下一批：创建 ${puppeteerCount} 个页面`)
    
    try {
      return await Promise.all(
        Array.from({ length: puppeteerCount }, () => createPageFunc())
      )
    } catch (error) {
      this.logger.debug('🔥 预热失败，将回退到同步创建', error)
      return []
    }
  }

  /**
   * 🔒 关闭页面池
   * @private
   */
  async _closePagePool(pagePool) {
    if (!pagePool || !Array.isArray(pagePool) || pagePool.length === 0) return
    
    this.logger.debug(`🔒 关闭页面池：${pagePool.length} 个页面`)
    
    const closePromises = pagePool.map(async (page, index) => {
      try {
        if (page && !page.isClosed()) {
          await page.close()
        }
      } catch (error) {
        this.logger.debug(`关闭页面 ${index + 1} 时出错:`, error.message)
      }
    })
    
    await Promise.allSettled(closePromises)
    await new Promise(resolve => setTimeout(resolve, 200)) // 简化的优雅关闭等待
    this.logger.debug('✅ 页面池已完全关闭')
  }

  /**
   * 🔒 关闭批次页面
   * @private
   */
  async _closeBatchPages(batchPagePool) {
    if (!batchPagePool || batchPagePool.length === 0) return
    
    this.logger.debug(`🔒 释放批次页面：${batchPagePool.length} 个`)
    
    const closePromises = batchPagePool.map(page => {
      if (page && !page.isClosed()) {
        return page.close().catch(e => this.logger.debug('关闭批次页面时出错:', e.message))
      }
      return Promise.resolve()
    })
    
    await Promise.allSettled(closePromises)
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  // 🔄 向下兼容的API
  getFailedImages() {
    return this.downloadExecutor.getFailedImages()
  }

  clearFailedImages() {
    this.downloadExecutor.clearFailedImages()
  }
}