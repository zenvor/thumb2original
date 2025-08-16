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
 * 中文注释：判断是否应在本次分析结果上做抽样记录（下载队列侧的批次输出）
 * - 仅当 enableDetailLog 为 true 时生效
 * - sampleRate 表示每 N 张分析记录一次
 */
function shouldSampleBatchLog(analysisCfg, analyzedCount) {
  try {
    if (!analysisCfg || !analysisCfg.enableDetailLog) return false
    const base = Math.max(1, Number(analysisCfg.sampleRate) || 1)
    const sr = Math.max(1, Number(analysisCfg.effectiveSampleRate) || base)
    // 注意：这里使用累计的 totalAnalyzed 计数，保证全局节流
    return (analyzedCount % sr) === 0
  } catch {
    return false
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
  const { config, htmlFilePath, isResumeDownload, totalImageCount, downloadedCount } = context

  // 中文注释：twoPhase 模式：先全量完成 Analyze（含重试），将有效项写入临时文件；随后统一进入 Download 阶段
  if (config?.analysis?.mode === 'twoPhase') {
    // 冷启动清理（按配置启用）
    try {
      if (config?.analysis?.cleanupTempOnStart) {
        await cleanupTempDir(config?.analysis?.tempDir || './.tmp_analysis')
      }
    } catch {}
    return await processTwoPhase(imageUrls, targetDownloadDir, context, downloadedImages)
  }

  // 为整个下载批次创建一个唯一标识符
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

  // 中文注释：新增整个任务维度的图片格式统计（跨重试累计）
  const aggregateFormatCounts = Object.create(null)
  // 重要：保持此对象在整个尝试周期内以“同一引用”传递（由 stats.formatCounts 指向）
  // 请勿在下游对 stats.formatCounts 重新赋值，例如：stats.formatCounts = {...}
  // 否则会断开与 aggregateFormatCounts 的引用，导致计数无法跨重试累计。
  // 中文注释：新增整个任务维度的分析失败统计与 URL 列表（跨重试累计）
  const aggregateAnalysisFailures = {
    unsupported_content_type: 0,
    unknown_format: 0,
    content_too_small: 0,
    processing_timeout: 0,
    memory_error: 0,
    invalid_dimensions: 0,
    metadata_error: 0
  }
  // 可观测性：分析观察项（不影响行为）
  const aggregateAnalysisObservations = {
    metadata_parse_error_continue: 0
  }
  const aggregateAnalysisFailedUrls = []
  let totalAnalyzed = 0

  // 断点续传信息显示
  if (isResumeDownload) {
    logger.header(`断点续传模式：总共 ${totalImageCount} 张图片，已完成 ${downloadedCount} 张，还需下载 ${imageUrls.length} 张`)
  }

  let urlsToProcess = [...imageUrls]
  let currentRetry = 0
  

  // 动态采样：根据任务规模提升抽样间隔
  const totalCountForSampling = Number.isFinite(totalImageCount) ? totalImageCount : imageUrls.length
  const baseSR = Math.max(1, Number(config?.analysis?.sampleRate) || 1)
  let computedEffectiveSR = baseSR
  if (totalCountForSampling > 5000) {
    computedEffectiveSR = Math.max(baseSR, 1000)
  } else if (totalCountForSampling > 1000) {
    computedEffectiveSR = Math.max(baseSR, 500)
  }
  const userEffectiveSR = Number(config?.analysis?.effectiveSampleRate)
  const effectiveSampleRate = Number.isFinite(userEffectiveSR) && userEffectiveSR > 0
    ? Math.max(1, userEffectiveSR)
    : computedEffectiveSR
  const derivedAnalysisCfg = { ...(config?.analysis || {}), effectiveSampleRate }
  const derivedConfigForAnalysis = { ...config, analysis: derivedAnalysisCfg }

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

      const stats = {
        total: urlsToProcess.length,
        successful: 0,
        failed: 0,
        failedUrls: [],
        // 中文注释：指向跨重试共享的聚合对象，确保多次尝试也能累计
        formatCounts: aggregateFormatCounts,
        // 中文注释：P0 新增的分析阶段统计
        analyzed: 0,
        analysisFailures: aggregateAnalysisFailures,
        analysisFailedUrls: aggregateAnalysisFailedUrls
      }

      const { concurrentDownloads, minRequestDelayMs, maxRequestDelayMs } = config

      // 阶段头：分析阶段（队列尝试开始时打印一次）
      logger.header('Analyzing images ...', logger.categories.DOWNLOAD)

      let downloadHeaderPrinted = false
      for (let i = 0; i < urlsToProcess.length; i += concurrentDownloads) {
        const batch = urlsToProcess.slice(i, i + concurrentDownloads)

        // 中文注释：本批次的分析抽样结果（按配置抽样，批次末统一输出以降噪）
        const batchAnalysisSamples = []

        const downloadPromises = batch.map(async (imageUrl, index) => {
          // 为 imx.to 域名添加额外的单个请求延迟
          if (imageUrl.includes('imx.to') && index > 0) {
            const singleRequestDelay = Math.floor(Math.random() * 1000) + 500 // 500-1500ms 随机延迟
            logger.debug(`图片请求延迟 ${singleRequestDelay} 毫秒: ${imageUrl}`, logger.categories.NETWORK)
            await delay(singleRequestDelay)
          }
          
          const imageData = await fetchImage(imageUrl, context, 0)
          if (!imageData) {
            stats.failed++
            stats.failedUrls.push(imageUrl)
            return
          }

          // 中文注释：在写盘前进行分析
          const analysisResult = await analyzeImage(imageData, imageUrl, derivedConfigForAnalysis)
          stats.analyzed++
          totalAnalyzed++

          // 中文注释：按队列侧抽样策略记录样本，批次末统一输出
          if (shouldSampleBatchLog(derivedAnalysisCfg, totalAnalyzed)) {
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

          // 可观测性：元数据解析异常但继续的计数
          if (analysisResult?.metadata?.parseErrorContinue) {
            aggregateAnalysisObservations.metadata_parse_error_continue++
          }

          if (!analysisResult.isValid) {
            const reason = analysisResult.reason || 'unknown_format'
            if (stats.analysisFailures[reason] != null) {
              stats.analysisFailures[reason]++
            }
            stats.analysisFailedUrls.push(imageUrl)
            stats.failed++
            // 中文注释：可重试原因进入既有重试回路
            const retriableReasons = new Set(['processing_timeout', 'memory_error', 'content_too_small'])
            if (retriableReasons.has(reason)) {
              stats.failedUrls.push(imageUrl)
            }
            return
          }

          // 中文注释：类型统计仅在 saveImage 阶段按“最终落盘格式”累计，分析阶段不计数

          // 阶段头：下载阶段（仅打印一次/每次尝试）
          if (!downloadHeaderPrinted) {
            logger.header('Downloading images ...', logger.categories.DOWNLOAD)
            downloadHeaderPrinted = true
          }

          const fileName = generateFileName(imageUrl, imageData.buffer, imageData.headers)
          const filePath = path.join(targetDownloadDir, fileName)
          await saveImage(imageData.buffer, filePath, imageUrl, stats, downloadedImages, config, analysisResult)
        })

        try {
          await Promise.all(downloadPromises)
          
          // 显示当前批次进度
          const currentProgress = Math.min(i + concurrentDownloads, urlsToProcess.length)
          // 更新次级进度条 (level 1)
          logger.progress(currentProgress, urlsToProcess.length, `批次 ${Math.floor(i / concurrentDownloads) + 1} 完成`, 1)

          // 中文注释：批次级抽样详情输出（debug 级别，避免刷屏）
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
        } catch (error) {
          const isBrowserError =
            error.message.includes('Connection closed') ||
            error.message.includes('Navigating frame was detached') ||
            error.message.includes('Session closed')

          if (error.isCritical || isBrowserError) {
            const reason = error.isCritical ? '关键错误' : '浏览器连接断开'
            logger.error(`[${batchId}] 遇到${reason}，立即终止所有下载任务: ${error.message}`,
              logger.categories.DOWNLOAD,
              { batchId, ...toLogMeta(error) }
            )
            if (isBrowserError) {
              logger.error(`[${batchId}] 检测到浏览器实例关闭或页面已分离，这是严重错误，将终止程序。`,
                logger.categories.DOWNLOAD,
                { batchId }
              )
            }
            logger.error(`[${batchId}] 数据一致性保障：任务已安全终止，避免数据丢失`,
              logger.categories.DOWNLOAD,
              { batchId }
            )
            throw error // 立即终止整个下载流程
          }
          // 非关键错误继续处理
          logger.warn(`[${batchId}] 批次处理中出现错误，但非关键错误，继续处理: ${error.message}`,
            logger.categories.DOWNLOAD,
            { batchId, ...toLogMeta(error) }
          )
        }

        if (i + concurrentDownloads < urlsToProcess.length) {
          const randomInterval =
            Math.floor(Math.random() * (maxRequestDelayMs - minRequestDelayMs + 1)) + minRequestDelayMs
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

  if (urlsToProcess.length > 0) {
    logger.error(`所有重试后，仍有 ${urlsToProcess.length} 张图片下载失败:`, logger.categories.DOWNLOAD, { failedCount: urlsToProcess.length })
    urlsToProcess.forEach((url) => logger.error(`- ${url}`, logger.categories.DOWNLOAD, { url }))
  }

  // 中文注释：在任务结束后输出图片类型统计信息
  const entries = Object.entries(aggregateFormatCounts).filter(([_, v]) => v > 0)
  if (entries.length > 0) {
    const prefer = ['png', 'jpeg', 'svg', 'webp']
    const preferred = prefer.filter((k) => aggregateFormatCounts[k] > 0).map((k) => [k, aggregateFormatCounts[k]])
    const others = entries
      .filter(([k]) => !prefer.includes(k))
      .sort((a, b) => a[0].localeCompare(b[0]))
    const ordered = [...preferred, ...others]
    const text = ordered.map(([k, v]) => `${k.toUpperCase()} ${v}`).join('，')
    logger.success(`类型统计：${text}`)
  }

  // P1 增强：在队列尾部输出分析失败原因细分汇总
  const failReasons = Object.entries(aggregateAnalysisFailures).filter(([, v]) => v > 0)
  if (failReasons.length > 0) {
    const text = failReasons.map(([k, v]) => `${k} ${v}`).join('，')
    logger.info(`分析失败汇总：${text}`, logger.categories.DOWNLOAD)
  }

  // 可观测性：分析观察汇总（如 parse_error_continue）
  const obsReasons = Object.entries(aggregateAnalysisObservations).filter(([, v]) => v > 0)
  if (obsReasons.length > 0) {
    const text = obsReasons.map(([k, v]) => `${k} ${v}`).join('，')
    logger.info(`分析观察汇总：${text}`, logger.categories.DOWNLOAD)
  }

  // 返回聚合统计（用于测试与上层可观测性，不影响现有调用方）
  return {
    analyzed: totalAnalyzed,
    analysisFailures: aggregateAnalysisFailures,
    analysisFailedUrls: aggregateAnalysisFailedUrls,
    formatCounts: aggregateFormatCounts,
    analysisObservations: aggregateAnalysisObservations
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
  const { concurrentDownloads, minRequestDelayMs, maxRequestDelayMs, maxRetries } = config
  const tempDir = config?.analysis?.tempDir || './.tmp_analysis'
  const cleanupTempOnComplete = config?.analysis?.cleanupTempOnComplete !== false
  const maxHoldBuffers = Math.max(0, Number(config?.analysis?.maxHoldBuffers) || 0)

  // 任务范围内聚合统计
  const aggregateFormatCounts = Object.create(null)
  // 重要：twoPhase 下分析阶段与下载阶段都应复用此同一引用对象
  // 不要在任一阶段对 stats.formatCounts 重新赋值为新对象，以确保最终计数正确聚合。
  const aggregateAnalysisFailures = {
    unsupported_content_type: 0,
    unknown_format: 0,
    content_too_small: 0,
    processing_timeout: 0,
    memory_error: 0,
    invalid_dimensions: 0,
    metadata_error: 0
  }
  // 可观测性：分析观察项（不影响行为）
  const aggregateAnalysisObservations = {
    metadata_parse_error_continue: 0
  }
  const aggregateAnalysisFailedUrls = []
  let totalAnalyzed = 0
  let tempFilesCreated = 0
  let tempBytesWritten = 0
  let tempCleanupRemoved = 0

  await ensureTempDir(tempDir)

  // 分析阶段
  logger.header('Analyzing images ...', logger.categories.DOWNLOAD)
  // 动态采样：根据任务规模提升抽样间隔（twoPhase）
  const totalCountForSampling = imageUrls.length
  const baseSR = Math.max(1, Number(config?.analysis?.sampleRate) || 1)
  let computedEffectiveSR = baseSR
  if (totalCountForSampling > 5000) {
    computedEffectiveSR = Math.max(baseSR, 1000)
  } else if (totalCountForSampling > 1000) {
    computedEffectiveSR = Math.max(baseSR, 500)
  }
  const userEffectiveSR = Number(config?.analysis?.effectiveSampleRate)
  const effectiveSampleRate = Number.isFinite(userEffectiveSR) && userEffectiveSR > 0
    ? Math.max(1, userEffectiveSR)
    : computedEffectiveSR
  const derivedAnalysisCfg = { ...(config?.analysis || {}), effectiveSampleRate }
  const derivedConfigForAnalysis = { ...config, analysis: derivedAnalysisCfg }
  let urlsToAnalyze = [...imageUrls]
  let currentRetry = 0
  const validEntries = []
  const seenOk = new Set()
  // 若启用内存持有，则使用队列短暂缓存 buffer，达到阈值或批次末落盘
  let heldEntries = []
  

  const retriableReasons = new Set(['processing_timeout', 'memory_error', 'content_too_small'])

  while (urlsToAnalyze.length > 0 && currentRetry <= maxRetries) {
    if (currentRetry > 0) {
      logger.warn(`--- twoPhase 分析重试 ${currentRetry}/${maxRetries}，待处理 ${urlsToAnalyze.length} ---`, logger.categories.DOWNLOAD)
      await delay(config.retryDelayMs)
    }

    const stats = {
      total: urlsToAnalyze.length,
      successful: 0,
      failed: 0,
      failedUrls: [],
      formatCounts: aggregateFormatCounts,
      analyzed: 0,
      analysisFailures: aggregateAnalysisFailures,
      analysisFailedUrls: aggregateAnalysisFailedUrls
    }

    for (let i = 0; i < urlsToAnalyze.length; i += concurrentDownloads) {
      const batch = urlsToAnalyze.slice(i, i + concurrentDownloads)
      const tasks = batch.map(async (imageUrl, index) => {
        if (imageUrl.includes('imx.to') && index > 0) {
          const singleRequestDelay = Math.floor(Math.random() * 1000) + 500
          logger.debug(`图片请求延迟 ${singleRequestDelay} 毫秒: ${imageUrl}`, logger.categories.NETWORK)
          await delay(singleRequestDelay)
        }
        const imageData = await fetchImage(imageUrl, context, 0)
        if (!imageData) {
          stats.failed++
          stats.failedUrls.push(imageUrl)
          return
        }
        const analysisResult = await analyzeImage(imageData, imageUrl, derivedConfigForAnalysis)
        stats.analyzed++
        totalAnalyzed++

        // 可观测性：元数据解析异常但继续的计数（twoPhase 对齐 inline）
        if (analysisResult?.metadata?.parseErrorContinue) {
          aggregateAnalysisObservations.metadata_parse_error_continue++
        }

        if (!analysisResult.isValid) {
          const reason = analysisResult.reason || 'unknown_format'
          if (stats.analysisFailures[reason] != null) stats.analysisFailures[reason]++
          stats.analysisFailedUrls.push(imageUrl)
          stats.failed++
          if (retriableReasons.has(reason)) stats.failedUrls.push(imageUrl)
          return
        }

        // 中文注释：twoPhase 下也仅在最终写盘后按“落盘格式”计数，分析阶段不计数

        // 有效：写入临时文件（支持 maxHoldBuffers 内存持有）
        const entry = { url: imageUrl, buffer: imageData.buffer, headers: imageData.headers || {}, metadata: analysisResult.metadata }
        if (maxHoldBuffers > 0) {
          // 仅收集，批次末统一落盘，避免并发条件竞争
          heldEntries.push(entry)
        } else {
          const tempPath = await writeBufferToTemp(entry.buffer, tempDir)
          tempFilesCreated++
          tempBytesWritten += entry.buffer.length
          validEntries.push({ url: entry.url, tempPath, headers: entry.headers, metadata: entry.metadata })
        }
        stats.successful++
      })

      try {
        await Promise.all(tasks)
        const currentProgress = Math.min(i + concurrentDownloads, urlsToAnalyze.length)
        logger.progress(currentProgress, urlsToAnalyze.length, `分析批次 ${Math.floor(i / concurrentDownloads) + 1} 完成`, 1)
        if (i + concurrentDownloads < urlsToAnalyze.length) {
          const randomInterval = Math.floor(Math.random() * (maxRequestDelayMs - minRequestDelayMs + 1)) + minRequestDelayMs
          logger.debug(`等待 ${randomInterval} 毫秒后开始下一分析批次...`, logger.categories.NETWORK)
          await delay(randomInterval)
        }
      } catch (e) {
        logger.warn(`分析批次异常：${e.message}`)
      }
    }

    // 批次末：若仍有未落盘的 heldEntries，统一落盘
    if (maxHoldBuffers > 0 && heldEntries.length > 0) {
      for (const e of heldEntries) {
        const tempPath = await writeBufferToTemp(e.buffer, tempDir)
        tempFilesCreated++
        tempBytesWritten += e.buffer.length
        validEntries.push({ url: e.url, tempPath, headers: e.headers, metadata: e.metadata })
      }
      heldEntries = []
    }

    urlsToAnalyze = [...stats.failedUrls]
    currentRetry++
  }

  // 下载阶段
  logger.header('Downloading images ...', logger.categories.DOWNLOAD)
  const downloadStats = {
    total: validEntries.length,
    successful: 0,
    failed: 0,
    failedUrls: [],
    formatCounts: aggregateFormatCounts,
    analyzed: totalAnalyzed,
    analysisFailures: aggregateAnalysisFailures,
    analysisFailedUrls: aggregateAnalysisFailedUrls
  }

  for (let i = 0; i < validEntries.length; i += concurrentDownloads) {
    const batch = validEntries.slice(i, i + concurrentDownloads)
    const tasks = batch.map(async (entry) => {
      try {
        const buffer = await readBufferFromTemp(entry.tempPath)
        const fileName = generateFileName(entry.url, buffer, entry.headers)
        const filePath = path.join(targetDownloadDir, fileName)
        await saveImage(buffer, filePath, entry.url, downloadStats, downloadedImages, config, { isValid: true, metadata: entry.metadata })
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
      logger.warn(`下载批次异常：${e.message}`)
    }
  }

  if (downloadStats.failed > 0) {
    logger.error(`twoPhase 下载失败: ${downloadStats.failed}/${downloadStats.total}`)
  }

  // 在任务结束后输出图片类型统计信息（与 inline 路径保持一致）
  const entries = Object.entries(aggregateFormatCounts).filter(([_, v]) => v > 0)
  if (entries.length > 0) {
    const prefer = ['png', 'jpeg', 'svg', 'webp']
    const preferred = prefer.filter((k) => aggregateFormatCounts[k] > 0).map((k) => [k, aggregateFormatCounts[k]])
    const others = entries
      .filter(([k]) => !prefer.includes(k))
      .sort((a, b) => a[0].localeCompare(b[0]))
    const ordered = [...preferred, ...others]
    const text = ordered.map(([k, v]) => `${k.toUpperCase()} ${v}`).join('，')
    logger.success(`类型统计：${text}`)
  }

  // 汇总输出：分析失败原因
  const reasons = Object.entries(aggregateAnalysisFailures).filter(([, v]) => v > 0)
  if (reasons.length > 0) {
    const text = reasons.map(([k, v]) => `${k} ${v}`).join('，')
    logger.info(`分析失败汇总：${text}`, logger.categories.DOWNLOAD)
  }

  // 可观测性：分析观察汇总（如 parse_error_continue）
  const obsReasons = Object.entries(aggregateAnalysisObservations).filter(([, v]) => v > 0)
  if (obsReasons.length > 0) {
    const text = obsReasons.map(([k, v]) => `${k} ${v}`).join('，')
    logger.info(`分析观察汇总：${text}`, logger.categories.DOWNLOAD)
  }

  logger.debug(`临时文件：created=${tempFilesCreated} removed=${tempCleanupRemoved} bytes=${tempBytesWritten}`)

  return {
    analyzed: totalAnalyzed,
    analysisFailures: aggregateAnalysisFailures,
    analysisFailedUrls: aggregateAnalysisFailedUrls,
    formatCounts: aggregateFormatCounts,
    analysisObservations: aggregateAnalysisObservations
  }
}
