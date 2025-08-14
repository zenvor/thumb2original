import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger.js'
import { UserConfigError } from '../utils/errors.js'

/**
 * @description 校验与规范化运行配置（填充默认值、校验路径、处理冲突）。
 * @param {object} rawConfig 原始配置
 * @returns {Promise<object>} 规范化后的配置
 */
export async function validateAndNormalizeConfig(rawConfig) {
  const config = { ...rawConfig }

  // 输出目录可写性校验，不可写则回退到 ./download
  try {
    const outputDir = config.outputDirectory || path.join(process.cwd(), 'download')
    await fs.mkdir(outputDir, { recursive: true })
    await fs.access(outputDir)
    if (!config.outputDirectory) config.outputDirectory = outputDir
    logger.info(`输出目录可用: ${config.outputDirectory}`)
  } catch (e) {
    const fallback = path.join(process.cwd(), 'download')
    logger.warn(`输出目录不可用，将回退到: ${fallback}`)
    config.outputDirectory = fallback
    await fs.mkdir(fallback, { recursive: true })
  }

  // 默认稳定性与反检测参数（保持轻量，不引入第三方）
  config.stability = config.stability || {}
  config.stability.pageTimeout = config.stability.pageTimeout ?? 60000
  config.stability.navigationTimeout = config.stability.navigationTimeout ?? 60000
  config.stability.maxPageRetries = config.stability.maxPageRetries ?? 3
  config.stability.retryDelay = config.stability.retryDelay ?? 2000
  config.stability.enableErrorRecovery = config.stability.enableErrorRecovery ?? true
  config.stability.connectionCheckInterval = config.stability.connectionCheckInterval ?? 30000

  config.antiDetection = config.antiDetection || {}
  config.antiDetection.enableStealth = config.antiDetection.enableStealth ?? true
  config.antiDetection.enableAdvancedArgs = config.antiDetection.enableAdvancedArgs ?? true
  config.antiDetection.windowSize = config.antiDetection.windowSize || '1366,768'

  // 下载控制默认值（统一单位：毫秒）
  config.concurrentDownloads = config.concurrentDownloads ?? 10
  config.minRequestDelayMs = config.minRequestDelayMs ?? 2000
  config.maxRequestDelayMs = config.maxRequestDelayMs ?? 4000
  config.maxRetries = config.maxRetries ?? 5

  // 兼容旧字段 retryDelaySeconds（秒）→ 新字段 retryDelayMs（毫秒）
  if (config.retryDelayMs == null) {
    if (config.retryDelaySeconds != null) {
      const seconds = Number(config.retryDelaySeconds)
      if (!Number.isFinite(seconds) || seconds < 0) {
        throw new UserConfigError('retryDelaySeconds 必须是非负数', { code: 'INVALID_CONFIG_FIELD' })
      }
      config.retryDelayMs = Math.floor(seconds * 1000)
      logger.warn('配置字段 retryDelaySeconds 已弃用，请改用 retryDelayMs（毫秒）')
    } else {
      config.retryDelayMs = 5000
    }
  } else if (typeof config.retryDelayMs !== 'number' || config.retryDelayMs < 0) {
    throw new UserConfigError('retryDelayMs 必须是非负数字（毫秒）', { code: 'INVALID_CONFIG_FIELD' })
  }

  // 模式默认值
  config.scrapeMode = config.scrapeMode || 'local_html'
  config.imageMode = config.imageMode || 'originals_only'

  // 逻辑冲突检查（示例：本地HTML模式无需目标URL）
  if (config.scrapeMode === 'single_page' && !config.targetUrl) {
    throw new UserConfigError('single_page 模式需要提供 targetUrl')
  }
  if (config.scrapeMode === 'multiple_pages' && (!Array.isArray(config.targetUrls) || config.targetUrls.length === 0)) {
    throw new UserConfigError('multiple_pages 模式需要提供非空的 targetUrls')
  }

  // 图片格式处理配置（默认与校验）
  config.format = config.format || {}
  // 中文注释：全局转换开关，默认开启
  config.format.enableConversion = config.format.enableConversion ?? true
  // 中文注释：全局转换策略；允许 'jpeg'|'png'|'webp'|'tiff'|'none'
  const allowedConvertTo = new Set(['jpeg', 'png', 'webp', 'tiff', 'none'])
  if (config.format.convertTo == null) {
    config.format.convertTo = 'png'
  } else if (!allowedConvertTo.has(String(config.format.convertTo))) {
    logger.warn(`format.convertTo 非法值: ${config.format.convertTo}，已回退为 'none'`)
    config.format.convertTo = 'none'
  }

  // 本地 HTML 模式目录校验（早失败，便于用户定位）
  if (config.scrapeMode === 'local_html') {
    const htmlDir = path.resolve(config.htmlDirectory || './html')
    try {
      const st = await fs.stat(htmlDir)
      if (!st.isDirectory()) throw new Error('不是目录')
      // 额外检查读权限（在部分系统中 stat 不代表可读）
      await fs.access(htmlDir)
    } catch (e) {
      throw new UserConfigError(`本地HTML目录不可用: ${htmlDir} - ${e.message}`)
    }
  }

  return config
}


