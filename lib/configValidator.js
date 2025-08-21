import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger.js'
import { UserConfigError } from '../utils/errors.js'

// 一次性提示标记：运行期间仅提示一次 SVG/AVIF 识别不转换规则，避免日志噪音
let svgAvifNoticeLogged = false

/**
 * 校验输出目录可写性，不可写则回退到 ./download
 */
async function validateOutputDirectory(config) {
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
}

/**
 * 设置稳定性配置默认值
 */
function setStabilityDefaults(config) {
  config.stability = config.stability || {}
  config.stability.pageTimeout = config.stability.pageTimeout ?? 60000
  config.stability.navigationTimeout = config.stability.navigationTimeout ?? 60000
  config.stability.maxPageRetries = config.stability.maxPageRetries ?? 3
  config.stability.retryDelay = config.stability.retryDelay ?? 2000
  config.stability.enableErrorRecovery = config.stability.enableErrorRecovery ?? true
  config.stability.connectionCheckInterval = config.stability.connectionCheckInterval ?? 30000
}

/**
 * 设置反检测配置默认值
 */
function setAntiDetectionDefaults(config) {
  config.antiDetection = config.antiDetection || {}
  config.antiDetection.enableStealth = config.antiDetection.enableStealth ?? true
  config.antiDetection.enableAdvancedArgs = config.antiDetection.enableAdvancedArgs ?? true
  config.antiDetection.windowSize = config.antiDetection.windowSize || '1366,768'
}

/**
 * 设置下载控制默认值（统一单位：毫秒）
 */
function setDownloadDefaults(config) {
  config.concurrentDownloads = config.concurrentDownloads ?? 10
  config.minRequestDelayMs = config.minRequestDelayMs ?? 2000
  config.maxRequestDelayMs = config.maxRequestDelayMs ?? 4000
  config.maxRetries = config.maxRetries ?? 5
}

/**
 * 校验并兼容旧的 retryDelaySeconds 配置
 */
function validateRetryDelayConfig(config) {
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
}

/**
 * 校验抓取模式配置
 */
function validateScrapeMode(config) {
  config.scrapeMode = config.scrapeMode || 'local_html'
  config.imageMode = config.imageMode || 'originals_only'

  if (config.scrapeMode === 'single_page' && !config.targetUrl) {
    throw new UserConfigError('single_page 模式需要提供 targetUrl')
  }
  if (config.scrapeMode === 'multiple_pages' && (!Array.isArray(config.targetUrls) || config.targetUrls.length === 0)) {
    throw new UserConfigError('multiple_pages 模式需要提供非空的 targetUrls')
  }
}

/**
 * 设置图片格式处理配置默认值
 */
function setFormatDefaults(config) {
  config.format = config.format || {}
  config.format.enableConversion = config.format.enableConversion ?? true
  
  const allowedConvertTo = new Set(['jpeg', 'png', 'webp', 'tiff', 'none'])
  if (config.format.convertTo == null) {
    config.format.convertTo = 'png'
  } else if (!allowedConvertTo.has(String(config.format.convertTo))) {
    logger.warn(`format.convertTo 非法值: ${config.format.convertTo}，已回退为 'none'`)
    config.format.convertTo = 'none'
  }
  
  // 一次性提示：SVG/AVIF 仅识别不转换
  if (config.format.enableConversion && config.format.convertTo !== 'none' && !svgAvifNoticeLogged) {
    logger.info('提示：SVG/AVIF 当前仅用于识别与统计，不参与格式转换（sharp 不直接支持 SVG→位图；AVIF 输出未启用）。')
    svgAvifNoticeLogged = true
  }
}

/**
 * 设置图片分析配置默认值和校验
 */
function setAnalysisDefaults(config) {
  config.analysis = config.analysis || {}
  
  // 预设映射
  const preset = config.analysis.preset || 'balanced'
  const presetMap = {
    strict: { minBufferSize: 1024, timeoutMs: 5000, maxAnalyzableSizeInMB: 20 },
    balanced: { minBufferSize: 100, timeoutMs: 10000, maxAnalyzableSizeInMB: 50 },
    loose: { minBufferSize: 0, timeoutMs: 15000, maxAnalyzableSizeInMB: 100 }
  }
  const mapped = presetMap[preset] || presetMap.balanced
  
  // 应用预设默认值
  config.analysis.minBufferSize = config.analysis.minBufferSize ?? mapped.minBufferSize
  config.analysis.timeoutMs = config.analysis.timeoutMs ?? mapped.timeoutMs
  config.analysis.maxAnalyzableSizeInMB = config.analysis.maxAnalyzableSizeInMB ?? mapped.maxAnalyzableSizeInMB
  
  // 其他默认值
  config.analysis.enableDetailLog = config.analysis.enableDetailLog ?? false
  config.analysis.logAnalyzeCost = config.analysis.logAnalyzeCost ?? false
  
  const lcw = config.analysis.longCostWarnMs
  config.analysis.longCostWarnMs = Number.isFinite(lcw) && lcw >= 100 ? lcw : 2000
  const sr = config.analysis.sampleRate
  config.analysis.sampleRate = Number.isFinite(sr) && sr >= 1 ? sr : 100

  // 严格校验开关
  if (typeof config.analysis.strictValidation !== 'boolean') {
    config.analysis.strictValidation = false
  }
}

/**
 * 校验和设置分析配置的高级选项
 */
function setAnalysisAdvancedConfig(config) {
  // 可选：effectiveSampleRate 校验
  if (config.analysis.effectiveSampleRate != null) {
    const esrNum = Number(config.analysis.effectiveSampleRate)
    if (Number.isFinite(esrNum) && esrNum >= 1) {
      config.analysis.effectiveSampleRate = Math.floor(esrNum)
    } else {
      logger.warn('analysis.effectiveSampleRate 非法（应为 >=1 的数字），已忽略')
      delete config.analysis.effectiveSampleRate
    }
  }

  // acceptBinaryContentTypes 处理
  if (config.analysis.acceptBinaryContentTypes == null) {
    config.analysis.acceptBinaryContentTypes = true
  } else if (Array.isArray(config.analysis.acceptBinaryContentTypes)) {
    config.analysis.acceptBinaryContentTypes = config.analysis.acceptBinaryContentTypes
      .map((v) => String(v).toLowerCase())
  } else if (typeof config.analysis.acceptBinaryContentTypes !== 'boolean') {
    logger.warn(`analysis.acceptBinaryContentTypes 类型非法（期望 boolean 或 string[]），已回退为 true`)
    config.analysis.acceptBinaryContentTypes = true
  }

  // 边界校验
  if (!(config.analysis.minBufferSize >= 0)) config.analysis.minBufferSize = 0
  if (!(config.analysis.timeoutMs >= 1000)) config.analysis.timeoutMs = 1000
  if (!(config.analysis.maxAnalyzableSizeInMB >= 1)) config.analysis.maxAnalyzableSizeInMB = 1

  // twoPhase 相关配置
  const mode = config.analysis.mode || 'inline'
  const allowedModes = new Set(['twoPhase', 'twoPhaseApi', 'inline'])
  config.analysis.mode = allowedModes.has(mode) ? mode : 'inline'
  if (!config.analysis.tempDir) config.analysis.tempDir = './.tmp_analysis'
  if (typeof config.analysis.cleanupTempOnComplete !== 'boolean') config.analysis.cleanupTempOnComplete = true
  if (typeof config.analysis.cleanupTempOnStart !== 'boolean') config.analysis.cleanupTempOnStart = true
  
  const mhb = Number(config.analysis.maxHoldBuffers)
  config.analysis.maxHoldBuffers = Number.isFinite(mhb) && mhb >= 0 ? Math.floor(mhb) : 0
}

/**
 * 校验本地HTML目录（早失败，便于用户定位）
 */
async function validateLocalHtmlDirectory(config) {
  if (config.scrapeMode !== 'local_html') return
  
  const htmlDir = path.resolve(config.htmlDirectory || './html')
  try {
    const st = await fs.stat(htmlDir)
    if (!st.isDirectory()) throw new Error('不是目录')
    await fs.access(htmlDir)
  } catch (e) {
    throw new UserConfigError(`本地HTML目录不可用: ${htmlDir} - ${e.message}`)
  }
}

/**
 * @description 校验与规范化运行配置（填充默认值、校验路径、处理冲突）。
 * @param {object} rawConfig 原始配置
 * @returns {Promise<object>} 规范化后的配置
 */
export async function validateAndNormalizeConfig(rawConfig) {
  const config = { ...rawConfig }

  // 按模块依次处理配置
  await validateOutputDirectory(config)
  setStabilityDefaults(config)
  setAntiDetectionDefaults(config)
  setDownloadDefaults(config)
  validateRetryDelayConfig(config)
  validateScrapeMode(config)
  setFormatDefaults(config)
  setAnalysisDefaults(config)
  setAnalysisAdvancedConfig(config)
  await validateLocalHtmlDirectory(config)

  return config
}


