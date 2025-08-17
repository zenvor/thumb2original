import { logger } from '../utils/logger.js'
import { identifyImageFormat, getImageMetadata, SUPPORTED_FORMATS } from '../utils/imageUtils.js'
import { shouldAcceptResponse } from '../utils/contentPolicy.js'

// 中文注释：日志抽样计数器（模块级，避免全量刷屏）
let sampleLogCounter = 0

/**
 * 中文注释：根据 analysis 配置判断是否抽样输出日志
 * - enableDetailLog=false 时不输出
 * - sampleRate = 每 N 张输出一次；当提供 effectiveSampleRate 时优先使用
 */
function shouldSampleLog(analysisCfg) {
  try {
    if (!analysisCfg || !analysisCfg.enableDetailLog) return false
    const base = Math.max(1, Number(analysisCfg.sampleRate) || 1)
    const sr = Math.max(1, Number(analysisCfg.effectiveSampleRate) || base)
    sampleLogCounter++
    return (sampleLogCounter % sr) === 0
  } catch {
    return false
  }
}

/**
 * 中文注释：带超时保护的 Promise.race 包装
 * @param {Promise<any>} task 任务 Promise
 * @param {number} timeoutMs 超时时间（毫秒）
 * @param {string} timeoutCode 超时错误代码
 */
function withTimeout(task, timeoutMs, timeoutCode = 'processing_timeout') {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return task
  let timer
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('分析阶段超时')
      err.code = timeoutCode
      reject(err)
    }, timeoutMs)
  })
  return Promise.race([Promise.resolve(task), timeoutPromise]).finally(() => clearTimeout(timer))
}

/**
 * 中文注释：判断 headers 是否为允许的内容类型（统一策略）
 * - 访问/分析阶段统一：拒绝 text/html；允许 image/* 与 attachment
 * - 放宽策略：
 *   true → 允许缺失 content-type 且允许内置二进制白名单
 *   string[] → 允许列表；若包含 '' 则允许缺失 content-type
 */
function isAllowedByHeaders(headers = {}, analysisCfg = {}) {
  try {
    // 若未经过 configValidator 归一化，这里保持向后兼容的默认：true（放宽）
    const accept = (analysisCfg && 'acceptBinaryContentTypes' in analysisCfg)
      ? analysisCfg.acceptBinaryContentTypes
      : true
    return shouldAcceptResponse(headers, accept)
  } catch {
    // headers 异常时不阻断，放行到后续嗅探
    return true
  }
}

/**
 * @typedef {Object} ImageData
 * @property {Buffer} buffer
 * @property {object} headers
 * @property {string} finalUrl
 */

/**
 * 基础数据验证：检查 buffer 是否有效
 */
function validateImageData(buffer, analysisCfg, finalUrl, tStart) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    const elapsedMs = Date.now() - tStart
    if (shouldSampleLog(analysisCfg)) {
      logger.debug(`分析失败：reason=unknown_format 耗时=${elapsedMs}ms url=${finalUrl}`)
    }
    return { isValid: false, reason: 'unknown_format', metadata: { format: 'Unknown', type: 'Unknown', size: 0, finalUrl } }
  }
  return null
}

/**
 * 将 Content-Type 主类型映射为内部格式
 */
function mapContentTypeToFormat(ctBare) {
  if (!ctBare) return 'Unknown'
  if (ctBare === 'image/jpeg' || ctBare === 'image/jpg') return SUPPORTED_FORMATS.JPEG
  if (ctBare === 'image/png') return SUPPORTED_FORMATS.PNG
  if (ctBare === 'image/gif') return SUPPORTED_FORMATS.GIF
  if (ctBare === 'image/webp') return SUPPORTED_FORMATS.WEBP
  if (ctBare === 'image/avif') return SUPPORTED_FORMATS.AVIF
  if (ctBare === 'image/bmp') return SUPPORTED_FORMATS.BMP
  if (ctBare === 'image/tiff') return SUPPORTED_FORMATS.TIFF
  if (ctBare === 'image/svg+xml') return SUPPORTED_FORMATS.SVG
  if (ctBare === 'image/x-icon' || ctBare === 'image/vnd.microsoft.icon') return SUPPORTED_FORMATS.ICO
  return 'Unknown'
}

/**
 * 内容类型检查：验证 headers 和 SVG 例外处理
 */
function checkContentType(headers, buffer, analysisCfg, finalUrl, tStart) {
  const ctLower = (headers['content-type'] || headers['Content-Type'] || '').toString().toLowerCase()
  const ctBare = ctLower.split(';')[0].trim()
  let format = mapContentTypeToFormat(ctBare)
  let headerAllowed = isAllowedByHeaders(headers, analysisCfg)
  
  if (!headerAllowed) {
    const isXmlOrText = ctBare.includes('xml') || ctBare === 'text/plain'
    if (isXmlOrText) {
      try { format = identifyImageFormat(buffer) || 'Unknown' } catch {}
      if (format === SUPPORTED_FORMATS.SVG || format === 'svg') {
        headerAllowed = true // 例外放行：XML/TEXT 但实际为 SVG
      }
    }
    if (!headerAllowed) {
      const elapsedMs = Date.now() - tStart
      if (shouldSampleLog(analysisCfg)) {
        logger.debug(`分析失败：reason=unsupported_content_type 耗时=${elapsedMs}ms url=${finalUrl}`)
      }
      return {
        isValid: false,
        reason: 'unsupported_content_type',
        metadata: { format: format || 'Unknown', type: (format || 'Unknown'), size: buffer.length, finalUrl }
      }
    }
  }
  return { format, headerAllowed }
}

/**
 * 大小阈值检查：验证最小和最大大小限制
 */
function validateBufferSize(buffer, minBufferSize, maxAnalyzableSizeInMB, analysisCfg, finalUrl, tStart) {
  // 最小大小检查
  if (buffer.length < minBufferSize) {
    const elapsedMs = Date.now() - tStart
    if (shouldSampleLog(analysisCfg)) {
      logger.debug(`分析失败：reason=content_too_small size=${buffer.length} 耗时=${elapsedMs}ms url=${finalUrl}`)
    }
    return {
      isValid: false,
      reason: 'content_too_small',
      metadata: { format: 'Unknown', type: 'Unknown', size: buffer.length, finalUrl }
    }
  }
  
  // 最大大小检查（用于跳过元数据解析）
  const maxBytes = Math.max(1, maxAnalyzableSizeInMB) * 1024 * 1024
  const isTooLarge = buffer.length > maxBytes
  
  return { isTooLarge, maxBytes }
}

/**
 * 元数据解析：带超时和错误处理的元数据提取
 */
async function extractMetadata(buffer, format, timeoutMs, analysisCfg, finalUrl, tStart) {
  let metadata = { format, type: format, width: null, height: null, size: buffer.length, finalUrl }
  
  try {
    const start = Date.now()
    const meta = await withTimeout(getImageMetadata(buffer), timeoutMs)
    const cost = Date.now() - start
    
    if (analysisCfg.logAnalyzeCost || analysisCfg.enableDetailLog) {
      logger.debug(`分析耗时 ${cost}ms：url=${finalUrl}`)
    }
    if (analysisCfg.longCostWarnMs && cost >= analysisCfg.longCostWarnMs) {
      logger.info(`分析耗时较长 ${cost}ms：url=${finalUrl}`)
    }
    
    if (meta && typeof meta === 'object') {
      metadata = {
        format,
        type: format,
        width: meta.width ?? null,
        height: meta.height ?? null,
        size: buffer.length,
        finalUrl
      }
    }
    return { metadata }
  } catch (e) {
    return classifyAnalysisError(e, metadata, analysisCfg, finalUrl, tStart)
  }
}

/**
 * 错误分类：将分析错误分类为超时、内存或元数据错误
 */
function classifyAnalysisError(e, metadata, analysisCfg, finalUrl, tStart) {
  const msg = (e && e.message) ? e.message : String(e)
  
  // 超时错误
  if ((e && e.code) === 'processing_timeout' || /timeout/i.test(msg)) {
    const elapsedMs = Date.now() - tStart
    if (shouldSampleLog(analysisCfg)) {
      logger.debug(`分析失败：reason=processing_timeout 耗时≈${elapsedMs}ms(>=timeout) url=${finalUrl}`)
    }
    return { error: { isValid: false, reason: 'processing_timeout', metadata } }
  }
  
  // 内存错误  
  if (e instanceof RangeError || (e && e.code) === 'ERR_OUT_OF_MEMORY' || /Allocation failed|Cannot allocate memory|out of memory/i.test(msg)) {
    const elapsedMs = Date.now() - tStart
    if (shouldSampleLog(analysisCfg)) {
      logger.debug(`分析失败：reason=memory_error 耗时=${elapsedMs}ms url=${finalUrl}`)
    }
    return { error: { isValid: false, reason: 'memory_error', metadata } }
  }
  
  // 其它元数据错误
  if (analysisCfg && analysisCfg.strictValidation) {
    const elapsedMs = Date.now() - tStart
    if (shouldSampleLog(analysisCfg)) {
      logger.debug(`分析失败：reason=metadata_error 耗时=${elapsedMs}ms url=${finalUrl}`)
    }
    return { error: { isValid: false, reason: 'metadata_error', metadata } }
  }
  
  logger.warn(`元数据解析异常（继续）：${msg}`)
  metadata.parseErrorContinue = true
  return { metadata }
}

/**
 * 尺寸验证：检查图片尺寸是否有效
 */
function validateDimensions(metadata) {
  if ((metadata.width === 0 || metadata.height === 0)) {
    return { isValid: false, reason: 'invalid_dimensions', metadata }
  }
  return null
}

/**
 * 中文注释：图片分析（P0 精简版）
 * @param {ImageData} imageData fetchImage 返回的对象
 * @param {string} url 原始 URL
 * @param {object} config 运行配置（用于 analysis 配置）
 * @returns {Promise<{isValid: boolean, reason?: string, metadata: { format: string, type: string, width?: number|null, height?: number|null, size: number, finalUrl: string, skipped?: string }}>} 
 */
export async function analyzeImage(imageData, url, config = {}) {
  const tStart = Date.now()
  const buffer = imageData?.buffer
  const headers = imageData?.headers || {}
  const finalUrl = imageData?.finalUrl || url

  const analysisCfg = config?.analysis || {}
  const timeoutMs = Number.isFinite(analysisCfg.timeoutMs) ? analysisCfg.timeoutMs : 10000
  const minBufferSize = Number.isFinite(analysisCfg.minBufferSize) ? analysisCfg.minBufferSize : 100
  const maxAnalyzableSizeInMB = Number.isFinite(analysisCfg.maxAnalyzableSizeInMB) ? analysisCfg.maxAnalyzableSizeInMB : 50

  // 1) 基础数据验证
  const dataValidation = validateImageData(buffer, analysisCfg, finalUrl, tStart)
  if (dataValidation) return dataValidation

  // 2) 内容类型检查
  const contentTypeCheck = checkContentType(headers, buffer, analysisCfg, finalUrl, tStart)
  if (contentTypeCheck.isValid === false) return contentTypeCheck
  
  let { format } = contentTypeCheck

  // 3) 大小阈值检查
  const sizeValidation = validateBufferSize(buffer, minBufferSize, maxAnalyzableSizeInMB, analysisCfg, finalUrl, tStart)
  if (sizeValidation.isValid === false) return sizeValidation
  
  const { isTooLarge } = sizeValidation

  // 4) 格式嗅探（轻量）
  if (!format || format === 'Unknown') {
    try {
      format = identifyImageFormat(buffer) || 'Unknown'
    } catch (e) {
      logger.warn(`格式嗅探失败（将标记为 Unknown）：${e.message}`)
    }
  }

  // 5) 超大文件策略：跳过元数据解析
  if (isTooLarge) {
    const metadata = { format, type: format, width: null, height: null, size: buffer.length, finalUrl, skipped: 'too_large' }
    const isValid = format !== 'Unknown'
    if (shouldSampleLog(analysisCfg)) {
      const elapsedMs = Date.now() - tStart
      logger.debug(`分析(过大跳过尺寸)：format=${format} size=${buffer.length} 耗时=${elapsedMs}ms url=${finalUrl}`)
    }
    return { isValid, reason: isValid ? undefined : 'unknown_format', metadata }
  }

  // 6) 元数据解析
  const metadataResult = await extractMetadata(buffer, format, timeoutMs, analysisCfg, finalUrl, tStart)
  if (metadataResult.error) return metadataResult.error
  
  const { metadata } = metadataResult

  // 7) 维度验证
  const dimensionValidation = validateDimensions(metadata)
  if (dimensionValidation) return dimensionValidation

  // 8) 最终结果
  const isUnknownFormat = !format || format === 'Unknown'
  const isValid = !isUnknownFormat

  if (shouldSampleLog(analysisCfg)) {
    const dim = (metadata.width && metadata.height) ? `${metadata.width}x${metadata.height}` : 'unknown'
    const elapsedMs = Date.now() - tStart
    logger.debug(`分析：format=${format} size=${buffer.length} dim=${dim} 耗时=${elapsedMs}ms url=${finalUrl}`)
  }

  return { isValid, reason: isValid ? undefined : 'unknown_format', metadata }
}


