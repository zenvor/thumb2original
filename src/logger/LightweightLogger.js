/**
 * 轻量级自定义日志器
 * 基于原生 console，确保同步输出，避免日志乱序问题
 * 专为爬虫等需要清晰调试输出的场景设计
 */
export class LightweightLogger {
  constructor(options = {}) {
    const {
      level = 'info',
      enableColors = true,
      enableTimestamp = true,
      prefix = ''
    } = options

    this.prefix = prefix
    this.enableColors = enableColors
    this.enableTimestamp = enableTimestamp

    // 日志级别权重
    this.levels = {
      debug: 10,
      info: 20,
      warn: 30,
      error: 40,
      success: 20, // 等同于info级别
    }

    // 设置当前日志级别
    this.currentLevel = this.levels[level] || this.levels.info

    // 颜色配置（ANSI 颜色代码）
    this.colors = {
      reset: '\x1b[0m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      cyan: '\x1b[36m',
      gray: '\x1b[90m'
    }
  }

  /**
   * 格式化并输出日志
   * @param {string} level 日志级别
   * @param {string} message 消息
   * @param {string} levelColor 级别颜色
   * @param {any} extra 附加数据
   * @param {boolean} useError 是否使用console.error
   */
  _log(level, message, levelColor, extra, useError = false) {
    // 检查级别
    const levelWeight = this.levels[level] || 0
    if (levelWeight < this.currentLevel) return

    // 构建日志消息
    const parts = []
    
    // 时间戳
    if (this.enableTimestamp) {
      const now = new Date()
      const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`
      parts.push(this.enableColors ? `\x1b[90m${timestamp}\x1b[0m` : timestamp)
    }
    
    // 日志级别
    const levelText = level.toUpperCase().padEnd(5)
    parts.push(this.enableColors ? `${this.colors[levelColor]}${levelText}\x1b[0m` : levelText)
    
    // 前缀
    if (this.prefix) {
      const prefixText = `[${this.prefix}]`
      parts.push(this.enableColors ? `\x1b[36m${prefixText}\x1b[0m` : prefixText)
    }
    
    // 消息
    parts.push(message)
    
    const formatted = parts.join(' ')
    
    // 输出主消息
    if (useError) {
      console.error(formatted)
    } else {
      console.log(formatted)
    }
    
    // 输出附加数据
    if (extra !== undefined && extra !== '') {
      const extraLabel = this.enableColors ? `${this.colors[levelColor]}    ${level === 'warn' || level === 'error' ? 'error' : 'data'}:\x1b[0m` : `    ${level === 'warn' || level === 'error' ? 'error' : 'data'}:`
      const extraValue = extra?.message || extra
      if (useError) {
        console.error(extraLabel, extraValue)
      } else {
        console.log(extraLabel, extraValue)
      }
    }
  }

  /**
   * 输出调试信息
   */
  debug(message, data) {
    this._log('debug', message, 'gray', data)
  }

  /**
   * 输出信息
   */
  info(message, data) {
    this._log('info', message, 'blue', data)
  }

  /**
   * 输出警告
   */
  warn(message, error) {
    this._log('warn', message, 'yellow', error)
  }

  /**
   * 输出错误
   */
  error(message, error) {
    this._log('error', message, 'red', error, true)
  }

  /**
   * 输出成功信息（映射到info级别）
   */
  success(message, data) {
    this._log('success', `✅ ${message}`, 'green', data)
  }

  /**
   * 输出原始消息（不加格式）
   */
  raw(message, data) {
    if (data !== undefined) {
      console.log(message, data)
    } else {
      console.log(message)
    }
  }

  /**
   * 输出表格数据
   */
  table(data) {
    console.table(data)
  }

  /**
   * 开始计时
   */
  time(label) {
    console.time(label)
  }

  /**
   * 结束计时
   */
  timeEnd(label) {
    console.timeEnd(label)
  }

  /**
   * 输出统计信息的格式化显示
   */
  stats(stats) {
    const { total, requestSuccess, requestFailed, downloadSuccess, downloadFailed, retryCount } = stats

    this.info(`共 ${total} 张`)
    this.success(`成功访问 ${requestSuccess} 张`)
    if (requestFailed > 0) {
      this.error(`失败访问 ${requestFailed} 张`)
    }
    this.success(`成功下载 ${downloadSuccess} 张`)
    if (downloadFailed > 0) {
      this.error(`失败下载 ${downloadFailed} 张`)
    }
    if (retryCount > 0) {
      this.warn(`触发重试 ${retryCount} 次`)
    }
  }

  /**
   * 输出进度信息
   */
  progress(current, total, action = '处理') {
    const percentage = ((current / total) * 100).toFixed(1)
    this.info(`${action}进度: ${current}/${total} (${percentage}%)`)
  }

  /**
   * 设置日志级别
   */
  setLevel(level) {
    if (this.levels[level] !== undefined) {
      this.currentLevel = this.levels[level]
    } else {
      this.warn(`无效的日志级别: ${level}`)
    }
  }

  /**
   * 设置前缀
   */
  setPrefix(prefix) {
    this.prefix = prefix
  }

  /**
   * 创建子日志器（带前缀）
   */
  child(prefix) {
    const childPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix
    const currentLevelName = Object.keys(this.levels).find(key => this.levels[key] === this.currentLevel) || 'info'
    
    return new LightweightLogger({
      level: currentLevelName,
      enableColors: this.enableColors,
      enableTimestamp: this.enableTimestamp,
      prefix: childPrefix,
    })
  }

  /**
   * 创建全局日志器实例（项目中最常用的静态方法）
   */
  static createGlobal(options = {}) {
    if (!LightweightLogger._globalInstance) {
      LightweightLogger._globalInstance = new LightweightLogger(options)
    }
    return LightweightLogger._globalInstance
  }

  /**
   * 获取全局日志器实例
   */
  static getGlobal() {
    if (!LightweightLogger._globalInstance) {
      LightweightLogger._globalInstance = new LightweightLogger()
    }
    return LightweightLogger._globalInstance
  }
}
