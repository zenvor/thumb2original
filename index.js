import { scraperConfig } from './config/config.js'
import { logger } from './utils/logger.js'
import { defaultLogConfig } from './config/logConfig.js'
import { validateAndNormalizeConfig } from './lib/configValidator.js'
import { launchBrowser } from './lib/browserLauncher.js'
import { downloadManager } from './lib/downloadManager.js'
import {
  loadAndScrollPage,
  extractImageUrls,
  processUrlsByImageMode,
  processLocalHtmlMode,
} from './lib/htmlProcessor.js'
import { scrapeUrl } from './lib/downloadManager.js'
import { toLogMeta } from './utils/errors.js'

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
  try {
    const launched = await launchBrowser(config)
    browser = launched.browser
    stopMonitoring = launched.stopMonitoring
  } catch (e) {
    logger.error(`无法启动浏览器，程序将退出：${e.message}`, 'system', toLogMeta(e))
    return
  }

  const startTime = Date.now()

  // 根据配置决定是否启动进度模式
  const logConfig = logger.getConfig()
  if (logConfig.showDownloadProgress) {
    logger.info('启动进度显示模式', 'system')
    logger.startProgress()
  } else {
    logger.info('进度显示已禁用，使用普通日志模式', 'system')
  }

  try {
    if (config.scrapeMode === 'local_html') {
      // 本地HTML爬虫模式
      logger.header('\n=================== 启动本地HTML爬虫模式 ===================')
      await processLocalHtmlMode(browser, config, downloadManager)
      logger.header('=================== 本地HTML爬虫模式完成 ===================')
    } else {
      // 网络爬虫模式
      const urlsToScrape = config.scrapeMode === 'single_page' ? [config.targetUrl] : config.targetUrls

      for (const url of urlsToScrape) {
        if (!url) continue
        logger.header(`\n------------------- 开始抓取: ${url} -------------------`)
        await scrapeUrl(url, browser, config, loadAndScrollPage, extractImageUrls, processUrlsByImageMode)
        logger.header(`------------------- 抓取完成: ${url} -------------------\n`)
      }
    }
  } catch (error) {
    logger.error(`发生了一个严重错误: ${error.message}`, 'system', toLogMeta(error))
  } finally {
    // 根据配置决定是否停止进度模式
    const logConfig = logger.getConfig()
    if (logConfig.showDownloadProgress) {
      logger.stopProgress()
    }
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
    const duration = (Date.now() - startTime) / 1000
    logger.header(`总执行时间: ${duration.toFixed(2)} 秒。`)
  }
}

// ===================================================================================
// 启动爬虫
// ===================================================================================
runImageScraper(scraperConfig)
