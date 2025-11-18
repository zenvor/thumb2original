import { logger } from '../utils/logger.js'
import { toLogMeta } from '../utils/errors.js'
import { fetchImage } from './imageFetcher.js'
import { saveImage, saveImageSilent, generateFileName } from './fileManager.js'
import { analyzeImage } from './imageAnalyzer.js'
import { ensureTempDir, writeBufferToTemp, readBufferFromTemp, removeTempFile, cleanupTempDir } from './tempFileStore.js'
import { getDatabase } from './database/ImageAnalysisDB.js'
import path from 'path'

/**
 * @description 等待指定的毫秒数。
 * @param {number} ms - 等待的毫秒数。
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const RETRIABLE_ANALYSIS_REASONS = new Set(['processing_timeout', 'memory_error', 'content_too_small'])

function normalizeDelayBounds(minMs, maxMs) {
  const min = Number.isFinite(minMs) && minMs >= 0 ? Math.floor(minMs) : 0
  const candidateMax = Number.isFinite(maxMs) && maxMs >= 0 ? Math.floor(maxMs) : min
  const max = candidateMax < min ? min : candidateMax
  return { min, max }
}

function randomDelayInRange(min, max) {
  if (max <= min) return min
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function shouldRetryResult(result, retriableReasons = RETRIABLE_ANALYSIS_REASONS) {
  if (!result || result.success) return false
  if (result.type === 'fetch_failed') return true
  return result.reason ? retriableReasons.has(result.reason) : false
}

async function saveImageWithFallback(buffer, filePath, imageUrl, stats, imageInfoList, config, analysisResult) {
  let useSilent = false
  try {
    useSilent = typeof saveImageSilent === 'function'
  } catch (error) {
    const message = error?.message || ''
    if (!message.includes('No "saveImageSilent" export')) {
      throw error
    }
    useSilent = false
  }

  if (useSilent) {
    const silentResult = await saveImageSilent(buffer, filePath, imageUrl, stats, imageInfoList, config, analysisResult)
    if (silentResult && typeof silentResult === 'object' && Object.prototype.hasOwnProperty.call(silentResult, 'finalFilePath')) {
      return silentResult
    }
  } else {
    await saveImage(buffer, filePath, imageUrl, stats, imageInfoList, config, analysisResult)
  }

  return { finalBuffer: buffer, finalFilePath: filePath }
}

/**
 * 针对特定域名应用请求延迟（防反爬）
 */
async function applyDomainDelay(imageUrl, index) {
  if (imageUrl.includes('imx.to') && index > 0) {
    const singleRequestDelay = Math.floor(Math.random() * 1000) + 500
    logger.debug(`图片请求延迟 ${singleRequestDelay} 毫秒: ${imageUrl}`, logger.categories.NETWORK)
    await delay(singleRequestDelay)
  }
}

/**
 * 计算有效的抽样率
 */
function calculateEffectiveSampleRate(config, totalCount) {
  const baseSR = Math.max(1, Number(config?.analysis?.sampleRate) || 1)
  let computedEffectiveSR = baseSR
  if (totalCount > 5000) {
    computedEffectiveSR = Math.max(baseSR, 1000)
  } else if (totalCount > 1000) {
    computedEffectiveSR = Math.max(baseSR, 500)
  }
  const userEffectiveSR = Number(config?.analysis?.effectiveSampleRate)
  return Number.isFinite(userEffectiveSR) && userEffectiveSR > 0
    ? Math.max(1, userEffectiveSR)
    : computedEffectiveSR
}

/**
 * 创建衍生的分析配置
 */
function createDerivedAnalysisConfig(config, effectiveSampleRate) {
  const derivedAnalysisCfg = { ...(config?.analysis || {}), effectiveSampleRate }
  return { ...config, analysis: derivedAnalysisCfg }
}

/**
 * 判断是否应在本次分析结果上做抽样记录
 */
function shouldSampleBatchLog(analysisCfg, analyzedCount) {
  try {
    if (!analysisCfg || !analysisCfg.enableDetailLog) return false
    const base = Math.max(1, Number(analysisCfg.sampleRate) || 1)
    const sr = Math.max(1, Number(analysisCfg.effectiveSampleRate) || base)
    return (analyzedCount % sr) === 0
  } catch {
    return false
  }
}

/**
 * 创建统计对象
 */
function createStatsObject(aggregateFormatCounts, aggregateAnalysisFailures, aggregateAnalysisFailedUrls, totalUrls) {
  return {
    total: totalUrls,
    successful: 0,
    failed: 0,
    failedUrls: [],
    formatCounts: aggregateFormatCounts,
    analyzed: 0,
    analysisFailures: aggregateAnalysisFailures,
    analysisFailedUrls: aggregateAnalysisFailedUrls
  }
}

/**
 * 创建聚合统计对象
 */
function createAggregateStats() {
  const aggregateFormatCounts = Object.create(null)
  const aggregateAnalysisFailures = {
    unsupported_content_type: 0,
    unknown_format: 0,
    content_too_small: 0,
    processing_timeout: 0,
    memory_error: 0,
    invalid_dimensions: 0,
    metadata_error: 0
  }
  const aggregateAnalysisObservations = {
    metadata_parse_error_continue: 0
  }
  const aggregateAnalysisFailedUrls = []
  
  return {
    formatCounts: aggregateFormatCounts,
    analysisFailures: aggregateAnalysisFailures,
    analysisObservations: aggregateAnalysisObservations,
    analysisFailedUrls: aggregateAnalysisFailedUrls
  }
}

/**
 * 公共图片处理逻辑：网络访问 + 分析
 */
async function processImageCommon(imageUrl, index, context, config, stats, aggregateStats, totalAnalyzed, batchAnalysisSamples, retriableReasons) {
  await applyDomainDelay(imageUrl, index)
  
  const imageData = await fetchImage(imageUrl, context, 0)
  if (!imageData) {
    stats.failed++
    stats.failedUrls.push(imageUrl)
    return { 
      analyzed: false, 
      success: false, 
      reason: 'network_error',
      url: imageUrl,
      type: 'fetch_failed',
      imageData: null,
      analysisResult: null
    }
  }

  // 分析图片
  const analysisResult = await analyzeImage(imageData, imageUrl, config)
  stats.analyzed++

  // 收集分析样本
  if (shouldSampleBatchLog(config.analysis, totalAnalyzed + 1)) {
    const md = analysisResult?.metadata || {}
    const dim = (md.width && md.height) ? `${md.width}x${md.height}` : 'unknown'
    batchAnalysisSamples.push({
      url: imageUrl,
      isValid: !!analysisResult.isValid,
      reason: analysisResult.reason,
      format: md.format,
      size: md.size,
      dim
    })
  }

  // 处理可观测性统计
  if (analysisResult?.metadata?.parseErrorContinue) {
    aggregateStats.analysisObservations.metadata_parse_error_continue++
  }

  if (!analysisResult.isValid) {
    const reason = analysisResult.reason || 'unknown_format'
    if (stats.analysisFailures[reason] != null) {
      stats.analysisFailures[reason]++
    }
    stats.analysisFailedUrls.push(imageUrl)
    stats.failed++
    
    if (retriableReasons.has(reason)) {
      stats.failedUrls.push(imageUrl)
    }
    
    return { 
      analyzed: true, 
      success: false, 
      reason,
      url: imageUrl,
      type: 'analysis_failed',
      imageData,
      analysisResult
    }
  }

  return {
    analyzed: true,
    success: true,
    url: imageUrl,
    type: 'analysis_success',
    imageData,
    analysisResult
  }
}

/**
 * inline 模式：分析和下载
 */
async function processImage(imageUrl, index, context, config, targetDownloadDir, downloadedImages, stats, aggregateStats, totalAnalyzed, batchAnalysisSamples, sequenceNumber, totalCount) {
  const retriableReasons = RETRIABLE_ANALYSIS_REASONS
  const commonResult = await processImageCommon(imageUrl, index, context, config, stats, aggregateStats, totalAnalyzed, batchAnalysisSamples, retriableReasons)
  if (!commonResult.success) {
    return commonResult
  }

  // 保存图片（静默模式）- 传递序号信息
  const fileName = generateFileName(imageUrl, commonResult.imageData.buffer, commonResult.imageData.headers, context.config, sequenceNumber, totalCount)
  const filePath = path.join(targetDownloadDir, fileName)
  const saveResult = await saveImageWithFallback(
    commonResult.imageData.buffer,
    filePath,
    imageUrl,
    stats,
    downloadedImages,
    context.config,
    commonResult.analysisResult
  )

  // 返回成功结果
  const md = commonResult.analysisResult?.metadata || {}
  return {
    analyzed: true,
    success: true,
    url: imageUrl,
    fileName: path.basename(saveResult.finalFilePath),
    format: md.format || 'unknown',
    dimensions: (md.width && md.height) ? `${md.width}x${md.height}` : 'unknown',
    size: md.size ? `${Math.round(md.size / 1024)}KB` : 'unknown',
    type: 'download_success'
  }
}

/**
 * 通用批次处理：显示URL列表 + 处理图片 + 输出结果
 */
async function processBatchCommon(batch, batchIndex, batchStart, batchEnd, processor, outputter) {
  logger.header(`Processing batch ${batchIndex} (images ${batchStart}-${batchEnd})...`, logger.categories.NETWORK)
  
  // 显示批次URL列表
  logger.process(`批次 ${batchIndex} 图片URL:`)
  batch.forEach((item, idx) => {
    const url = typeof item === 'string' ? item : item.url
    logger.process(`  [${batchStart + idx}] ${url}`)
  })
  
  const batchResults = []
  const tasks = batch.map((item, index) => processor(item, index, batchResults))
  
  await Promise.all(tasks)
  
  // 统一输出批次结果
  outputter(batchResults, batchIndex)
  
  return batchResults
}

/**
 * 统一输出批次处理结果
 */
function outputBatchResults(batchResults, batchIndex) {
  const successItems = batchResults.filter(r => r.success && r.type === 'download_success')
  const failedItems = batchResults.filter(r => !r.success)
  
  // 输出成功项
  if (successItems.length > 0) {
    logger.process(`批次 ${batchIndex} 成功 (${successItems.length}项):`)
    successItems.forEach(item => {
      logger.process(`  ✓ ${item.format} ${item.dimensions} (${item.size}) → ${item.fileName}`)
    })
  }
  
  // 输出失败项
  if (failedItems.length > 0) {
    logger.process(`批次 ${batchIndex} 失败 (${failedItems.length}项):`)
    failedItems.forEach(item => {
      const reason = item.reason || 'unknown_error'
      logger.process(`  ✗ ${reason}: ${item.url}`)
    })
  }
  
  // 输出批次统计
  const total = batchResults.length
  const successRate = total > 0 ? Math.round((successItems.length / total) * 100) : 0
  logger.process(`批次 ${batchIndex} 完成: ${successItems.length}/${total} 成功 (${successRate}%)`)
}

/**
 * 输出 twoPhase 模式批次处理结果
 */
function outputTwoPhaseBatchResults(batchResults, batchIndex, phase) {
  if (phase === 'analyze') {
    const successItems = batchResults.filter(r => r.success && r.type === 'analysis_success')
    const failedItems = batchResults.filter(r => !r.success)
    
    if (successItems.length > 0) {
      logger.process(`批次 ${batchIndex} 分析成功 (${successItems.length}项):`)
      successItems.forEach(item => {
        logger.process(`  ✓ ${item.format} ${item.dimensions} (${item.size}) → 已写入临时文件`)
      })
    }
    
    if (failedItems.length > 0) {
      logger.process(`批次 ${batchIndex} 分析失败 (${failedItems.length}项):`)
      failedItems.forEach(item => {
        const reason = item.reason || 'unknown_error'
        logger.process(`  ✗ ${reason}: ${item.url}`)
      })
    }
    
    const total = batchResults.length
    const successRate = total > 0 ? Math.round((successItems.length / total) * 100) : 0
    logger.process(`批次 ${batchIndex} 分析完成: ${successItems.length}/${total} 成功 (${successRate}%)`)
  } else if (phase === 'download') {
    const successItems = batchResults.filter(r => r.success)
    const failedItems = batchResults.filter(r => !r.success)
    
    if (successItems.length > 0) {
      logger.process(`批次 ${batchIndex} 下载成功 (${successItems.length}项):`)
      successItems.forEach(item => {
        const metadata = item.metadata || {}
        const format = metadata.format || 'unknown'
        const dimensions = (metadata.width && metadata.height) ? `${metadata.width}x${metadata.height}` : 'unknown'
        const size = metadata.size ? `${Math.round(metadata.size / 1024)}KB` : 'unknown'
        logger.process(`  ✓ ${format} ${dimensions} (${size}) → ${item.fileName}`)
      })
    }
    
    if (failedItems.length > 0) {
      logger.process(`批次 ${batchIndex} 下载失败 (${failedItems.length}项):`)
      failedItems.forEach(item => {
        logger.process(`  ✗ ${item.reason}: ${item.url}`)
      })
    }
    
    const total = batchResults.length
    const successRate = total > 0 ? Math.round((successItems.length / total) * 100) : 0
    logger.process(`批次 ${batchIndex} 下载完成: ${successItems.length}/${total} 成功 (${successRate}%)`)
  }
}

/**
 * 输出批次分析样本（调试模式）
 */
function outputBatchSamples(batchAnalysisSamples) {
  if (batchAnalysisSamples.length > 0) {
    const maxLines = 5
    const lines = batchAnalysisSamples.slice(0, maxLines).map((s, idx) => {
      const tag = s.isValid ? '成功' : `失败(${s.reason})`
      return `#${idx + 1} ${tag} format=${s.format} size=${s.size} dim=${s.dim} url=${s.url}`
    })
    if (batchAnalysisSamples.length > maxLines) {
      lines.push(`... 其余 ${batchAnalysisSamples.length - maxLines} 条样本已省略`)
    }
    logger.debug(`分析样本（本批次）：\n${lines.join('\n')}`, logger.categories.DOWNLOAD)
  }
}

/**
 * 处理批次错误
 */
function handleBatchError(error, batchId, options = {}) {
  const { suppressThrow = false } = options
  const isBrowserError = 
    error.message.includes('Connection closed') ||
    error.message.includes('Navigating frame was detached') ||
    error.message.includes('Session closed')

  const isFatal = error.isCritical || isBrowserError

  if (isFatal) {
    const reason = error.isCritical ? '关键错误' : '浏览器连接断开'
    const action = suppressThrow ? '记录错误，继续处理' : '立即终止所有下载任务'
    logger.error(`[${batchId}] 遇到${reason}，${action}: ${error.message}`,
      logger.categories.DOWNLOAD,
      { batchId, ...toLogMeta(error) }
    )
    if (isBrowserError && !suppressThrow) {
      logger.error(`[${batchId}] 检测到浏览器实例关闭或页面已分离，这是严重错误，将终止程序。`,
        logger.categories.DOWNLOAD,
        { batchId }
      )
    }
    if (!suppressThrow) {
      logger.error(`[${batchId}] 数据一致性保障：任务已安全终止，避免数据丢失`,
        logger.categories.DOWNLOAD,
        { batchId }
      )
      throw error
    }
    return
  }
  
  logger.warn(`[${batchId}] 批次处理中出现错误，但非关键错误，继续处理: ${error.message}`,
    logger.categories.DOWNLOAD,
    { batchId, ...toLogMeta(error) }
  )
}

/**
 * 输出最终统计信息
 */
function outputFinalStats(aggregateStats) {
  // 输出格式统计
  const entries = Object.entries(aggregateStats.formatCounts).filter(([_, v]) => v > 0)
  if (entries.length > 0) {
    const prefer = ['png', 'jpeg', 'svg', 'webp']
    const preferred = prefer.filter((k) => aggregateStats.formatCounts[k] > 0).map((k) => [k, aggregateStats.formatCounts[k]])
    const others = entries
      .filter(([k]) => !prefer.includes(k))
      .sort((a, b) => a[0].localeCompare(b[0]))
    const ordered = [...preferred, ...others]
    const text = ordered.map(([k, v]) => `${k.toUpperCase()} ${v}`).join('，')
    logger.success(`类型统计：${text}`)
  }

  // 输出分析失败统计
  const failReasons = Object.entries(aggregateStats.analysisFailures).filter(([, v]) => v > 0)
  if (failReasons.length > 0) {
    const text = failReasons.map(([k, v]) => `${k} ${v}`).join('，')
    logger.info(`分析失败汇总：${text}`, logger.categories.DOWNLOAD)
  }

  // 输出观察统计
  const obsReasons = Object.entries(aggregateStats.analysisObservations).filter(([, v]) => v > 0)
  if (obsReasons.length > 0) {
    const text = obsReasons.map(([k, v]) => `${k} ${v}`).join('，')
    logger.info(`分析观察汇总：${text}`, logger.categories.DOWNLOAD)
  }
}

/**
 * twoPhase 分析阶段
 */
async function analyzePhase(imageUrls, context, tempDir, aggregateStats, taskId = null, db = null) {
  const { config } = context
  const { concurrentDownloads, minRequestDelayMs, maxRequestDelayMs, maxRetries } = config
  const { min: minDelayMs, max: maxDelayMs } = normalizeDelayBounds(minRequestDelayMs, maxRequestDelayMs)
  const maxHoldBuffers = Math.max(0, Number(config?.analysis?.maxHoldBuffers) || 0)
  
  logger.header('Analyzing images ...', logger.categories.DOWNLOAD)
  
  const effectiveSampleRate = calculateEffectiveSampleRate(config, imageUrls.length)
  const derivedConfigForAnalysis = createDerivedAnalysisConfig(config, effectiveSampleRate)
  
  const validEntries = []
  let totalAnalyzed = 0
  let tempFilesCreated = 0
  let tempBytesWritten = 0
  const totalCount = imageUrls.length
  const initialTasks = imageUrls.map((url, idx) => ({
    url,
    sequenceNumber: idx + 1,
    totalCount
  }))
  let tasksToAnalyze = [...initialTasks]
  let currentRetry = 0
  
  const retriableReasons = RETRIABLE_ANALYSIS_REASONS

  while (tasksToAnalyze.length > 0 && currentRetry <= maxRetries) {
    if (currentRetry > 0) {
      logger.warn(`--- twoPhase 分析重试 ${currentRetry}/${maxRetries}，待处理 ${tasksToAnalyze.length} ---`, logger.categories.DOWNLOAD)
      await delay(config.retryDelayMs)
    }

    const stats = createStatsObject(
      aggregateStats.formatCounts,
      aggregateStats.analysisFailures,
      aggregateStats.analysisFailedUrls,
      tasksToAnalyze.length
    )
    
    let heldEntries = []
    const nextFailedTasks = []

    for (let i = 0; i < tasksToAnalyze.length; i += concurrentDownloads) {
      const batch = tasksToAnalyze.slice(i, i + concurrentDownloads)
      const batchIndex = Math.floor(i / concurrentDownloads) + 1
      const batchStart = i + 1
      const batchEnd = Math.min(i + concurrentDownloads, tasksToAnalyze.length)
      
      logger.header(`Analyzing batch ${batchIndex} (images ${batchStart}-${batchEnd})...`, logger.categories.NETWORK)
      
      // 显示批次URL列表
      logger.process(`批次 ${batchIndex} 图片URL:`)
      batch.forEach((task, idx) => {
        logger.process(`  [${batchStart + idx}] ${task.url}`)
      })
      
      const batchAnalysisSamples = []
      const batchResults = []
      const tasks = batch.map(async (task, index) => {
        const { url, sequenceNumber, totalCount: taskTotalCount } = task
        const result = await analyzeImageForTwoPhase(
          url, index, context, derivedConfigForAnalysis,
          tempDir, maxHoldBuffers, aggregateStats,
          stats, heldEntries, retriableReasons, batchAnalysisSamples,
          sequenceNumber, taskTotalCount, taskId, db
        )
        if (result.analyzed) totalAnalyzed++
        if (result.tempFile) {
          tempFilesCreated++
          tempBytesWritten += result.tempFile.bytesWritten
          validEntries.push(result.tempFile.entry)
        }
        if (shouldRetryResult(result, retriableReasons)) {
          nextFailedTasks.push(task)
        }
        batchResults.push(result)
        return result
      })

      try {
        await Promise.all(tasks)
        
        // 统一输出批次分析结果
        outputTwoPhaseBatchResults(batchResults, batchIndex, 'analyze')
        
        const currentProgress = Math.min(i + concurrentDownloads, tasksToAnalyze.length)
        logger.progress(currentProgress, tasksToAnalyze.length, `分析批次 ${batchIndex} 完成`, 1)

        // 输出分析样本（debug模式）
        if (config.analysis?.enableDetailLog) {
          outputBatchSamples(batchAnalysisSamples)
        }
        
        if (i + concurrentDownloads < tasksToAnalyze.length) {
          const randomInterval = randomDelayInRange(minDelayMs, maxDelayMs)
          logger.debug(`等待 ${randomInterval} 毫秒后开始下一分析批次...`, logger.categories.NETWORK, { randomInterval })
          await delay(randomInterval)
        }
      } catch (e) {
        handleBatchError(e, 'twoPhase_analyze', { suppressThrow: true })
      }
    }

    // 处理剩余的内存缓存项
    if (maxHoldBuffers > 0 && heldEntries.length > 0) {
      logger.info(`开始批量保存 ${heldEntries.length} 张图片到数据库 (taskId: ${taskId})`)

      // 验证所有图片都有 buffer
      const imagesWithoutBuffer = heldEntries.filter(e => !e.buffer || e.buffer.length === 0)
      if (imagesWithoutBuffer.length > 0) {
        logger.error(`❌ ${imagesWithoutBuffer.length} 张图片没有 buffer，无法保存到数据库`)
        throw new Error(`Cannot save ${imagesWithoutBuffer.length} images without buffer`)
      }

      // 批量保存到数据库
      const imagesToSave = heldEntries.map(e => ({
        url: e.url,
        buffer: e.buffer,
        headers: e.headers,
        metadata: e.metadata,
        sequenceNumber: e.sequenceNumber
      }))

      db.saveImageBatch(taskId, imagesToSave)
      logger.info(`✅ 批量保存 ${imagesToSave.length} 张图片到数据库完成`, logger.categories.DOWNLOAD)

      // 添加到 validEntries（标记为来自数据库）
      for (const e of heldEntries) {
        tempBytesWritten += e.buffer.length
        validEntries.push({
          url: e.url,
          headers: e.headers,
          metadata: e.metadata,
          sequenceNumber: e.sequenceNumber,
          totalCount: e.totalCount,
          fromDatabase: true  // 标记来自数据库
        })
      }
    }

    tasksToAnalyze = nextFailedTasks
    currentRetry++
  }

  return { validEntries, totalAnalyzed, tempFilesCreated, tempBytesWritten }
}

/**
 * twoPhase 下载阶段
 */
async function downloadPhase(validEntries, targetDownloadDir, context, downloadedImages, aggregateStats, totalAnalyzed, taskId = null, db = null) {
  const { config } = context
  const { concurrentDownloads } = config
  const cleanupTempOnComplete = config?.analysis?.cleanupTempOnComplete !== false
  let tempCleanupRemoved = 0
  
  logger.header('Downloading images ...', logger.categories.DOWNLOAD)
  
  const downloadStats = createStatsObject(
    aggregateStats.formatCounts,
    aggregateStats.analysisFailures,
    aggregateStats.analysisFailedUrls,
    validEntries.length
  )
  downloadStats.analyzed = totalAnalyzed

  for (let i = 0; i < validEntries.length; i += concurrentDownloads) {
    const batch = validEntries.slice(i, i + concurrentDownloads)
    const batchIndex = Math.floor(i / concurrentDownloads) + 1
    const batchStart = i + 1
    const batchEnd = Math.min(i + concurrentDownloads, validEntries.length)
    
    logger.header(`Downloading batch ${batchIndex} (images ${batchStart}-${batchEnd})...`, logger.categories.NETWORK)
    
    // 显示批次文件列表
    logger.process(`批次 ${batchIndex} 临时文件:`)
    batch.forEach((entry, idx) => {
      const metadata = entry.metadata || {}
      const format = metadata.format || 'unknown'
      const dimensions = (metadata.width && metadata.height) ? `${metadata.width}x${metadata.height}` : 'unknown'
      const size = metadata.size ? `${Math.round(metadata.size / 1024)}KB` : 'unknown'
      logger.process(`  [${batchStart + idx}] ${format} ${dimensions} (${size}) → ${entry.url}`)
    })
    
    const batchResults = []
    const tasks = batch.map(async (entry, idx) => {
      let success = false, fileName = '', reason = ''
      try {
        let buffer

        // 根据标记决定从数据库还是临时文件读取
        if (entry.fromDatabase) {
          // 从数据库读取
          buffer = db.getImageBuffer(taskId, entry.url)
          if (!buffer) {
            throw new Error('数据库中未找到图片 buffer')
          }
          logger.debug(`从数据库读取图片: ${entry.url}`, logger.categories.DOWNLOAD)
        } else {
          // 从临时文件读取（降级场景，正常不应该走到这里）
          buffer = await readBufferFromTemp(entry.tempPath)
        }

        // 从元数据中读取序号信息
        const sequenceNumber = entry.sequenceNumber || null
        const totalCount = entry.totalCount || null
        fileName = generateFileName(entry.url, buffer, entry.headers, config, sequenceNumber, totalCount)
        const filePath = path.join(targetDownloadDir, fileName)
        await saveImageWithFallback(
          buffer,
          filePath,
          entry.url,
          downloadStats,
          downloadedImages,
          config,
          { isValid: true, metadata: entry.metadata }
        )
        success = true
      } catch (e) {
        downloadStats.failed++
        downloadStats.failedUrls.push(entry.url)
        reason = e.message
      } finally {
        // 只有使用临时文件时才需要清理
        if (entry.tempPath && cleanupTempOnComplete) {
          await removeTempFile(entry.tempPath)
          tempCleanupRemoved++
        }
      }

      batchResults.push({
        success,
        url: entry.url,
        fileName,
        reason,
        metadata: entry.metadata
      })
    })
    
    try {
      await Promise.all(tasks)
      
      // 统一输出批次下载结果
      outputTwoPhaseBatchResults(batchResults, batchIndex, 'download')
      
      const currentProgress = Math.min(i + concurrentDownloads, validEntries.length)
      logger.progress(currentProgress, validEntries.length, `下载批次 ${batchIndex} 完成`, 1)
    } catch (e) {
      handleBatchError(e, 'twoPhase_download', { suppressThrow: true })
    }
  }

  if (downloadStats.failed > 0) {
    logger.error(`twoPhase 下载失败: ${downloadStats.failed}/${downloadStats.total}`)
  }

  return { tempCleanupRemoved }
}

/**
 * twoPhase 模式：仅分析，保存到数据库或临时文件
 */
async function analyzeImageForTwoPhase(
  imageUrl, index, context, config, tempDir, maxHoldBuffers,
  aggregateStats, stats, heldEntries, retriableReasons, batchAnalysisSamples,
  sequenceNumber, totalCount, taskId = null, db = null
) {
  const commonResult = await processImageCommon(imageUrl, index, context, config, stats, aggregateStats, stats.analyzed, batchAnalysisSamples, retriableReasons)

  if (!commonResult.success) {
    return { ...commonResult, tempFile: null }
  }

  // 保存到数据库或临时文件/内存缓存，并存储序号信息
  const entry = {
    url: imageUrl,
    buffer: commonResult.imageData.buffer,
    headers: commonResult.imageData.headers || {},
    metadata: commonResult.analysisResult.metadata,
    sequenceNumber,  // 存储序号
    totalCount       // 存储总数
  }

  let tempFile = null

  // 根据 maxHoldBuffers 决定是立即保存还是先缓存到内存
  if (maxHoldBuffers > 0) {
    // 先缓存到内存，稍后批量保存到数据库
    heldEntries.push(entry)
    logger.debug(`缓存图片到内存 (${heldEntries.length}/${maxHoldBuffers}): ${entry.url}`)
  } else {
    // 立即保存到数据库
    logger.debug(`保存图片到数据库 (taskId: ${taskId}, bufferSize: ${entry.buffer?.length || 0}): ${entry.url}`)

    if (!entry.buffer || entry.buffer.length === 0) {
      logger.error(`❌ 尝试保存空 buffer 到数据库: ${entry.url}`)
      throw new Error(`Cannot save image without buffer: ${entry.url}`)
    }

    db.saveImage(taskId, {
      url: entry.url,
      buffer: entry.buffer,
      headers: entry.headers,
      metadata: entry.metadata,
      sequenceNumber: entry.sequenceNumber
    })

    logger.debug(`✅ 图片已保存到数据库: ${entry.url}`)

    // 返回 entry（不含 tempPath，因为使用数据库）
    tempFile = {
      bytesWritten: entry.buffer.length,
      entry: {
        url: entry.url,
        headers: entry.headers,
        metadata: entry.metadata,
        sequenceNumber,
        totalCount,
        fromDatabase: true  // 标记来自数据库
      }
    }
  }

  stats.successful++

  // 返回成功结果
  const md = commonResult.analysisResult?.metadata || {}
  return {
    analyzed: true,
    success: true,
    url: imageUrl,
    format: md.format || 'unknown',
    dimensions: (md.width && md.height) ? `${md.width}x${md.height}` : 'unknown',
    size: md.size ? `${Math.round(md.size / 1024)}KB` : 'unknown',
    type: 'analysis_success',
    tempFile
  }
}

/**
 * @description 管理和执行图片下载任务，包括并发控制和重试机制。
 * @param {string[]} imageUrls - 要下载的图片 URL 列表。
 * @param {string} targetDownloadDir - 目标下载目录。
 * @param {object} context - 全局上下文对象。
 * @param {Array} downloadedImages - 用于收集下载图片信息的数组。
 * @returns {Promise<void>}
 */
export async function processDownloadQueue(imageUrls, targetDownloadDir, context, downloadedImages) {
  const { config } = context

  // twoPhase 模式处理
  if (config?.analysis?.mode === 'twoPhase') {
    try {
      if (config?.analysis?.cleanupTempOnStart) {
        await cleanupTempDir(config?.analysis?.tempDir || './.tmp_analysis')
      }
    } catch {}
    return await processTwoPhase(imageUrls, targetDownloadDir, context, downloadedImages)
  }

  // twoPhaseApi 模式处理（仅分析写入临时文件，跳过下载）
  if (config?.analysis?.mode === 'twoPhaseApi') {
    try {
      if (config?.analysis?.cleanupTempOnStart) {
        await cleanupTempDir(config?.analysis?.tempDir || './.tmp_analysis')
      }
    } catch {}
    return await processTwoPhaseApi(imageUrls, targetDownloadDir, context, downloadedImages)
  }

  // 内联模式处理
  return await processInlineMode(imageUrls, targetDownloadDir, context, downloadedImages)
}

/**
 * 处理内联模式（分析+下载同步进行）
 */
async function processInlineMode(imageUrls, targetDownloadDir, context, downloadedImages) {
  const { config, isResumeDownload, totalImageCount, downloadedCount } = context

  const aggregateStats = createAggregateStats()
  let totalAnalyzed = 0
  
  // 显示断点续传信息
  if (isResumeDownload) {
    logger.header(`断点续传模式：总共 ${totalImageCount} 张图片，已完成 ${downloadedCount} 张，还需下载 ${imageUrls.length} 张`)
  }
  
  const baseDownloaded = Number(downloadedCount) || 0
  const inferredTotal = Number.isFinite(totalImageCount)
    ? Math.max(Number(totalImageCount), baseDownloaded + imageUrls.length)
    : baseDownloaded + imageUrls.length
  const initialTasks = imageUrls.map((url, idx) => ({
    url,
    sequenceNumber: baseDownloaded + idx + 1,
    totalCount: inferredTotal
  }))

  // 准备分析配置
  const totalCountForSampling = inferredTotal
  const effectiveSampleRate = calculateEffectiveSampleRate(config, totalCountForSampling)
  const derivedConfigForAnalysis = createDerivedAnalysisConfig(config, effectiveSampleRate)

  let tasksToProcess = [...initialTasks]
  let currentRetry = 0
  const retriableReasons = RETRIABLE_ANALYSIS_REASONS
  
  const { min: minDelayMs, max: maxDelayMs } = normalizeDelayBounds(config.minRequestDelayMs, config.maxRequestDelayMs)

  try {
    while (tasksToProcess.length > 0 && currentRetry <= config.maxRetries) {
      if (currentRetry > 0) {
        logger.warn(
          `--- 开始第 ${currentRetry}/${config.maxRetries} 次重试，处理 ${tasksToProcess.length} 张失败的图片 ---`,
          logger.categories.DOWNLOAD,
          { currentRetry, maxRetries: config.maxRetries, pending: tasksToProcess.length }
        )
        await delay(config.retryDelayMs)
      }

      const stats = createStatsObject(
        aggregateStats.formatCounts,
        aggregateStats.analysisFailures, 
        aggregateStats.analysisFailedUrls,
        tasksToProcess.length
      )

      const { concurrentDownloads } = config
      // 内联模式不打印阶段级 Analyzing 头，仅在每个批次前打印 Fetch 头

      const nextFailedTasks = []

      for (let i = 0; i < tasksToProcess.length; i += concurrentDownloads) {
        const batch = tasksToProcess.slice(i, i + concurrentDownloads)
        const batchIndex = Math.floor(i / concurrentDownloads) + 1
        const batchStart = i + 1
        const batchEnd = Math.min(i + concurrentDownloads, tasksToProcess.length)
        
        logger.header(`Fetch images batch ${batchIndex} (images ${batchStart}-${batchEnd})...`, logger.categories.NETWORK)
        
        // 显示批次URL列表
        logger.process(`批次 ${batchIndex} 图片URL:`)
        batch.forEach((task, idx) => {
          logger.process(`  [${batchStart + idx}] ${task.url}`)
        })
        
        const batchAnalysisSamples = []
        const batchResults = []

        const downloadPromises = batch.map(async (task, index) => {
          const { url, sequenceNumber, totalCount } = task
          const result = await processImage(
            url, index, context, derivedConfigForAnalysis, targetDownloadDir,
            downloadedImages, stats, aggregateStats, totalAnalyzed, batchAnalysisSamples,
            sequenceNumber, totalCount
          )
          if (result.analyzed) totalAnalyzed++
          if (shouldRetryResult(result, retriableReasons)) {
            nextFailedTasks.push(task)
          }
          batchResults.push(result)
          return result
        })

        try {
          await Promise.all(downloadPromises)
          
          // 统一输出批次结果
          outputBatchResults(batchResults, batchIndex)
          
          const currentProgress = Math.min(i + concurrentDownloads, tasksToProcess.length)
          logger.progress(currentProgress, tasksToProcess.length, `批次 ${batchIndex} 完成`, 1)

          // 输出分析样本（debug模式）
          if (config.analysis?.enableDetailLog) {
            outputBatchSamples(batchAnalysisSamples)
          }
        } catch (error) {
          handleBatchError(error, 'inline')
        }

        // 批次间延迟
        if (i + concurrentDownloads < tasksToProcess.length) {
          const randomInterval = randomDelayInRange(minDelayMs, maxDelayMs)
          logger.debug(`等待 ${randomInterval} 毫秒后开始下一批次...`, logger.categories.NETWORK, { randomInterval })
          await delay(randomInterval)
        }
      }


      logger.header(`--- 批处理完成 (尝试次数 ${currentRetry}) ---`)
      logger.success(`成功下载: ${stats.successful}/${stats.total}`)
      if (stats.failed > 0) {
        logger.error(`下载失败: ${stats.failed}/${stats.total}`)
      }

      tasksToProcess = nextFailedTasks
      currentRetry++
    }
  } finally {
    // 进度启停交由入口统一控制
  }

  // 输出失败信息
  if (tasksToProcess.length > 0) {
    logger.error(`所有重试后，仍有 ${tasksToProcess.length} 张图片下载失败:`, logger.categories.DOWNLOAD, { failedCount: tasksToProcess.length })
    tasksToProcess.forEach((task) => logger.error(`- ${task.url}`, logger.categories.DOWNLOAD, { url: task.url }))
  }

  // 输出最终统计信息
  outputFinalStats(aggregateStats)

  return {
    analyzed: totalAnalyzed,
    analysisFailures: aggregateStats.analysisFailures,
    analysisFailedUrls: aggregateStats.analysisFailedUrls,
    formatCounts: aggregateStats.formatCounts,
    analysisObservations: aggregateStats.analysisObservations
  }
}

/**
 * 中文注释：twoPhase 模式的完整编排
 * - 严格遵守 concurrentDownloads 并发上限
 * - 分析阶段将图片保存到数据库
 * - 下载阶段从数据库读取并调用 saveImage
 * - 数据库始终启用，不再支持临时文件存储
 * - 关键：formatCounts 在分析与下载阶段共享同一引用对象（跨重试/跨阶段累计），请勿重新赋值
 */
async function processTwoPhase(imageUrls, targetDownloadDir, context, downloadedImages) {
  const { config } = context
  const tempDir = config?.analysis?.tempDir || './.tmp_analysis'

  const aggregateStats = createAggregateStats()
  let tempFilesCreated = 0
  let tempBytesWritten = 0
  let tempCleanupRemoved = 0

  // 生成任务 ID（时间戳 + 随机字符串）
  const taskId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`

  // 初始化数据库
  const db = getDatabase(config)
  await db.init()

  // 创建任务记录
  db.createTask(taskId, context.url || 'unknown', 'twoPhase')
  db.updateTaskStatus(taskId, 'analyzing')
  logger.info(`使用数据库存储图片分析结果 (taskId: ${taskId})`, logger.categories.DOWNLOAD)

  // 分析阶段
  const analyzeResult = await analyzePhase(imageUrls, context, tempDir, aggregateStats, taskId, db)
  const { validEntries, totalAnalyzed } = analyzeResult
  tempFilesCreated = analyzeResult.tempFilesCreated
  tempBytesWritten = analyzeResult.tempBytesWritten

  // 更新任务状态
  db.updateTaskStatus(taskId, 'downloading')

  // 下载阶段
  const downloadResult = await downloadPhase(validEntries, targetDownloadDir, context, downloadedImages, aggregateStats, totalAnalyzed, taskId, db)
  tempCleanupRemoved = downloadResult.tempCleanupRemoved

  // 更新任务状态为完成
  db.updateTaskStatus(taskId, 'completed', {
    formatCounts: aggregateStats.formatCounts,
    totalAnalyzed
  })
  db.updateTaskImageCount(taskId, totalAnalyzed, totalAnalyzed)

  outputFinalStats(aggregateStats)

  logger.debug(`数据库存储：图片数=${totalAnalyzed} bytes=${tempBytesWritten}`)

  return {
    analyzed: totalAnalyzed,
    analysisFailures: aggregateStats.analysisFailures,
    analysisFailedUrls: aggregateStats.analysisFailedUrls,
    formatCounts: aggregateStats.formatCounts,
    analysisObservations: aggregateStats.analysisObservations
  }
}

/**
 * twoPhaseApi 模式：仅分析阶段，保存到数据库，不进行下载。
 * - 复用 twoPhase 的 analyzePhase()
 * - 数据库始终启用，不再支持临时文件存储
 */
async function processTwoPhaseApi(imageUrls, targetDownloadDir, context, downloadedImages) {
  const { config } = context
  const tempDir = config?.analysis?.tempDir || './.tmp_analysis'

  const aggregateStats = createAggregateStats()
  let tempFilesCreated = 0
  let tempBytesWritten = 0

  // 生成任务 ID（时间戳 + 随机字符串）
  const taskId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`

  // 初始化数据库
  const db = getDatabase(config)
  await db.init()

  // 创建任务记录
  db.createTask(taskId, context.url || 'unknown', 'twoPhaseApi')
  db.updateTaskStatus(taskId, 'analyzing')
  logger.info(`使用数据库存储图片分析结果 (taskId: ${taskId})`, logger.categories.DOWNLOAD)

  // 分析阶段
  const analyzeResult = await analyzePhase(imageUrls, context, tempDir, aggregateStats, taskId, db)
  const { validEntries, totalAnalyzed } = analyzeResult
  tempFilesCreated = analyzeResult.tempFilesCreated
  tempBytesWritten = analyzeResult.tempBytesWritten

  // 更新任务状态为完成
  db.updateTaskStatus(taskId, 'completed', {
    formatCounts: aggregateStats.formatCounts,
    totalAnalyzed
  })
  db.updateTaskImageCount(taskId, totalAnalyzed, totalAnalyzed)

  // 输出最终统计信息（下载阶段被跳过）
  outputFinalStats(aggregateStats)

  logger.debug(`twoPhaseApi：分析完成，已保存到数据库。图片数=${totalAnalyzed} bytes=${tempBytesWritten}`)

  return {
    taskId,
    analyzed: totalAnalyzed,
    analysisFailures: aggregateStats.analysisFailures,
    analysisFailedUrls: aggregateStats.analysisFailedUrls,
    formatCounts: aggregateStats.formatCounts,
    analysisObservations: aggregateStats.analysisObservations,
    tempDir,
    tempFiles: validEntries,
    tempFilesCreated,
    tempBytesWritten,
    // 提供获取带 buffer 的图片的方法
    getImagesWithBuffers: async () => {
      return db.getImagesWithBuffers(taskId)
    }
  }
}
