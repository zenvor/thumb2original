import { consola, createConsola } from 'consola'

/**
 * 基于 Consola 的现代日志器
 * 保持与轻量级 Logger 完全兼容的 API，同时享受 consola 的美观输出
 * 专为爬虫等需要清晰调试输出和美观界面的场景设计
 */
export class ConsolaLogger {
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

    // 日志级别权重（保持兼容）
    this.levels = {
      debug: 10,
      info: 20,
      warn: 30,
      error: 40,
      success: 20, // 等同于info级别
    }

    // 设置当前日志级别
    this.currentLevel = this.levels[level] || this.levels.info

    // 创建 consola 实例
    this.consola = prefix ? consola.withTag(prefix) : consola
    
    // 设置 consola 的日志级别
    this._updateConsolaLevel()
  }

  /**
   * 更新 consola 的日志级别
   * @private
   */
  _updateConsolaLevel() {
    // 将我们的级别映射到 consola 的级别
    const levelMap = {
      10: 4, // debug
      20: 3, // info 
      30: 2, // warn
      40: 1, // error
    }
    this.consola.level = levelMap[this.currentLevel] || 3
  }

  /**
   * 检查是否应该输出日志
   * @param {string} level 日志级别
   * @returns {boolean} 是否应该输出
   */
  _shouldLog(level) {
    const levelWeight = this.levels[level] || 0
    return levelWeight >= this.currentLevel
  }

  /**
   * 输出调试信息
   */
  debug(message, data) {
    if (!this._shouldLog('debug')) return
    
    if (data !== undefined && data !== '') {
      this.consola.debug(message, data)
    } else {
      this.consola.debug(message)
    }
  }

  /**
   * 输出信息
   */
  info(message, data) {
    if (!this._shouldLog('info')) return
    
    if (data !== undefined && data !== '') {
      this.consola.info(message, data)
    } else {
      this.consola.info(message)
    }
  }

  /**
   * 输出警告
   */
  warn(message, error) {
    if (!this._shouldLog('warn')) return
    
    if (error !== undefined && error !== '') {
      this.consola.warn(message, error?.message || error)
    } else {
      this.consola.warn(message)
    }
  }

  /**
   * 输出错误
   */
  error(message, error) {
    if (!this._shouldLog('error')) return
    
    if (error !== undefined && error !== '') {
      this.consola.error(message, error)
    } else {
      this.consola.error(message)
    }
  }

  /**
   * 输出成功信息
   */
  success(message, data) {
    if (!this._shouldLog('success')) return
    
    if (data !== undefined && data !== '') {
      this.consola.success(message, data)
    } else {
      this.consola.success(message)
    }
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
   * 输出统计信息的格式化显示（爬虫专用功能）
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
   * 输出进度信息（爬虫专用功能）
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
      this._updateConsolaLevel()
    } else {
      this.warn(`无效的日志级别: ${level}`)
    }
  }

  /**
   * 设置前缀
   */
  setPrefix(prefix) {
    this.prefix = prefix
    // 重新创建带有新前缀的 consola 实例
    this.consola = prefix ? consola.withTag(prefix) : consola
    this._updateConsolaLevel()
  }

  /**
   * 创建子日志器（带前缀）
   */
  child(prefix) {
    const childPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix
    const currentLevelName = Object.keys(this.levels).find(key => this.levels[key] === this.currentLevel) || 'info'
    
    return new ConsolaLogger({
      level: currentLevelName,
      enableColors: this.enableColors,
      enableTimestamp: this.enableTimestamp,
      prefix: childPrefix,
    })
  }

  /**
   * Consola 专有功能 - 显示框
   */
  box(message) {
    this.consola.box(message)
  }

  /**
   * Consola 专有功能 - 开始状态
   */
  start(message) {
    this.consola.start(message)
  }

  /**
   * Consola 专有功能 - 准备状态
   */
  ready(message) {
    this.consola.ready(message)
  }

  /**
   * Consola 专有功能 - 失败状态
   */
  fail(message) {
    this.consola.fail(message)
  }

  /**
   * 创建全局日志器实例（项目中最常用的静态方法）
   */
  static createGlobal(options = {}) {
    if (!ConsolaLogger._globalInstance) {
      ConsolaLogger._globalInstance = new ConsolaLogger(options)
    }
    return ConsolaLogger._globalInstance
  }

  /**
   * 获取全局日志器实例
   */
  static getGlobal() {
    if (!ConsolaLogger._globalInstance) {
      ConsolaLogger._globalInstance = new ConsolaLogger()
    }
    return ConsolaLogger._globalInstance
  }
} 