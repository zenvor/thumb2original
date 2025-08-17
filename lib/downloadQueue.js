import { logger } from '../utils/logger.js'
import { toLogMeta } from '../utils/errors.js'
import { fetchImage } from './imageFetcher.js'
import { saveImage, generateFileName } from './fileManager.js'
import { analyzeImage } from './imageAnalyzer.js'
import { ensureTempDir, writeBufferToTemp, readBufferFromTemp, removeTempFile, cleanupTempDir } from './tempFileStore.js'
import path from 'path'

/**
 * @description 等待指定的毫秒数。
 * @param {number} ms - 等待的毫秒数。
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
 * 处理单张图片的分析和下载
 */
async function processImage(imageUrl, index, context, config, targetDownloadDir, downloadedImages, stats, aggregateStats, totalAnalyzed, batchAnalysisSamples) {
  await applyDomainDelay(imageUrl, index)
  
  const imageData = await fetchImage(imageUrl, context, 0)
  if (!imageData) {
    stats.failed++
    stats.failedUrls.push(imageUrl)
    return { analyzed: false, needsDownloadHeader: false }
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
    
    const retriableReasons = new Set(['processing_timeout', 'memory_error', 'content_too_small'])
    if (retriableReasons.has(reason)) {
      stats.failedUrls.push(imageUrl)
    }
    return { analyzed: true, needsDownloadHeader: false }
  }

  // 保存图片
  const fileName = generateFileName(imageUrl, imageData.buffer, imageData.headers)
  const filePath = path.join(targetDownloadDir, fileName)
  await saveImage(imageData.buffer, filePath, imageUrl, stats, downloadedImages, context.config, analysisResult)
  
  return { analyzed: true, needsDownloadHeader: true }
}

/**
 * 输出批次分析样本
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
async function analyzePhase(imageUrls, context, tempDir, aggregateStats) {
  const { config } = context
  const { concurrentDownloads, minRequestDelayMs, maxRequestDelayMs, maxRetries } = config
  const maxHoldBuffers = Math.max(0, Number(config?.analysis?.maxHoldBuffers) || 0)
  
  logger.header('Analyzing images ...', logger.categories.DOWNLOAD)
  
  const effectiveSampleRate = calculateEffectiveSampleRate(config, imageUrls.length)
  const derivedConfigForAnalysis = createDerivedAnalysisConfig(config, effectiveSampleRate)
  
  const validEntries = []
  let totalAnalyzed = 0
  let tempFilesCreated = 0
  let tempBytesWritten = 0
  let urlsToAnalyze = [...imageUrls]
  let currentRetry = 0
  
  const retriableReasons = new Set(['processing_timeout', 'memory_error', 'content_too_small'])

  while (urlsToAnalyze.length > 0 && currentRetry <= maxRetries) {
    if (currentRetry > 0) {
      logger.warn(`--- twoPhase 分析重试 ${currentRetry}/${maxRetries}，待处理 ${urlsToAnalyze.length} ---`, logger.categories.DOWNLOAD)
      await delay(config.retryDelayMs)
    }

    const stats = createStatsObject(
      aggregateStats.formatCounts,
      aggregateStats.analysisFailures,
      aggregateStats.analysisFailedUrls,
      urlsToAnalyze.length
    )
    
    let heldEntries = []

    for (let i = 0; i < urlsToAnalyze.length; i += concurrentDownloads) {
      const batch = urlsToAnalyze.slice(i, i + concurrentDownloads)
      const batchAnalysisSamples = []
      const tasks = batch.map(async (imageUrl, index) => {
        const result = await analyzeImageForTwoPhase(
          imageUrl, index, context, derivedConfigForAnalysis, 
          tempDir, maxHoldBuffers, aggregateStats, 
          stats, heldEntries, retriableReasons, batchAnalysisSamples
        )
        if (result.analyzed) totalAnalyzed++
        if (result.tempFile) {
          tempFilesCreated++
          tempBytesWritten += result.tempFile.bytesWritten
          validEntries.push(result.tempFile.entry)
        }
        return result
      })

      try {
        await Promise.all(tasks)
        const currentProgress = Math.min(i + concurrentDownloads, urlsToAnalyze.length)
        logger.progress(currentProgress, urlsToAnalyze.length, `分析批次 ${Math.floor(i / concurrentDownloads) + 1} 完成`, 1)

        // 输出分析样本
        outputBatchSamples(batchAnalysisSamples)
        
        if (i + concurrentDownloads < urlsToAnalyze.length) {
          const randomInterval = Math.floor(Math.random() * (maxRequestDelayMs - minRequestDelayMs + 1)) + minRequestDelayMs
          logger.debug(`等待 ${randomInterval} 毫秒后开始下一分析批次...`, logger.categories.NETWORK)
          await delay(randomInterval)
        }
      } catch (e) {
        handleBatchError(e, 'twoPhase_analyze', { suppressThrow: true })
      }
    }

    // 处理剩余的内存缓存项
    if (maxHoldBuffers > 0 && heldEntries.length > 0) {
      for (const e of heldEntries) {
        const tempPath = await writeBufferToTemp(e.buffer, tempDir)
        tempFilesCreated++
        tempBytesWritten += e.buffer.length
        validEntries.push({ url: e.url, tempPath, headers: e.headers, metadata: e.metadata })
      }
    }

    urlsToAnalyze = [...stats.failedUrls]
    currentRetry++
  }

  return { validEntries, totalAnalyzed, tempFilesCreated, tempBytesWritten }
}

/**
 * twoPhase 下载阶段
 */
async function downloadPhase(validEntries, targetDownloadDir, context, downloadedImages, aggregateStats, totalAnalyzed) {
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
    const tasks = batch.map(async (entry) => {
      try {
        const buffer = await readBufferFromTemp(entry.tempPath)
        const fileName = generateFileName(entry.url, buffer, entry.headers)
        const filePath = path.join(targetDownloadDir, fileName)
        await saveImage(buffer, filePath, entry.url, downloadStats, downloadedImages, config, 
          { isValid: true, metadata: entry.metadata })
        downloadStats.successful++
      } catch (e) {
        downloadStats.failed++
        downloadStats.failedUrls.push(entry.url)
        logger.warn(`twoPhase 下载条目失败: ${entry.url} - ${e.message}`)
      } finally {
        if (cleanupTempOnComplete) {
          await removeTempFile(entry.tempPath)
          tempCleanupRemoved++
        }
      }
    })
    
    try {
      await Promise.all(tasks)
      const currentProgress = Math.min(i + concurrentDownloads, validEntries.length)
      logger.progress(currentProgress, validEntries.length, `下载批次 ${Math.floor(i / concurrentDownloads) + 1} 完成`, 1)
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
 * 为 twoPhase 模式分析单张图片
 */
async function analyzeImageForTwoPhase(
  imageUrl, index, context, config, tempDir, maxHoldBuffers, 
  aggregateStats, stats, heldEntries, retriableReasons, batchAnalysisSamples
) {
  await applyDomainDelay(imageUrl, index)

  const imageData = await fetchImage(imageUrl, context, 0)
  if (!imageData) {
    stats.failed++
    stats.failedUrls.push(imageUrl)
    return { analyzed: false, tempFile: null }
  }

  const analysisResult = await analyzeImage(imageData, imageUrl, config)
  stats.analyzed++

  // 收集分析样本
  try {
    if (Array.isArray(batchAnalysisSamples) && shouldSampleBatchLog(config.analysis, stats.analyzed)) {
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
  } catch {}

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
    return { analyzed: true, tempFile: null }
  }

  // 保存到临时文件或内存缓存
  const entry = {
    url: imageUrl,
    buffer: imageData.buffer,
    headers: imageData.headers || {},
    metadata: analysisResult.metadata
  }
  
  let tempFile = null
  if (maxHoldBuffers > 0) {
    heldEntries.push(entry)
  } else {
    const tempPath = await writeBufferToTemp(entry.buffer, tempDir)
    tempFile = { 
      bytesWritten: entry.buffer.length,
      entry: { url: entry.url, tempPath, headers: entry.headers, metadata: entry.metadata }
    }
  }
  
  stats.successful++
  return { analyzed: true, tempFile }
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

  // 内联模式处理
  return await processInlineMode(imageUrls, targetDownloadDir, context, downloadedImages)
}

/**
 * 处理内联模式（分析+下载同步进行）
 */
async function processInlineMode(imageUrls, targetDownloadDir, context, downloadedImages) {
  const { config, isResumeDownload, totalImageCount, downloadedCount } = context
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  
  const aggregateStats = createAggregateStats()
  let totalAnalyzed = 0
  
  // 显示断点续传信息
  if (isResumeDownload) {
    logger.header(`断点续传模式：总共 ${totalImageCount} 张图片，已完成 ${downloadedCount} 张，还需下载 ${imageUrls.length} 张`)
  }
  
  // 准备分析配置
  const totalCountForSampling = Number.isFinite(totalImageCount) ? totalImageCount : imageUrls.length
  const effectiveSampleRate = calculateEffectiveSampleRate(config, totalCountForSampling)
  const derivedConfigForAnalysis = createDerivedAnalysisConfig(config, effectiveSampleRate)

  let urlsToProcess = [...imageUrls]
  let currentRetry = 0
  
  try {
    while (urlsToProcess.length > 0 && currentRetry <= config.maxRetries) {
      if (currentRetry > 0) {
        logger.warn(
          `[${batchId}] --- 开始第 ${currentRetry}/${config.maxRetries} 次重试，处理 ${urlsToProcess.length} 张失败的图片 ---`,
          logger.categories.DOWNLOAD,
          { batchId, currentRetry, maxRetries: config.maxRetries, pending: urlsToProcess.length }
        )
        await delay(config.retryDelayMs)
      }

      const stats = createStatsObject(
        aggregateStats.formatCounts,
        aggregateStats.analysisFailures, 
        aggregateStats.analysisFailedUrls,
        urlsToProcess.length
      )

      const { concurrentDownloads, minRequestDelayMs, maxRequestDelayMs } = config

      logger.header('Analyzing images ...', logger.categories.DOWNLOAD)
      let downloadHeaderPrinted = false
      
      for (let i = 0; i < urlsToProcess.length; i += concurrentDownloads) {
        const batch = urlsToProcess.slice(i, i + concurrentDownloads)
        const batchAnalysisSamples = []

        const downloadPromises = batch.map(async (imageUrl, index) => {
          const result = await processImage(
            imageUrl, index, context, derivedConfigForAnalysis, targetDownloadDir, 
            downloadedImages, stats, aggregateStats, totalAnalyzed, batchAnalysisSamples
          )
          if (result.analyzed) totalAnalyzed++
          if (result.needsDownloadHeader && !downloadHeaderPrinted) {
            logger.header('Downloading images ...', logger.categories.DOWNLOAD)
            downloadHeaderPrinted = true
          }
        })

        try {
          await Promise.all(downloadPromises)
          
          const currentProgress = Math.min(i + concurrentDownloads, urlsToProcess.length)
          logger.progress(currentProgress, urlsToProcess.length, `批次 ${Math.floor(i / concurrentDownloads) + 1} 完成`, 1)

          // 输出分析样本
          outputBatchSamples(batchAnalysisSamples)
        } catch (error) {
          handleBatchError(error, batchId)
        }

        // 批次间延迟
        if (i + concurrentDownloads < urlsToProcess.length) {
          const randomInterval = Math.floor(Math.random() * (maxRequestDelayMs - minRequestDelayMs + 1)) + minRequestDelayMs
          logger.debug(`[${batchId}] 等待 ${randomInterval} 毫秒后开始下一批次...`, logger.categories.NETWORK, { batchId, randomInterval })
          await delay(randomInterval)
        }
      }


      logger.header(`[${batchId}] --- 批处理完成 (尝试次数 ${currentRetry}) ---`)
      logger.success(`[${batchId}] 成功下载: ${stats.successful}/${stats.total}`)
      if (stats.failed > 0) {
        logger.error(`[${batchId}] 下载失败: ${stats.failed}/${stats.total}`)
      }

      urlsToProcess = [...stats.failedUrls]
      currentRetry++
    }
  } finally {
    // 进度启停交由入口统一控制
  }

  // 输出失败信息
  if (urlsToProcess.length > 0) {
    logger.error(`所有重试后，仍有 ${urlsToProcess.length} 张图片下载失败:`, logger.categories.DOWNLOAD, { failedCount: urlsToProcess.length })
    urlsToProcess.forEach((url) => logger.error(`- ${url}`, logger.categories.DOWNLOAD, { url }))
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
 * - 分析阶段将有效图片写入临时文件，记录 { url, tempPath, headers, metadata }
 * - 下载阶段从临时文件读取并调用 saveImage，结束后按配置清理临时文件
 * - 关键：formatCounts 在分析与下载阶段共享同一引用对象（跨重试/跨阶段累计），请勿重新赋值
 */
async function processTwoPhase(imageUrls, targetDownloadDir, context, downloadedImages) {
  const { config } = context
  const tempDir = config?.analysis?.tempDir || './.tmp_analysis'
  
  const aggregateStats = createAggregateStats()
  let tempFilesCreated = 0
  let tempBytesWritten = 0
  let tempCleanupRemoved = 0

  await ensureTempDir(tempDir)

  // 分析阶段
  const analyzeResult = await analyzePhase(imageUrls, context, tempDir, aggregateStats)
  const { validEntries, totalAnalyzed } = analyzeResult
  tempFilesCreated = analyzeResult.tempFilesCreated
  tempBytesWritten = analyzeResult.tempBytesWritten

  // 下载阶段
  const downloadResult = await downloadPhase(validEntries, targetDownloadDir, context, downloadedImages, aggregateStats, totalAnalyzed)
  tempCleanupRemoved = downloadResult.tempCleanupRemoved

  outputFinalStats(aggregateStats)
  logger.debug(`临时文件：created=${tempFilesCreated} removed=${tempCleanupRemoved} bytes=${tempBytesWritten}`)

  return {
    analyzed: totalAnalyzed,
    analysisFailures: aggregateStats.analysisFailures,
    analysisFailedUrls: aggregateStats.analysisFailedUrls,
    formatCounts: aggregateStats.formatCounts,
    analysisObservations: aggregateStats.analysisObservations
  }
}
