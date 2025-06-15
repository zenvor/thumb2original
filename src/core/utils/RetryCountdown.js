/**
 * 重试倒计时工具类
 * 提供优雅的倒计时显示，避免日志刷屏
 */
export class RetryCountdown {
  constructor() {
    this.currentTimer = null
  }

  /**
   * 开始倒计时
   * @param {number} seconds 倒计时秒数
   * @param {Function} onComplete 倒计时完成时的回调函数
   * @param {Object} options 配置选项
   * @param {string} options.prefix - 倒计时前缀文字，默认为"⏳ 重试倒计时"
   * @param {string} options.color - 倒计时文字颜色，默认为黄色(\x1b[33m)
   * @returns {Promise<void>}
   */
  start(seconds, onComplete, options = {}) {
    return new Promise((resolve) => {
      const { prefix = '⏳ 重试倒计时', color = '\x1b[33m' } = options
      
      // 清除之前的计时器
      this.clear()
      
      let countdown = seconds

      // 立即显示初始倒计时
      process.stdout.write(`\r${color}${prefix}: ${countdown}s\x1b[0m`)

      this.currentTimer = setInterval(async () => {
        countdown--
        
        if (countdown <= 0) {
          // 倒计时结束
          this.clear()
          
          try {
            if (onComplete) {
              await onComplete()
            }
                } catch (error) {
        // 倒计时完成回调出错 (这里无法访问logger实例)
        process.stderr.write(`\n倒计时完成回调出错: ${error.message}\n`)
      }
          
          resolve()
        } else {
          // 更新倒计时显示
          process.stdout.write(`\r${color}${prefix}: ${countdown}s\x1b[0m`)
        }
      }, 1000)
    })
  }

  /**
   * 清除当前倒计时
   * 清除计时器并清理控制台输出行
   */
  clear() {
    if (this.currentTimer) {
      clearInterval(this.currentTimer)
      this.currentTimer = null
    }
    
    // 清除当前行
    process.stdout.write('\r\x1b[K')
  }

  /**
   * 获取当前是否有活跃的倒计时
   * @returns {boolean}
   */
  isActive() {
    return this.currentTimer !== null
  }

  /**
   * 静态方法：快速创建一次性倒计时
   * @param {number} seconds 倒计时秒数
   * @param {Function} onComplete 完成回调
   * @param {Object} options 配置选项
   * @returns {Promise<void>}
   */
  static async countdown(seconds, onComplete, options = {}) {
    const countdown = new RetryCountdown()
    return countdown.start(seconds, onComplete, options)
  }
} 