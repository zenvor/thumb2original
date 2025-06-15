import cliProgress from 'cli-progress'
import { ConsolaLogger as Logger } from '../../logger/ConsolaLogger.js'

/**
 * 简化的下载进度管理器
 * 遵循KISS原则，统一管理下载状态和进度显示
 * 合并了原ProgressBarManager和DownloadStateManager的核心功能
 */
export class DownloadProgress {
  constructor(options = {}) {
    const {
      logger = null,
      enableProgressBar = true
    } = options

    this.logger = logger || Logger.getGlobal()
    this.enableProgressBar = enableProgressBar
    
    // 🧮 状态统计
    this.totalImagesCount = 0
    this.downloadSuccessCount = 0
    this.downloadFailedCount = 0
    this.webpConversionsCount = 0
    this.retriesCount = 0
    
    // ⏱️ 时间跟踪
    this.startTime = null
    this.lastUpdateTime = null
    
    // 📊 进度条
    this.progressBar = null
    
    // 进度条配置
    this.progressConfig = {
      format: [
        '\x1b[36m🖼️ 图片下载进度\x1b[0m',
        '|\x1b[32m{bar}\x1b[0m|',
        '\x1b[33m{percentage}%\x1b[0m',
        '|\x1b[35m{value}/{total}\x1b[0m',
        '|\x1b[36m速率: {speed}\x1b[0m'
      ].join(' '),
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: false,
      barsize: 40,
      fps: 30,
      synchronousUpdate: true,
      noTTYOutput: false,
      etaAsynchronousUpdate: false
    }
  }

  /**
   * 初始化进度跟踪
   * @param {number} total 图片总数
   */
  init(total) {
    this.totalImagesCount = total
    this.startTime = Date.now()
    this.lastUpdateTime = this.startTime

    if (this.enableProgressBar) {
      this.progressBar = new cliProgress.SingleBar(
        this.progressConfig, 
        cliProgress.Presets.shades_classic
      )
      
      this.progressBar.start(total, 0, {
        speed: '0 张/秒'
      })
    }

    this.logger.debug(`📊 下载进度初始化: 总数 ${total}`)
  }

  /**
   * 增加成功下载计数
   */
  incrementSuccess() {
    this.downloadSuccessCount++
    this._updateProgress()
  }

  /**
   * 增加失败下载计数
   */
  incrementFailed() {
    this.downloadFailedCount++
    this._updateProgress()
  }

  /**
   * 增加WebP转换计数
   */
  incrementWebpConversions() {
    this.webpConversionsCount++
  }

  /**
   * 增加重试计数
   */
  incrementRetries() {
    this.retriesCount++
  }

  /**
   * 更新进度显示
   * @private
   */
  _updateProgress() {
    if (!this.enableProgressBar || !this.progressBar) return

    const processed = this.downloadSuccessCount + this.downloadFailedCount
    const now = Date.now()
    const elapsed = (now - this.startTime) / 1000
    
    // 计算速率
    const avgSpeed = processed > 0 ? (processed / elapsed).toFixed(1) : '0'

    this.progressBar.update(processed, {
      speed: `${avgSpeed} 张/秒`
    })

    this.lastUpdateTime = now
  }

  /**
   * 完成下载，显示最终统计
   */
  finish() {
    if (this.enableProgressBar && this.progressBar) {
      const processed = this.downloadSuccessCount + this.downloadFailedCount
      const elapsed = this.startTime ? (Date.now() - this.startTime) / 1000 : 0
      const avgSpeed = processed > 0 ? (processed / elapsed).toFixed(1) : '0'
      
      // 更新到最终状态
      this.progressBar.update(processed, {
        speed: `${avgSpeed} 张/秒`
      })
      
      // 手动停止进度条，但不清除显示
      this.progressBar.stop()
    }

    const stats = this.getStats()
    const finalMessage = [
      `📊 下载完成统计`,
      `总数: ${stats.total}`,
      `✅ 成功: ${stats.success}`,
      `❌ 失败: ${stats.failed}`,
      `🔄 WebP转换: ${stats.webpConversions}`,
      `🔁 重试: ${stats.retries}`,
      `📈 成功率: ${stats.successRate}%`,
      `⏱️ 总用时: ${stats.duration}`,
      `⚡ 平均速率: ${stats.avgSpeed} 张/秒`
    ].join(' | ')

    this.logger.info(finalMessage)
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    const elapsed = this.startTime ? (Date.now() - this.startTime) / 1000 : 0
    const processed = this.downloadSuccessCount + this.downloadFailedCount
    
    return {
      total: this.totalImagesCount,
      success: this.downloadSuccessCount,
      failed: this.downloadFailedCount,
      webpConversions: this.webpConversionsCount,
      retries: this.retriesCount,
      successRate: this.totalImagesCount > 0 ? 
        ((this.downloadSuccessCount / this.totalImagesCount) * 100).toFixed(1) : '0',
      duration: this._formatTime(elapsed),
      avgSpeed: processed > 0 ? (processed / elapsed).toFixed(1) : '0'
    }
  }

  /**
   * 检查是否完成
   * @returns {boolean} 是否完成
   */
  isFinished() {
    return this.downloadSuccessCount + this.downloadFailedCount >= this.totalImagesCount
  }

  /**
   * 格式化时间显示
   * @param {number} seconds 秒数
   * @returns {string} 格式化的时间字符串
   * @private
   */
  _formatTime(seconds) {
    if (!seconds || seconds === Infinity || isNaN(seconds)) return '00:00'
    
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60)
    
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  /**
   * 重置所有状态
   */
  reset() {
    this.totalImagesCount = 0
    this.downloadSuccessCount = 0
    this.downloadFailedCount = 0
    this.webpConversionsCount = 0
    this.retriesCount = 0
    this.startTime = null
    this.lastUpdateTime = null
    
    if (this.progressBar) {
      this.progressBar.stop()
      this.progressBar = null
    }
  }

  // 📍 向后兼容的API别名
  incrementDownloadSuccess() { this.incrementSuccess() }
  incrementDownloadFailed() { this.incrementFailed() }
  incrementRequestSuccess() { 
    // 请求成功通常意味着能够访问URL，但不一定下载成功
    // 这里我们可以简单地记录或者什么都不做，因为实际的成功会通过incrementDownloadSuccess记录
    this.logger.debug('📡 HTTP请求成功 - URL可访问')
  }
  incrementRequestFailed() { 
    // 请求失败，记录为下载失败
    this.incrementFailed() 
  }
  setImageCount(count) { this.init(count) }
  getProgress() {
    return this.totalImagesCount > 0 ? 
      Math.round(((this.downloadSuccessCount + this.downloadFailedCount) / this.totalImagesCount) * 100) : 0
  }
} 