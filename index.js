import { scraperConfig } from './config/config.js'
import { logger } from './utils/logger.js'
import { defaultLogConfig } from './config/logConfig.js'
import { validateAndNormalizeConfig } from './lib/configValidator.js'
import { launchBrowser } from './lib/browserLauncher.js'
import { downloadManager } from './lib/publicApi.js'
import { loadAndScrollPage } from './lib/pageLoader.js'
import { extractImageUrls } from './lib/imageExtractor.js'
import { processUrlsByImageMode } from './lib/imageModeProcessor.js'
import { processLocalHtmlMode } from './lib/localHtmlProcessor.js'
import { scrapeUrl } from './lib/publicApi.js'
import { toLogMeta } from './utils/errors.js'

// ============================== 辅助函数 ==============================
function startProgressIfEnabled() {
  const logConfig = logger.getConfig()
  if (logConfig.showDownloadProgress) {
    logger.info('启动进度显示模式', 'system')
    logger.startProgress()
  } else {
    logger.info('进度显示已禁用，使用普通日志模式', 'system')
  }
}

function stopProgressIfEnabled() {
  const logConfig = logger.getConfig()
  if (logConfig.showDownloadProgress) {
    logger.stopProgress()
  }
}

async function initBrowser(config) {
  try {
    const launched = await launchBrowser(config)
    return { browser: launched.browser, stopMonitoring: launched.stopMonitoring }
  } catch (e) {
    logger.error(`无法启动浏览器，程序将退出：${e.message}`, 'system', toLogMeta(e))
    return null
  }
}

async function runLocalHtmlMode(browser, config) {
  logger.header('\n=================== 启动本地HTML爬虫模式 ===================')
  await processLocalHtmlMode(browser, config, downloadManager)
  logger.header('=================== 本地HTML爬虫模式完成 ===================')
}

async function runNetworkMode(browser, config) {
  let urlsToScrape = []
  if (config.scrapeMode === 'single_page') {
    if (config.targetUrl) {
      urlsToScrape = [config.targetUrl]
    } else {
      logger.warn('single_page 模式未提供 targetUrl，将跳过网络抓取。', 'system')
    }
  } else {
    if (Array.isArray(config.targetUrls)) {
      urlsToScrape = config.targetUrls.filter(Boolean)
    } else if (config.scrapeMode === 'multiple_pages') {
      logger.warn('multiple_pages 模式未提供有效的 targetUrls，将跳过网络抓取。', 'system')
    }
  }

  const twoPhaseApiOutputs = []
  for (const url of urlsToScrape) {
    if (!url) continue
    logger.header(`\n------------------- 开始抓取: ${url} -------------------`)
    const result = await scrapeUrl(url, browser, config, loadAndScrollPage, extractImageUrls, processUrlsByImageMode)
    // 收集 twoPhaseApi 结构化输出
    if (config?.analysis?.mode === 'twoPhaseApi' && result) {
      twoPhaseApiOutputs.push({ url, ...result })
    }
    logger.header(`------------------- 抓取完成: ${url} -------------------\n`)
  }
  return twoPhaseApiOutputs
}

async function cleanupBrowser(browser, stopMonitoring) {
  // 清理连接监控器
  try {
    stopMonitoring && stopMonitoring()
  } catch {}
  if (browser) {
    try {
      await browser.close()
      logger.info('浏览器已关闭。')
    } catch (closeError) {
      logger.error(`关闭浏览器时发生错误: ${closeError.message}`, 'system', toLogMeta(closeError))
    }
  }
}

/**
 * @description 主函数，根据配置启动图片抓取器。
 * @param {object} config - 爬虫的配置对象。
 */
async function runImageScraper(config) {
  // 初始化日志配置
  logger.initConfig(defaultLogConfig)
  logger.info('日志系统已初始化', 'system')
  // 配置校验与默认值填充
  config = await validateAndNormalizeConfig(config)
  // 启动浏览器（含 stealth/监控）
  let browser, stopMonitoring
  const launched = await initBrowser(config)
  if (!launched) return
  ;({ browser, stopMonitoring } = launched)
  const startTime = Date.now()
  // 进度显示
  startProgressIfEnabled()
  let finalTwoPhaseApiOutputs = undefined
  try {
    if (config.scrapeMode === 'local_html') {
      await runLocalHtmlMode(browser, config)
    } else {
      finalTwoPhaseApiOutputs = await runNetworkMode(browser, config)
    }
  } catch (error) {
    logger.error(`发生了一个严重错误: ${error.message}`, 'system', toLogMeta(error))
  } finally {
    stopProgressIfEnabled()
    await cleanupBrowser(browser, stopMonitoring)
    const duration = (Date.now() - startTime) / 1000
    logger.header(`总执行时间: ${duration.toFixed(2)} 秒。`)
    // 在最后输出 twoPhaseApi 的完整结构化数据（stdout）
    if (config?.analysis?.mode === 'twoPhaseApi' && Array.isArray(finalTwoPhaseApiOutputs)) {
      const payload = {
        mode: 'twoPhaseApi',
        pages: finalTwoPhaseApiOutputs
      }
      // 使用 console.log 确保输出为纯 JSON，便于机器读取
      console.log(JSON.stringify(payload, null, 2))
    }
  }
}

// ===================================================================================
// 启动爬虫
// ===================================================================================
runImageScraper(scraperConfig)
