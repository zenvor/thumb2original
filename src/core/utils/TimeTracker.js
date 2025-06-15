/**
 * 时间跟踪器
 * 统一管理时间跟踪、格式化和速率计算逻辑
 * 用于消除DownloadStateManager和ProgressBarManager中的重复代码
 */
export class TimeTracker {
  constructor() {
    this.startTime = null
    this.lastUpdateTime = null
    this.speedSamples = []
    this.maxSpeedSamples = 10 // 保留最近10次的速率样本
  }

  /**
   * 开始计时
   */
  start() {
    this.startTime = Date.now()
    this.lastUpdateTime = this.startTime
    this.speedSamples = []
  }

  /**
   * 重置时间跟踪器
   */
  reset() {
    this.startTime = null
    this.lastUpdateTime = null
    this.speedSamples = []
  }

  /**
   * 获取总持续时间（秒）
   * @returns {number} 持续时间（秒）
   */
  getDuration() {
    return this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0
  }

  /**
   * 获取开始时间
   * @returns {number|null} 开始时间戳
   */
  getStartTime() {
    return this.startTime
  }

  /**
   * 更新最后更新时间
   */
  updateLastTime() {
    this.lastUpdateTime = Date.now()
  }

  /**
   * 统一的时间格式化方法
   * @param {number} seconds 秒数
   * @returns {string} 格式化的时间字符串
   */
  formatTime(seconds) {
    if (seconds === 0) return '00:00'
    if (seconds > 3600) {
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      const secs = seconds % 60
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    } else {
      const minutes = Math.floor(seconds / 60)
      const secs = seconds % 60
      return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
  }

  /**
   * 计算平均速率
   * @param {number} current 当前完成数量
   * @param {number} duration 持续时间（可选，默认使用getDuration()）
   * @returns {string} 格式化的速率字符串
   */
  calculateSpeed(current, duration = null) {
    const actualDuration = duration !== null ? duration : this.getDuration()
    return actualDuration > 0 ? (current / actualDuration).toFixed(1) : '0'
  }

  /**
   * 计算瞬时速率（基于样本）
   * @param {number} increment 增量值
   * @param {number} now 当前时间戳（可选，默认使用当前时间）
   * @returns {number} 瞬时速率
   */
  calculateInstantSpeed(increment = 1, now = null) {
    const currentTime = now || Date.now()
    const timeDiff = (currentTime - this.lastUpdateTime) / 1000
    
    let instantSpeed = 0
    if (timeDiff > 0) {
      instantSpeed = increment / timeDiff
    }

    // 添加到速率样本
    if (instantSpeed > 0) {
      this.speedSamples.push(instantSpeed)
      if (this.speedSamples.length > this.maxSpeedSamples) {
        this.speedSamples.shift()
      }
    }

    return instantSpeed
  }

  /**
   * 获取平滑后的速率（基于样本均值）
   * @returns {number} 平滑速率
   */
  getSmoothedSpeed() {
    if (this.speedSamples.length === 0) return 0
    return this.speedSamples.reduce((a, b) => a + b, 0) / this.speedSamples.length
  }

  /**
   * 计算ETA（剩余时间）
   * @param {number} current 当前完成数量
   * @param {number} total 总数量
   * @param {boolean} useSmoothedSpeed 是否使用平滑速率
   * @returns {number} ETA（秒）
   */
  calculateETA(current, total, useSmoothedSpeed = true) {
    if (current >= total) return 0

    const speed = useSmoothedSpeed 
      ? this.getSmoothedSpeed() 
      : parseFloat(this.calculateSpeed(current))

    if (speed <= 0) return 0

    return Math.ceil((total - current) / speed)
  }

  /**
   * 获取完整的时间统计信息
   * @param {number} current 当前完成数量
   * @param {number} total 总数量（可选）
   * @returns {Object} 时间统计对象
   */
  getTimeStats(current, total = null) {
    const duration = this.getDuration()
    const avgSpeed = this.calculateSpeed(current, duration)
    const smoothedSpeed = this.getSmoothedSpeed()
    const eta = total ? this.calculateETA(current, total) : 0

    return {
      duration,
      avgSpeed,
      smoothedSpeed: smoothedSpeed.toFixed(1),
      eta,
      durationFormatted: this.formatTime(duration),
      etaFormatted: this.formatTime(eta),
      startTime: this.startTime,
      lastUpdateTime: this.lastUpdateTime
    }
  }

  /**
   * 检查是否已开始计时
   * @returns {boolean} 是否已开始
   */
  isStarted() {
    return this.startTime !== null
  }
} 