import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger.js'
import { UserConfigError } from '../utils/errors.js'

// 一次性提示标记：运行期间仅提示一次 SVG/AVIF 识别不转换规则，避免日志噪音
let svgAvifNoticeLogged = false

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
  // 一次性提示：当前版本 SVG/AVIF 仅做识别与统计，不参与转换
  if (config.format.enableConversion && config.format.convertTo !== 'none' && !svgAvifNoticeLogged) {
    logger.info('提示：SVG/AVIF 当前仅用于识别与统计，不参与格式转换（sharp 不直接支持 SVG→位图；AVIF 输出未启用）。')
    svgAvifNoticeLogged = true
  }

  // 图片分析配置（P0 预留与校验）
  config.analysis = config.analysis || {}
  // 预设到具体阈值映射
  const preset = config.analysis.preset || 'balanced'
  const presetMap = {
    strict: { minBufferSize: 1024, timeoutMs: 5000, maxAnalyzableSizeInMB: 20 },
    balanced: { minBufferSize: 100, timeoutMs: 10000, maxAnalyzableSizeInMB: 50 },
    loose: { minBufferSize: 0, timeoutMs: 15000, maxAnalyzableSizeInMB: 100 }
  }
  const mapped = presetMap[preset] || presetMap.balanced
  // 应用映射值（不覆盖用户显式设置）
  config.analysis.minBufferSize = config.analysis.minBufferSize ?? mapped.minBufferSize
  config.analysis.timeoutMs = config.analysis.timeoutMs ?? mapped.timeoutMs
  config.analysis.maxAnalyzableSizeInMB = config.analysis.maxAnalyzableSizeInMB ?? mapped.maxAnalyzableSizeInMB
  // 其它默认值
  config.analysis.enableDetailLog = config.analysis.enableDetailLog ?? false
  config.analysis.logAnalyzeCost = config.analysis.logAnalyzeCost ?? false
  const lcw = config.analysis.longCostWarnMs
  config.analysis.longCostWarnMs = Number.isFinite(lcw) && lcw >= 100 ? lcw : 2000
  const sr = config.analysis.sampleRate
  config.analysis.sampleRate = Number.isFinite(sr) && sr >= 1 ? sr : 100

  // 严格校验开关（默认 false；非 boolean 值回退为 false）
  if (typeof config.analysis.strictValidation !== 'boolean') {
    config.analysis.strictValidation = false
  }

  // 可选：effectiveSampleRate（若用户显式提供则校验；否则由运行时动态计算）
  if (config.analysis.effectiveSampleRate != null) {
    const esrNum = Number(config.analysis.effectiveSampleRate)
    if (Number.isFinite(esrNum) && esrNum >= 1) {
      config.analysis.effectiveSampleRate = Math.floor(esrNum)
    } else {
      logger.warn('analysis.effectiveSampleRate 非法（应为 >=1 的数字），已忽略')
      delete config.analysis.effectiveSampleRate
    }
  }

  // P1：acceptBinaryContentTypes 默认与归一化
  // - 支持 boolean | string[]
  // - 默认 true（与白名单放宽一致，降低误拒绝）
  // - 若为数组：全部转小写；空数组等价于严格仅 image/*
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

  // P2 twoPhase 相关默认与校验
  const mode = config.analysis.mode || 'inline'
  config.analysis.mode = (mode === 'twoPhase' || mode === 'inline') ? mode : 'inline'
  if (!config.analysis.tempDir) config.analysis.tempDir = './.tmp_analysis'
  if (typeof config.analysis.cleanupTempOnComplete !== 'boolean') config.analysis.cleanupTempOnComplete = true
  // 冷启动清理开关（默认开启）
  if (typeof config.analysis.cleanupTempOnStart !== 'boolean') config.analysis.cleanupTempOnStart = true
  // 内存持有缓冲数量（默认 0：不持有，立即落盘）
  const mhb = Number(config.analysis.maxHoldBuffers)
  config.analysis.maxHoldBuffers = Number.isFinite(mhb) && mhb >= 0 ? Math.floor(mhb) : 0

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


