/**
 * 配置管理器
 * 统一管理爬虫配置，支持默认值和环境变量覆盖
 */
export class ConfigManager {
  constructor(userConfig = {}) {
    // 默认配置
    this.defaultConfig = {
      // 解析模式 'singleSite' 单个站点 | 'multipleSites' 多个站点
      extractMode: 'singleSite',

      // 下载模式 'downloadAllImages' | 'downloadOriginImagesByThumbnails'
      downloadMode: 'downloadAllImages',

      // 目标解析网站
      url: '',

      // 多个目标解析网站
      urls: [],

      // 重试间隔(秒钟)-如果有下载失败的照片，服务会等待一段时间，然后重新下载请求失败的照片
      retryInterval: 5,

      // 重试次数
      retriesCount: 5,

      // 最大并发请求数（每一轮）
      maxConcurrentRequests: 15,

      // 最大请求间隔时间（毫秒）
      maxIntervalMs: 1000,

      // 最小请求间隔时间（毫秒）
      minIntervalMs: 100,

      // 下载的文件夹路径（不填默认根据网页标题创建文件夹，下载到download文件夹）
      downloadFolderPath: '',

      // 浏览器配置
      browser: {
        headless: true,
        timeout: 300 * 1000,
        viewport: { width: 1800, height: 1000 },
      },

      // 超时配置
      timeouts: {
        pageLoad: 500 * 1000,
        imageDownload: 60 * 1000,
      },

      // 滚动配置
      scroll: {
        maxDistance: 30000,
        stepSize: 1000,
        stopTimeout: 3000,
      },

      // 日志级别控制 'debug' | 'info' | 'warn' | 'error'
      logLevel: 'info',

      // 进度条配置
      enableProgressBar: true, // 是否启用高颜值进度条
      progressUpdateFrequency: 'realtime', // 进度条更新频率 'realtime' | 'fast' | 'normal' | 'slow'

      // 页面池管理策略 'auto' | 'reuse' | 'progressive'
      pagePoolStrategy: 'auto', // auto: 根据图片数量自动选择, reuse: 复用式, progressive: 渐进式
    }

    // 合并配置
    this.config = this._mergeConfigs(this.defaultConfig, userConfig)

    // 验证配置
    this._validateConfig()
  }

  /**
   * 获取Logger实例（延迟加载避免循环依赖）
   * @returns {Logger|null} Logger实例或null
   * @private
   */
  _getLogger() {
    try {
      const { ConsolaLogger } = require('../logger/ConsolaLogger.js')
      return ConsolaLogger.getGlobal()
    } catch (error) {
      // 如果Logger不可用，返回null
      return null
    }
  }

  /**
   * 合并配置，用户配置覆盖默认配置
   * @param {Object} defaultConfig 默认配置
   * @param {Object} userConfig 用户配置
   * @returns {Object} 合并后的配置
   */
  _mergeConfigs(defaultConfig, userConfig) {
    const merged = { ...defaultConfig }

    // 深度合并嵌套对象
    for (const key in userConfig) {
      if (userConfig[key] !== null && typeof userConfig[key] === 'object' && !Array.isArray(userConfig[key])) {
        merged[key] = { ...defaultConfig[key], ...userConfig[key] }
      } else {
        merged[key] = userConfig[key]
      }
    }

    return merged
  }

  /**
   * 从环境变量加载配置
   * @returns {Object} 环境变量配置
   */
  _loadFromEnv() {
    const envConfig = {}

    // 支持的环境变量映射
    const envMapping = {
      CRAWLER_EXTRACT_MODE: 'extractMode',
      CRAWLER_DOWNLOAD_MODE: 'downloadMode',
      CRAWLER_URL: 'url',
      CRAWLER_RETRY_INTERVAL: 'retryInterval',
      CRAWLER_RETRIES_COUNT: 'retriesCount',
      CRAWLER_MAX_CONCURRENT: 'maxConcurrentRequests',
      CRAWLER_MAX_INTERVAL: 'maxIntervalMs',
      CRAWLER_MIN_INTERVAL: 'minIntervalMs',
      CRAWLER_DOWNLOAD_PATH: 'downloadFolderPath',
    }

    for (const [envKey, configKey] of Object.entries(envMapping)) {
      if (process.env[envKey]) {
        const value = process.env[envKey]

        // 类型转换
        if (
          ['retryInterval', 'retriesCount', 'maxConcurrentRequests', 'maxIntervalMs', 'minIntervalMs'].includes(
            configKey
          )
        ) {
          envConfig[configKey] = parseInt(value, 10)
        } else if (configKey === 'urls') {
          envConfig[configKey] = value.split(',').map((url) => url.trim())
        } else {
          envConfig[configKey] = value
        }
      }
    }

    return envConfig
  }

  /**
   * 验证配置的有效性
   * @throws {Error} 配置无效时抛出错误
   */
  _validateConfig() {
    const config = this.config

    // 验证extractMode
    if (!['singleSite', 'multipleSites'].includes(config.extractMode)) {
      throw new Error(`无效的提取模式: ${config.extractMode}`)
    }

    // 验证downloadMode
    if (!['downloadAllImages', 'downloadOriginImagesByThumbnails'].includes(config.downloadMode)) {
      throw new Error(`无效的下载模式: ${config.downloadMode}`)
    }

    // 验证URL配置
    if (config.extractMode === 'singleSite' && !config.url) {
      throw new Error('单站点模式下必须提供URL')
    }

    if (
      config.extractMode === 'multipleSites' &&
      (!config.urls || !Array.isArray(config.urls) || config.urls.length === 0)
    ) {
      throw new Error('多站点模式下必须提供URLs数组')
    }

    // 验证数值配置
    const numericFields = ['retryInterval', 'retriesCount', 'maxConcurrentRequests', 'maxIntervalMs', 'minIntervalMs']

    for (const field of numericFields) {
      if (typeof config[field] !== 'number' || config[field] < 0) {
        throw new Error(`${field} 必须是非负数`)
      }
    }

    // 验证间隔时间关系
    if (config.minIntervalMs > config.maxIntervalMs) {
      throw new Error('最小间隔时间不能大于最大间隔时间')
    }

    // 验证并发数
    if (config.maxConcurrentRequests > 100) {
      const logger = this._getLogger()
      if (logger) {
        logger.warn('过高的并发数可能导致网站反爬虫限制')
      } else {
        console.warn('⚠️ 警告：过高的并发数可能导致网站反爬虫限制')
      }
    }
  }

  /**
   * 获取配置项
   * @param {string} key 配置键，支持点号分隔的嵌套键
   * @returns {any} 配置值
   */
  get(key) {
    const keys = key.split('.')
    let value = this.config

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k]
      } else {
        return undefined
      }
    }

    return value
  }

  /**
   * 设置配置项
   * @param {string} key 配置键
   * @param {any} value 配置值
   */
  set(key, value) {
    const keys = key.split('.')
    let current = this.config

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i]
      if (!(k in current) || typeof current[k] !== 'object') {
        current[k] = {}
      }
      current = current[k]
    }

    current[keys[keys.length - 1]] = value

    // 重新验证配置
    this._validateConfig()
  }

  /**
   * 获取所有配置
   * @returns {Object} 完整配置对象
   */
  getAll() {
    return { ...this.config }
  }

  /**
   * 重置为默认配置
   */
  reset() {
    this.config = { ...this.defaultConfig }
  }

  /**
   * 打印配置信息（调试用）
   */
  debug() {
    const logger = this._getLogger()
    if (logger) {
      logger.info('📋 当前配置:')
      logger.info(`  提取模式: ${this.config.extractMode}`)
      logger.info(`  下载模式: ${this.config.downloadMode}`)
      logger.info(`  目标URL: ${this.config.url || '未设置'}`)
      logger.info(`  多站点URLs: ${this.config.urls.length > 0 ? `${this.config.urls.length}个` : '未设置'}`)
      logger.info(`  重试配置: ${this.config.retriesCount}次，间隔${this.config.retryInterval}秒`)
      logger.info(`  并发配置: ${this.config.maxConcurrentRequests}个并发`)
      logger.info(`  间隔配置: ${this.config.minIntervalMs}-${this.config.maxIntervalMs}ms`)
      logger.info(`  下载路径: ${this.config.downloadFolderPath || '自动生成'}`)
    } else {
      console.log('📋 当前配置:')
      console.log('  提取模式:', this.config.extractMode)
      console.log('  下载模式:', this.config.downloadMode)
      console.log('  目标URL:', this.config.url || '未设置')
      console.log('  多站点URLs:', this.config.urls.length > 0 ? `${this.config.urls.length}个` : '未设置')
      console.log('  重试配置:', `${this.config.retriesCount}次，间隔${this.config.retryInterval}秒`)
      console.log('  并发配置:', `${this.config.maxConcurrentRequests}个并发`)
      console.log('  间隔配置:', `${this.config.minIntervalMs}-${this.config.maxIntervalMs}ms`)
      console.log('  下载路径:', this.config.downloadFolderPath || '自动生成')
    }
  }

  /**
   * 导出配置到环境变量格式
   * @returns {Object} 环境变量格式的配置
   */
  toEnvFormat() {
    const envConfig = {}
    envConfig.CRAWLER_EXTRACT_MODE = this.config.extractMode
    envConfig.CRAWLER_DOWNLOAD_MODE = this.config.downloadMode
    envConfig.CRAWLER_URL = this.config.url
    envConfig.CRAWLER_RETRY_INTERVAL = this.config.retryInterval.toString()
    envConfig.CRAWLER_RETRIES_COUNT = this.config.retriesCount.toString()
    envConfig.CRAWLER_MAX_CONCURRENT = this.config.maxConcurrentRequests.toString()
    envConfig.CRAWLER_MAX_INTERVAL = this.config.maxIntervalMs.toString()
    envConfig.CRAWLER_MIN_INTERVAL = this.config.minIntervalMs.toString()
    envConfig.CRAWLER_DOWNLOAD_PATH = this.config.downloadFolderPath

    return envConfig
  }

  /**
   * 从配置文件加载配置
   * @param {string} configPath 配置文件路径
   * @returns {Promise<ConfigManager>} 配置管理器实例
   */
  static async fromFile(configPath) {
    try {
      // 处理相对路径，从项目根目录开始计算
      const resolvedPath = configPath.startsWith('./') || configPath.startsWith('../') 
        ? new URL(configPath, import.meta.url.replace('/src/core/ConfigManager.js', '/')).href
        : configPath
      
      const { config } = await import(resolvedPath)
      return new ConfigManager(config)
    } catch (error) {
      throw new Error(`无法加载配置文件 ${configPath}: ${error.message}`)
    }
  }

  /**
   * 创建默认配置管理器
   * @returns {ConfigManager} 默认配置管理器实例
   */
  static createDefault() {
    return new ConfigManager()
  }
}
